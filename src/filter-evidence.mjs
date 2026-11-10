// Generic helpers for filter-evidence collection and classification.
// Site, block, setting, page, fields and products come from args, env or profile.
import fs from 'node:fs';

const AUTOTEST = /^AUTOTEST-/;

export function parseArgv(argv, { flags = [] } = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (flags.includes(key)) { args[key] = true; continue; }
    args[key] = argv[i + 1];
    i++;
  }
  return args;
}

export function loadJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function requireAutotestName(name, label) {
  if (!AUTOTEST.test(String(name || ''))) throw new Error(`${label} must start with AUTOTEST-`);
  return name;
}

function pickBlock(fixtureState, args, env, profile) {
  const blocks = fixtureState?.blocks || {};
  const wanted = String(firstDefined(args.block, args['block-id'], profile.blockId, env.BLOCK_ID) || '');
  if (wanted && blocks[wanted]) return blocks[wanted];
  const values = Object.values(blocks);
  if (wanted) {
    const hit = values.find((block) => block.blockId === wanted);
    if (hit) return hit;
  }
  return values.length === 1 ? values[0] : null;
}

export function resolveFilterEvidenceTarget({ args = {}, env = {}, profile = {}, fixtureState = null } = {}) {
  const block = pickBlock(fixtureState, args, env, profile);
  const page = profile.page || profile.target || block?.page || {};
  const blockId = String(firstDefined(args.block, args['block-id'], profile.blockId, block?.blockId, env.BLOCK_ID) || '');
  const settingId = String(firstDefined(args['setting-id'], profile.settingId, block?.settingId, env.FRESH_SETTING_ID) || '');
  const siteHost = String(firstDefined(args['site-host'], profile.siteHost, fixtureState?.site?.domain, env.SITE_HOST) || '').replace(/^https?:\/\//, '');
  const pageId = String(firstDefined(args['page-id'], page.id, page.pageId, env.FRESH_PAGE_ID) || '');
  const pageUrl = String(firstDefined(args['page-url'], page.url, page.pageUrl, env.FRESH_PAGE_URL) || '');
  const pageKind = String(firstDefined(args['page-kind'], page.kind, page.pageKind, env.FRESH_PAGE_KIND, 'system'));
  const pageName = String(firstDefined(args['page-name'], page.name, env.FRESH_PAGE_NAME, ''));
  const missing = Object.entries({ blockId, settingId, siteHost, pageId, pageUrl })
    .filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing filter-evidence identity: ${missing.join(', ')}`);
  const fixture = profile.fixture || {};
  const stateFields = (fixtureState?.fields || []).filter((field) => field.role !== 'display').map((field) => field.name);
  const stateProducts = (fixtureState?.products || []).map((product) => product.name);
  const fields = (args.fields ? String(args.fields).split(',').map((s) => s.trim()).filter(Boolean)
    : (stateFields.length ? stateFields : (fixture.fields || []).map((field) => field.name)));
  const products = args.products ? String(args.products).split(',').map((s) => s.trim()).filter(Boolean)
    : (stateProducts.length ? stateProducts : (fixture.products || []).map((product) => (typeof product === 'string' ? product : product.name)));
  if (!fields.length || !products.length) throw new Error('Filter evidence requires fixture fields and products (or --fields and --products).');
  fields.forEach((name) => requireAutotestName(name, 'Field'));
  products.forEach((name) => requireAutotestName(name, 'Product'));
  const selectTitle = firstDefined(args['select-title'], fixture.fields?.[0]?.name);
  const selectValue = firstDefined(args['select-value'], fixture.fields?.[0]?.options?.[0]);
  return {
    blockId, settingId, siteHost, pageId, pageUrl, pageKind, pageName, fields, products,
    fixture,
    fixtureState,
    select: selectTitle && selectValue ? { title: selectTitle, value: selectValue } : null,
  };
}

export function isBlankFilterfields(value) {
  return value == null || String(value).trim() === '';
}

export function canvasAttributeMissing(canvas) {
  return !canvas || canvas.status !== 'ok' || canvas.attributePresent !== true;
}

// Pure function injected into the editor canvas / published page.
export function readInstanceFilterAttrsFn() {
  return ({ blockId, settingId }) => {
    const roots = [...document.querySelectorAll('[data-appid]')].filter((root) => root.getAttribute('data-appid') === String(blockId));
    const matches = roots.filter((root) => [root, ...root.querySelectorAll('*')].some((node) => [...node.attributes]
      .some((attr) => /setting.?id/i.test(attr.name) && attr.value === settingId)));
    if (matches.length !== 1) return { status: 'not-unique', rootCount: roots.length, matchCount: matches.length, attributePresent: false };
    const root = matches[0];
    const collected = {};
    for (const node of [root, ...root.querySelectorAll('*')]) {
      for (const attr of node.attributes) {
        if (!/filterfields|checkboxarr|fieldsort|autofilter|selectlogic|filterscope|settingid|versionno|classattr/i.test(attr.name)) continue;
        collected[attr.name] ??= [];
        collected[attr.name].push({ value: attr.value, tag: node.tagName, className: String(node.className || '').slice(0, 180) });
      }
    }
    const host = root.querySelector('[data-filterfields]') || (root.hasAttribute('data-filterfields') ? root : null);
    const titles = [...root.querySelectorAll('.pf-group-title, .pf-field-title, .prodfield-left-fieldname')]
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return {
      status: 'ok',
      attributePresent: Boolean(host),
      rawFilterfields: host ? host.getAttribute('data-filterfields') : null,
      rawCheckboxarr: host ? host.getAttribute('data-checkboxarr') : null,
      attributes: collected,
      filterGroupTitles: titles,
      instanceOuterHTML: root.outerHTML.slice(0, 8000),
    };
  };
}

export function isRecordOnlyFilterRequirement(requirement) {
  if (!requirement) return false;
  if (requirement.params?.recordOnly) return true;
  if (requirement.status === '待确认' || requirement.status === '暂缓') return true;
  return false;
}

export function filterRequirementFlags(requirement) {
  const note = `${requirement?.note || ''} ${requirement?.sourceText || ''}`;
  return {
    recordOnly: isRecordOnlyFilterRequirement(requirement),
    deferred: requirement?.status === '暂缓',
    pendingTextMatch: requirement?.status === '部分待确认' || /完全一致还是包含/.test(note),
    emptySetOk: Array.isArray(requirement?.expected?.resultSet)
      || Object.values(requirement?.cases || {}).some((value) => Array.isArray(value)),
  };
}

// Dodo's decision rules. Always labelled as a suggestion, never a final verdict.
export function suggestFilterEvidenceClassification(evidence = {}) {
  const label = 'suggestion';
  const fields = evidence.fields || Object.keys(evidence.editorSettingsAfterSave?.afterSave || evidence.checked || {});
  const checked = evidence.editorSettingsAfterSave?.afterSave || evidence.checked;
  if (checked && fields.some((name) => checked[name] !== true)) {
    return { label, code: 'config-not-applied', detail: '编辑器回读显示目标筛选字段未全部勾选，建议判为配置没生效。' };
  }
  const canvas = evidence.canvas || evidence.preview || {};
  const published = evidence.published || {};
  const selection = evidence.selection || {};
  if (canvas.attributePresent && isBlankFilterfields(canvas.rawFilterfields)) {
    return { label, code: 'block-defect-editor-render', detail: '保存后、发布前画布（或预览）data-filterfields 已为空，建议判为区块缺陷（编辑器/画布渲染）。' };
  }
  const controlVerified = evidence.controlChange?.verified === true;
  if (!isBlankFilterfields(canvas.rawFilterfields) && isBlankFilterfields(published.rawFilterfields) && controlVerified) {
    return { label, code: 'block-defect-publish-render', detail: '画布/预览 data-filterfields 非空，发布页为空，且对照改动已出现，建议判为区块缺陷（发布渲染）。' };
  }
  if (selection.confirmed === false) {
    return { label, code: 'test-script-problem', detail: '第 6 项发现控件未真正选中，建议判为测试脚本问题。' };
  }
  if (!isBlankFilterfields(published.rawFilterfields) && selection.confirmed === true && selection.setUnchanged === true) {
    return { label, code: 'block-defect-filter-logic', detail: '发布页 data-filterfields 非空且选值已确认，结果仍未收窄，建议判为区块缺陷（筛选逻辑）。' };
  }
  return { label, code: 'inconclusive', detail: '现有证据不足以按规则给出明确分类，建议仅作参考。' };
}


export function sameNameSet(actual = [], expected = []) {
  const norm = (name) => String(name || '').trim();
  const a = [...actual].map(norm).filter(Boolean).sort();
  const b = [...expected].map(norm).filter(Boolean).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function evaluateFilterRequirement(requirement, evidence = {}) {
  const flags = filterRequirementFlags(requirement);
  if (flags.recordOnly || flags.deferred) {
    return {
      status: 'record',
      flags,
      detail: flags.deferred ? '该要求已标记为暂缓，仅作记录，不参与符合性判定。' : '该要求为待确认，仅作记录，不参与符合性判定。',
      reason: { code: flags.deferred ? 'filter-deferred' : 'filter-record-only' },
    };
  }
  if (requirement.checkType === 'filter-layout') {
    const actual = evidence.layout;
    if (!actual) return { status: 'na', flags, detail: '缺少筛选布局证据。', reason: { code: 'filter-evidence-unavailable' } };
    const columns = requirement.expected?.columns;
    const pass = columns == null || Number(actual.columns) === Number(columns);
    return { status: pass ? 'pass' : 'fail', flags, actual, expected: requirement.expected,
      detail: pass ? '筛选布局符合清单。' : '筛选布局与清单不一致。',
      reason: { code: pass ? 'filter-layout-matched' : 'filter-layout-mismatch' } };
  }
  if (requirement.checkType === 'filter-interaction') {
    const actual = evidence.interaction;
    if (!actual) return { status: 'na', flags, detail: '缺少筛选交互证据。', reason: { code: 'filter-evidence-unavailable' } };
    const pass = requirement.expected?.clickCollapsesOnlyThatColumn
      ? actual.clickCollapsesOnlyThatColumn === true && actual.otherColumnUnchanged === true
      : actual.confirmed !== false;
    return { status: pass ? 'pass' : 'fail', flags, actual,
      detail: pass ? '筛选交互符合清单。' : '筛选交互与清单不一致。',
      reason: { code: pass ? 'filter-interaction-matched' : 'filter-interaction-mismatch' } };
  }
  if (requirement.checkType === 'mobile-layout' && requirement.expected?.filtersToggleButton != null) {
    const actual = evidence.mobile;
    if (!actual) return { status: 'na', flags, detail: '缺少移动端筛选证据。', reason: { code: 'filter-evidence-unavailable' } };
    const keys = ['filtersToggleButton', 'filterGroupsSingleColumn', 'productCountShown', 'pagination', 'cardsSingleColumn', 'noHorizontalOverflowAt375'];
    const mismatches = keys.filter((key) => requirement.expected[key] != null && Boolean(actual[key]) !== Boolean(requirement.expected[key]));
    return { status: mismatches.length ? 'fail' : 'pass', flags, actual, mismatches,
      detail: mismatches.length ? `移动端筛选与清单不一致：${mismatches.join(', ')}` : '移动端五项筛选检查符合清单。',
      reason: { code: mismatches.length ? 'filter-mobile-mismatch' : 'filter-mobile-matched' } };
  }
  if (requirement.checkType !== 'filter-oracle') {
    return { status: 'na', flags, detail: '不是可执行的筛选检查类型。', reason: { code: 'filter-check-type-unhandled' } };
  }
  const cases = requirement.cases
    ? Object.entries(requirement.cases).map(([key, expected]) => ({ key, expected }))
    : requirement.expected?.resultSet !== undefined
      ? [{ key: requirement.id, expected: requirement.expected.resultSet }]
      : [];
  if (!cases.length && requirement.expected?.countEqualsResultSetSize) {
    const actual = evidence.count;
    if (actual == null) return { status: 'na', flags, detail: '缺少产品数量证据。', reason: { code: 'filter-evidence-unavailable' } };
    const pass = Number(actual.count) === Number(actual.resultSetSize);
    return { status: pass ? 'pass' : 'fail', flags, actual,
      detail: pass ? '产品数量等于结果集大小。' : '产品数量与结果集大小不一致。',
      reason: { code: pass ? 'filter-count-matched' : 'filter-count-mismatch' } };
  }
  const actualCases = evidence.cases || evidence.oracle || null;
  if (!cases.length) return { status: 'na', flags, detail: '清单没有可比较的结果集。', reason: { code: 'filter-expectation-unavailable' } };
  if (!actualCases) return { status: 'na', flags, detail: '缺少筛选结果证据。', reason: { code: 'filter-evidence-unavailable' } };
  const compared = cases.map(({ key, expected }) => {
    const actual = actualCases[key]?.names || actualCases[key] || [];
    const pass = sameNameSet(actual, expected || []);
    return { key, expected: expected || [], actual, pass };
  });
  const failed = compared.filter((item) => !item.pass);
  const status = failed.length ? 'fail' : 'pass';
  return {
    status,
    flags,
    actual: compared,
    pendingTextMatch: flags.pendingTextMatch,
    detail: flags.pendingTextMatch
      ? `${status === 'pass' ? '按完全一致匹配，结果符合预期。' : '按完全一致匹配，结果与预期不一致。'}文本匹配规则（完全一致或包含）仍待确认。`
      : status === 'pass' ? '筛选结果集符合清单（允许空集）。' : `筛选结果集与清单不一致：${failed.map((item) => item.key).join('、')}`,
    reason: { code: status === 'pass' ? 'filter-oracle-matched' : 'filter-oracle-mismatch', pendingTextMatch: flags.pendingTextMatch || undefined },
  };
}

export function assessMobileFilterLayout(expected, actual) {
  return evaluateFilterRequirement({ checkType: 'mobile-layout', expected }, { mobile: actual });
}

export function cacheBustedFrontUrl(url, t = Date.now()) {
  const target = new URL(url, 'http://placeholder.local');
  target.searchParams.set('t', String(t));
  return target.href;
}
