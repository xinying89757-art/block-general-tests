import { FIELD_TYPE_CODES } from './cms.mjs';
import { fixturePlan } from './fixture-data.mjs';
import { validateFixture } from './fixture.mjs';

const aliases = /下拉列表|下拉|单选按钮|单选|多选按钮|多选|文本字段|文本/g;
const canonical = { 下拉: '下拉列表', 下拉列表: '下拉列表', 单选: '单选按钮', 单选按钮: '单选按钮', 多选: '多选按钮', 多选按钮: '多选按钮', 文本: '文本字段', 文本字段: '文本字段' };
export function parseFilterSupportedTypes(sourceText) {
  return [...new Set((String(sourceText || '').match(aliases) || []).map(type => canonical[type]))];
}
export function isFilterSupportedTypes(requirement) {
  return /filter-field-supported/i.test(requirement?.id || '') || (requirement?.checkType === 'manual' && /支持类型\s*[：:]/.test(requirement?.sourceText || '') && parseFilterSupportedTypes(requirement.sourceText).length > 0);
}
export function buildDefaultFilterFixture(types, { blockId } = {}) {
  const unique = [...new Set(types || [])];
  if (!unique.length || unique.some(type => FIELD_TYPE_CODES[type] === undefined)) throw new Error('筛选类型必须是已知的非空类型列表。');
  const fields = unique.map(type => ({ name: `AUTOTEST-${type}`, type, typeCode: FIELD_TYPE_CODES[type], options: [`${type}-A`, `${type}-B`] }));
  const prefix = `AUTOTEST-${blockId ? `${blockId}-` : ''}筛选`;
  const products = Array.from({ length: fields.length + 1 }, (_, index) => ({ name: `${prefix}-${index === 0 ? '基准' : `翻转${index}`}`,
    values: Object.fromEntries(fields.map((field, i) => [field.name, field.options[index === i + 1 ? 1 : 0]])) }));
  return { filterFieldTypes: unique, fields, category: { name: 'AUTOTEST-筛选分类' }, products };
}
export function applyFilterFixtureFromDesignSpec(profile) {
  const requirements = (profile.designSpec?.requirements || []).filter(isFilterSupportedTypes);
  const types = [...new Set(requirements.flatMap(r => parseFilterSupportedTypes(r.sourceText)))];
  if (!types.length) return profile;
  for (const requirement of requirements) requirement.expected = { ...requirement.expected, types: parseFilterSupportedTypes(requirement.sourceText) };
  let usable = false;
  try { validateFixture(profile.fixture, profile.requirements); fixturePlan(profile); usable = types.every(t => profile.fixture.filterFieldTypes?.includes(t)); } catch { /* draft below */ }
  if (!usable) {
    const draft = buildDefaultFilterFixture(types, { blockId: profile.blockId });
    const displayOnly = [...new Set(profile.requirements?.displayFieldTypes || [])].filter(type => !types.includes(type));
    if (displayOnly.length) {
      if (displayOnly.some(type => FIELD_TYPE_CODES[type] === undefined)) throw new Error('展示字段包含未知类型，无法草拟夹具。');
      draft.displayFields = { fields: displayOnly.map(type => ({ name: `AUTOTEST-${type}`, type,
        typeCode: FIELD_TYPE_CODES[type], options: [`${type}-A`, `${type}-B`],
        values: Object.fromEntries(draft.products.map(product => [product.name, `${type}-A`])) })) };
    }
    profile.fixture = draft;
    profile.testData = { ...profile.testData, status: 'fixture-drafted-from-design-spec' };
  }
  return profile;
}
export function aggregateFilterDesignRequirement(requirement, profile, checks, fixtureState) {
  const types = requirement.expected?.types?.length ? requirement.expected.types : parseFilterSupportedTypes(requirement.sourceText);
  const fields = profile.fixture?.fields || [];
  const rows = types.map(type => {
    const index = fields.findIndex(field => field.type === type);
    const field = fields[index];
    const check = checks.find(item => item.id === `cff-oracle-single-${index + 1}`);
    const sets = check?.evidence?.productSets?.[0] || check?.reason?.evidence?.productSets?.[0];
    return { type, field: field?.name || null, value: field?.options?.[0] || null,
      expected: field ? (profile.fixture.products || []).filter(p => p.values?.[field.name] === field.options[0]).map(p => p.name) : [],
      actual: sets?.actual ?? null, status: check?.status || 'missing', checkId: check?.id || null, detail: check?.detail || null };
  });
  const failed = fixtureState?.applied !== false && rows.some(row => row.status === 'fail');
  const complete = fixtureState?.applied !== false && types.length > 0 && rows.every(row => row.status === 'pass' && Array.isArray(row.actual));
  const status = failed ? 'fail' : complete ? 'pass' : 'human-review';
  const code = complete ? 'filter-oracle-passed' : failed ? 'filter-oracle-failed' : fixtureState?.applied === false ? 'filter-fixture-unavailable' : 'filter-oracle-unavailable';
  return { id: `design-${requirement.id}`, name: requirement.sourceText, sourceText: requirement.sourceText, status,
    expected: { ...requirement.expected, types }, actual: rows, evidence: { types: rows, fixture: fixtureState || null },
    detail: complete ? '各类型单值筛选均符合夹具真值表。' : failed ? '至少一种类型的筛选结果与真值表不符。' : '夹具或单值筛选证据不完整，需人工判断。',
    reason: { code, stage: 'front', ...(status === 'human-review' ? { humanReviewRequired: true } : {}) } };
}
export function finalizeFilterDesignChecks(profile, report) {
  for (const requirement of (profile.designSpec?.requirements || []).filter(isFilterSupportedTypes)) {
    const derived = aggregateFilterDesignRequirement(requirement, profile, report.checks, report.fixture);
    report.checks = report.checks.filter(check => check.id !== derived.id);
    report.checks.push(derived);
  }
  return report;
}
