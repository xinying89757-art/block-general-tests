// Loader and validator for fixture-spec drafts and fixture-state.json.
// Identity, names and ids come from the spec, records, CLI or env — never hardcoded.
import fs from 'node:fs';
import path from 'node:path';

export const DATA_SOURCE_OPTIONS = Object.freeze([
  '所有产品', '使用筛选条件', '选择指定产品', '选择部分产品分类',
]);
export const FILTER_SETTINGS_FIXED = Object.freeze({
  筛选逻辑: '交集',
  筛选方式: '更改筛选项后自动筛选',
  筛选范围: '当前分类产品',
});
export const PRODUCT_FLAG_VALUES = Object.freeze(['热门产品', '新产品', '推荐产品']);
export const FIELD_KIND = Object.freeze({
  下拉列表: 'dropdown', 单选按钮: 'radio', 多选按钮: 'multi', 文本字段: 'text',
});
const TYPE_ALIASES = Object.freeze({
  下拉: '下拉列表', 下拉列表: '下拉列表', dropdown: '下拉列表',
  单选: '单选按钮', 单选按钮: '单选按钮', radio: '单选按钮',
  多选: '多选按钮', 多选按钮: '多选按钮', multi: '多选按钮', 'multi-select': '多选按钮',
  文本: '文本字段', 文本字段: '文本字段', text: '文本字段',
});
const SECRET_KEY = /password|passwd|secret|token|cookie|authorization|api[_-]?key/i;
const POINTER_KEYS = new Set(['kind', 'path', 'pointer', 'envFile', 'profile']);
const AUTOTEST = /^AUTOTEST-/;

export function loadJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function canonicalizeFieldType(type) {
  const canonical = TYPE_ALIASES[String(type || '').trim()];
  if (!canonical) throw new Error(`Unknown field type: ${type}`);
  return canonical;
}

export function fieldKind(type) {
  return FIELD_KIND[canonicalizeFieldType(type)];
}

export function isDeferredStatus(status) {
  return status === '暂缓' || status === '待确认';
}

export function isPendingStatus(status) {
  return status === '部分待确认';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireAutotest(name, label) {
  if (!AUTOTEST.test(String(name || ''))) throw new Error(`${label} must start with AUTOTEST-`);
  return name;
}

function rejectSecrets(object, pathLabel) {
  if (!isPlainObject(object)) return;
  for (const [key, value] of Object.entries(object)) {
    if (key === 'credentialConfig') {
      rejectSecrets(value, `${pathLabel}.${key}`);
      continue;
    }
    if (SECRET_KEY.test(key)) throw new Error(`${pathLabel} must not inline secrets (${key}).`);
    if (typeof value === 'string' && /-----BEGIN |\bsk-|xox[pabs]-/i.test(value)) {
      throw new Error(`${pathLabel}.${key} looks like an inlined secret.`);
    }
    if (isPlainObject(value) || Array.isArray(value)) rejectSecrets(value, `${pathLabel}.${key}`);
  }
}

export function expandSpecFields(fields = []) {
  const expanded = [];
  for (const field of fields) {
    if (field?.count && /…|\.\.\./.test(field.name || '')) {
      const match = String(field.name).match(/^(.*?)(\d+)\s*(?:…|\.\.\.)\s*-?\s*(\d+)\s*$/);
      if (!match) throw new Error(`Cannot expand display-field range: ${field.name}`);
      const [, prefix, startText, endText] = match;
      const start = Number(startText);
      const end = Number(endText);
      const width = startText.length;
      if (end - start + 1 !== Number(field.count)) {
        throw new Error(`Display-field count ${field.count} does not match ${start}–${end}.`);
      }
      for (let i = start; i <= end; i++) {
        expanded.push({
          ...field,
          name: `${prefix}${String(i).padStart(width, '0')}`,
          count: undefined,
          role: field.role || 'display',
        });
      }
      continue;
    }
    expanded.push({ ...field, role: field.role || 'filter' });
  }
  return expanded;
}

function optionLabels(field) {
  return (field.options || []).map((option) => (typeof option === 'string' ? option : option?.value)).filter(Boolean);
}

export function optionValueFor(field, shorthand) {
  if (shorthand == null || shorthand === '') return shorthand;
  const options = optionLabels(field);
  if (options.includes(shorthand)) return shorthand;
  const suffix = `-${shorthand}`;
  const hits = options.filter((option) => option.endsWith(suffix));
  if (hits.length === 1) return hits[0];
  if (options.length === 0) {
    const type = canonicalizeFieldType(field.type);
    return `${type}-${shorthand}`;
  }
  throw new Error(`Cannot resolve option ${shorthand} for field ${field.name}`);
}

function fieldKeyCandidates(field) {
  const type = canonicalizeFieldType(field.type);
  const aliases = Object.keys(TYPE_ALIASES).filter((alias) => TYPE_ALIASES[alias] === type);
  return [...new Set([field.name, field.type, type, fieldKind(type), ...aliases])];
}

function inferredTextOptions(field, products) {
  const values = new Set();
  const keys = fieldKeyCandidates(field);
  for (const product of products || []) {
    const raw = keys.reduce((found, key) => found ?? product.fields?.[key] ?? product.values?.[key], undefined);
    for (const item of Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : []) values.add(item);
  }
  const typeName = canonicalizeFieldType(field.type);
  return [...values].map((value) => (optionsLooksFull(value, typeName) ? String(value) : `${typeName}-${value}`));
}

function optionsLooksFull(value, typeName) {
  return String(value).startsWith(typeName) || String(value).startsWith(typeName.replace(/字段$/, ''));
}

export function resolveProductFieldValues(product, fields) {
  const values = {};
  const raw = product.fields || product.values || {};
  for (const field of fields.filter((item) => (item.role || 'filter') === 'filter')) {
    const shortType = Object.keys(TYPE_ALIASES).find((alias) => TYPE_ALIASES[alias] === canonicalizeFieldType(field.type) && alias.length <= 2)
      || field.type;
    const entry = raw[field.name] ?? raw[field.type] ?? raw[canonicalizeFieldType(field.type)]
      ?? raw[shortType] ?? raw[fieldKind(field.type)];
    if (entry == null) {
      values[field.name] = fieldKind(field.type) === 'multi' ? [] : '';
      continue;
    }
    if (Array.isArray(entry)) values[field.name] = entry.map((item) => optionValueFor(field, item));
    else values[field.name] = optionValueFor(field, entry);
  }
  return values;
}

function walkExpected(node, visit, path = '') {
  if (Array.isArray(node)) {
    visit(path, node);
    return;
  }
  if (!isPlainObject(node)) {
    visit(path, node);
    return;
  }
  visit(path, node);
  for (const [key, value] of Object.entries(node)) {
    if (['precondition', 'question', 'note', 'reason', 'rule', 'status'].includes(key)) continue;
    walkExpected(value, visit, path ? `${path}/${key}` : key);
  }
}

export function extractRecordOnlyItems(spec = {}) {
  const items = [];
  const push = (item) => items.push(item);
  for (const topic of spec.deferred || []) push({ topic, status: '暂缓', recordOnly: true });
  for (const question of spec.openQuestions || []) {
    if (/完全一致还是包含|文本字段筛选是/.test(question)) {
      push({ topic: 'text-match-mode', status: '待确认', pending: true, mode: 'exact', question, recordOnly: false });
    } else if (/上限/.test(question)) {
      push({ topic: question, status: '待确认', recordOnly: true });
    } else if (/使用筛选条件/.test(question)) {
      push({ topic: '使用筛选条件-组合', status: '待确认', recordOnly: true, question });
    }
  }
  walkExpected(spec.expectedBySetting, (path, node) => {
    if (isPlainObject(node) && isDeferredStatus(node.status)) {
      push({ path, status: node.status, recordOnly: true, question: node.question, reason: node.reason, candidates: node.candidates });
    }
  });
  return items;
}

export function expectedEntry(value) {
  if (Array.isArray(value)) return { expected: value, emptyAllowed: true, recordOnly: false };
  if (value == null) return { expected: null, recordOnly: true };
  if (isPlainObject(value)) {
    const expected = Object.prototype.hasOwnProperty.call(value, 'expected') ? value.expected : value;
    const status = value.status;
    return {
      expected: Array.isArray(expected) || expected == null || typeof expected === 'object' ? expected : expected,
      recordOnly: isDeferredStatus(status),
      pending: isPendingStatus(status) || /完全一致还是包含/.test(`${value.note || ''} ${value.reason || ''}`),
      textMatch: /完全一致/.test(value.note || '') ? 'exact' : undefined,
      status,
      rule: value.rule,
      mustNotContain: value.mustNotContain,
      question: value.question,
      candidates: value.candidates,
      note: value.note,
      emptyAllowed: Array.isArray(expected),
    };
  }
  return { expected: value, recordOnly: false };
}

export function listFilterExpectations(specOrState) {
  const filter = specOrState?.expectedBySetting?.filter || {};
  return Object.entries(filter)
    .filter(([key]) => key !== 'precondition')
    .map(([key, value]) => ({ key, ...expectedEntry(value) }));
}

export function assertEmptyExpectedSupported(expectations) {
  const empty = expectations.filter((item) => Array.isArray(item.expected) && item.expected.length === 0);
  if (!empty.length) throw new Error('Expected at least one empty result set (cross-field intersection may be empty).');
  return empty;
}

export function validateFixtureSpec(spec) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!isPlainObject(spec)) return [{ path: '', message: 'fixture spec must be an object' }];
  if (spec.kind !== 'fixture-spec') add('kind', 'must be "fixture-spec"');
  const values = spec.designSources?.dataSourceOptions?.values;
  if (!Array.isArray(values) || DATA_SOURCE_OPTIONS.some((option) => !values.includes(option))) {
    add('designSources.dataSourceOptions.values', `must include ${DATA_SOURCE_OPTIONS.join(', ')}`);
  }
  const fixed = spec.designSources?.filterSettingsFixed?.values;
  for (const [key, value] of Object.entries(FILTER_SETTINGS_FIXED)) {
    if (fixed?.[key] !== value) add(`designSources.filterSettingsFixed.values.${key}`, `must be ${value}`);
  }
  if (!Array.isArray(spec.fields) || !spec.fields.length) add('fields', 'must be a non-empty array');
  else {
    try {
      const expanded = expandSpecFields(spec.fields);
      const filterFields = expanded.filter((field) => (field.role || 'filter') === 'filter');
      const kinds = new Set(filterFields.map((field) => fieldKind(field.type)));
      for (const kind of ['dropdown', 'radio', 'multi', 'text']) {
        if (!kinds.has(kind)) add('fields', `missing ${kind} field`);
      }
      const multi = filterFields.find((field) => fieldKind(field.type) === 'multi');
      if (multi && !(multi.options || []).some((option) => /(?:^|-)C$/.test(option))) {
        add('fields', 'multi-select field must include option C');
      }
    } catch (error) {
      add('fields', error.message);
    }
  }
  if (!Array.isArray(spec.categories) || spec.categories.length < 2) add('categories', 'at least 2 categories are required');
  if (!Array.isArray(spec.products) || spec.products.length < 2) add('products', 'at least 2 products are required');
  else {
    for (const [index, product] of spec.products.entries()) {
      if (!AUTOTEST.test(product.name || '')) add(`products[${index}].name`, 'must start with AUTOTEST-');
      const flags = product.flags || [];
      if (!Array.isArray(flags) || flags.some((flag) => !PRODUCT_FLAG_VALUES.includes(flag))) {
        add(`products[${index}].flags`, `flags must be a subset of ${PRODUCT_FLAG_VALUES.join(', ')}`);
      }
    }
  }
  if (!isPlainObject(spec.expectedBySetting)) add('expectedBySetting', 'is required');
  else {
    if (!spec.expectedBySetting.dataSource) add('expectedBySetting.dataSource', 'is required');
    if (!spec.expectedBySetting.pagination) add('expectedBySetting.pagination', 'is required');
    if (!spec.expectedBySetting.filter) add('expectedBySetting.filter', 'is required');
    const combinations = listFilterExpectations(spec).filter((item) => /且|同时选/.test(item.key));
    if (combinations.length < 4) add('expectedBySetting.filter', 'expected at least 4 combination cases');
    const empty = listFilterExpectations(spec).find((item) => /下拉=B\s*且\s*多选=B/.test(item.key));
    if (!empty || !Array.isArray(empty.expected) || empty.expected.length !== 0) {
      add('expectedBySetting.filter', '「下拉=B 且 多选=B」must be an empty expected set');
    }
  }
  rejectSecrets(spec, 'spec');
  return errors;
}

export function loadFixtureSpec(file) {
  const spec = loadJsonFile(file);
  const errors = validateFixtureSpec(spec);
  if (errors.length) {
    const error = new Error(`Invalid fixture spec: ${errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    error.errors = errors;
    throw error;
  }
  return spec;
}

export function validateCredentialPointer(pointer) {
  if (!isPlainObject(pointer) || !pointer.kind) throw new Error('site.credentialConfig must be a pointer with a kind, never inlined secrets.');
  if (!['env-file', 'env', 'profile'].includes(pointer.kind)) throw new Error(`Unsupported credential pointer kind: ${pointer.kind}`);
  rejectSecrets(pointer, 'site.credentialConfig');
  return pointer;
}

export function validateFixtureState(state) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!isPlainObject(state)) return [{ path: '', message: 'fixture-state must be an object' }];
  if (!isPlainObject(state.site) || !state.site.domain || !state.site.siteId) add('site', 'domain and siteId are required');
  try { if (state.site?.credentialConfig) validateCredentialPointer(state.site.credentialConfig); }
  catch (error) { add('site.credentialConfig', error.message); }
  if (!isPlainObject(state.blocks) || !Object.keys(state.blocks).length) add('blocks', 'at least one per-block test page is required');
  else {
    for (const [key, block] of Object.entries(state.blocks)) {
      if (!block?.blockId || !block.page?.id || !block.page?.url || !block.page?.kind) {
        add(`blocks.${key}`, 'blockId and page.id/url/kind are required');
      }
    }
  }
  if (!Array.isArray(state.fields) || !state.fields.length) add('fields', 'required');
  else {
    for (const [index, field] of state.fields.entries()) {
      if (!AUTOTEST.test(field.name || '')) add(`fields[${index}].name`, 'must start with AUTOTEST-');
      if (!field.type || !field.kind) add(`fields[${index}]`, 'type and kind are required');
      if ((field.role || 'filter') === 'filter' && field.kind !== 'text' && (!Array.isArray(field.options) || field.options.length < 2)) {
        add(`fields[${index}].options`, 'enumerated filter fields need at least two options');
      }
    }
  }
  if (!Array.isArray(state.categories) || state.categories.length < 2) add('categories', 'at least 2 categories are required');
  if (!Array.isArray(state.products) || state.products.length < 2) add('products', 'required');
  else {
    for (const [index, product] of state.products.entries()) {
      if (!AUTOTEST.test(product.name || '')) add(`products[${index}].name`, 'must start with AUTOTEST-');
      const flags = product.flags || [];
      if (!Array.isArray(flags) || flags.some((flag) => !PRODUCT_FLAG_VALUES.includes(flag))) {
        add(`products[${index}].flags`, 'invalid product flag');
      }
    }
  }
  if (!Array.isArray(state.partialProducts)) add('partialProducts', 'required (may be empty only if unused, but the key must exist)');
  if (!isPlainObject(state.expectedBySetting)) add('expectedBySetting', 'required');
  if (state.lastCheckedAt != null && Number.isNaN(Date.parse(state.lastCheckedAt))) add('lastCheckedAt', 'must be an ISO timestamp or null');
  rejectSecrets(state, 'fixture-state');
  return errors;
}

export function loadFixtureState(file) {
  const state = loadJsonFile(file);
  const errors = validateFixtureState(state);
  if (errors.length) {
    const error = new Error(`Invalid fixture-state: ${errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    error.errors = errors;
    throw error;
  }
  return state;
}

function categoryRefName(product, categories) {
  const ref = product.category;
  if (!ref) return null;
  const exact = categories.find((category) => category.name === ref || category.name === `AUTOTEST-${ref}` || category.reuseName === ref);
  return exact?.name || (AUTOTEST.test(ref) ? ref : `AUTOTEST-${ref}`);
}

export function recordsFromExistingReport(report) {
  const collect = [];
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.fields && node.products && (node.category || node.categories) && (path.includes('records') || path.includes('fixture'))) {
      collect.push(node);
    }
    if (Array.isArray(node)) node.forEach((item, index) => visit(item, `${path}[${index}]`));
    else Object.entries(node).forEach(([key, value]) => visit(value, `${path}.${key}`));
  };
  visit(report, 'report');
  const records = collect[0] || report?.fixture?.records || report?.['fixture-prep-data']?.evidence?.records || null;
  if (!records) return { fields: {}, products: {}, categories: {} };
  const categories = {};
  if (records.category?.id) categories[records.category.name] = records.category.id;
  if (isPlainObject(records.categories)) {
    for (const [name, value] of Object.entries(records.categories)) {
      categories[name] = typeof value === 'string' ? value : value?.id;
    }
  }
  return { fields: { ...records.fields }, products: { ...records.products }, categories };
}

export function fixtureStateFromSpec(spec, {
  records = { fields: {}, products: {}, categories: {} },
  site,
  blocks,
  lastCheckedAt = null,
  fieldLimit = null,
  existingFieldCount = null,
  existingFieldNames = [],
  createdDisplayFields = null,
} = {}) {
  const errors = validateFixtureSpec(spec);
  if (errors.length) {
    const error = new Error(`Invalid fixture spec: ${errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    error.errors = errors;
    throw error;
  }
  if (!site?.domain || !site?.siteId || !site?.credentialConfig) {
    throw new Error('fixture-state requires site.domain, site.siteId and a credentialConfig pointer.');
  }
  validateCredentialPointer(site.credentialConfig);
  if (!isPlainObject(blocks) || !Object.keys(blocks).length) throw new Error('fixture-state requires at least one per-block test page.');

  let expanded = expandSpecFields(spec.fields);
  const display = expanded.filter((field) => field.role === 'display');
  const filter = expanded.filter((field) => field.role !== 'display');
  const known = new Set(existingFieldNames);
  const missingFilter = filter.filter((field) => !known.has(field.name)).length;
  const existingDisplay = display.filter((field) => known.has(field.name));
  const newDisplay = display.filter((field) => !known.has(field.name));
  let free = null;
  if (fieldLimit != null) {
    free = existingFieldCount != null
      ? Math.max(0, Number(fieldLimit) - Number(existingFieldCount) - missingFilter)
      : Math.max(0, Number(fieldLimit) - filter.length - existingDisplay.length);
  }
  const allowedDisplay = free == null ? display : [...existingDisplay, ...newDisplay.slice(0, free)];
  expanded = [...filter, ...allowedDisplay];
  const fieldLimitReport = {
    maxFields: fieldLimit == null ? null : Number(fieldLimit),
    existingFieldCount: existingFieldCount == null ? null : Number(existingFieldCount),
    requestedDisplayFields: display.length,
    plannedDisplayFields: allowedDisplay.length,
    shortfall: display.length - allowedDisplay.length,
    source: fieldLimit == null ? 'unknown' : 'site',
  };

  const fields = expanded.map((field) => {
    const type = canonicalizeFieldType(field.type);
    const options = (field.options && field.options.length)
      ? field.options
      : (type === '文本字段' ? inferredTextOptions({ ...field, type }, spec.products) : []);
    const optionEntries = options.map((value) => ({
      value,
      id: field.optionIds?.[value] || records.fieldOptions?.[field.name]?.[value] || null,
    }));
    return {
      name: requireAutotest(field.name, 'Field'),
      type,
      kind: FIELD_KIND[type],
      role: field.role || 'filter',
      id: field.id || field.reuseId || records.fields?.[field.name] || null,
      options: optionEntries,
      purpose: field.purpose,
      status: field.status,
    };
  });

  const categories = spec.categories.map((category) => ({
    name: category.name,
    reuseName: category.reuseName || null,
    id: category.id || category.reuseId || records.categories?.[category.name]
      || records.categories?.[category.reuseName] || null,
    note: category.note,
  }));
  if (categories.length < 2) throw new Error('At least 2 categories are required.');

  const products = spec.products.map((product) => ({
    name: requireAutotest(product.name, 'Product'),
    id: product.id || product.reuseId || records.products?.[product.name] || null,
    category: categoryRefName(product, categories),
    values: resolveProductFieldValues(product, expanded),
    flags: [...(product.flags || [])],
    tag: Boolean(product.tag),
    longName: Boolean(product.longName),
    displayFields: product.displayFields || null,
    note: product.note,
  }));

  const specified = spec.expectedBySetting?.dataSource?.['选择指定产品=[基准,翻转2,分类B-1]']
    || Object.entries(spec.expectedBySetting?.dataSource || {}).find(([key]) => key.startsWith('选择指定产品='))?.[1];
  const partialNames = Array.isArray(specified?.expected) ? specified.expected : [];
  const partialProducts = partialNames.map((short) => {
    const hits = products.filter((product) => product.name === short || product.name.endsWith(short) || product.name.includes(short));
    return { name: hits[0]?.name || short, id: hits[0]?.id || null };
  });

  return {
    site,
    blocks,
    fields,
    categories,
    products,
    partialProducts,
    expectedBySetting: spec.expectedBySetting,
    filterSettingsFixed: { ...FILTER_SETTINGS_FIXED, ...spec.designSources.filterSettingsFixed.values },
    dataSourceOptions: [...DATA_SOURCE_OPTIONS],
    dataSourceControls: spec.designSources.dataSourceOptions.useFilterConditionsUI || null,
    deferred: [...(spec.deferred || [])],
    recordOnly: extractRecordOnlyItems(spec),
    textMatch: (spec.decisions || []).some((item) => /文本字段匹配/.test(item.topic || '') && /已确认/.test(item.decision || ''))
      ? { mode: 'exact', status: 'confirmed' }
      : { mode: 'exact', status: 'pending', note: 'Text match is exact for now; exact vs contains remains pending.' },
    lastCheckedAt,
    fieldLimit,
    omittedDisplayFields: display.filter((field) => !allowedDisplay.includes(field)).map((field) => field.name),
    fieldLimitReport,
    createdDisplayFields,
    flagsNote: spec.flagsNote || null,
    decisions: spec.decisions || [],
  };
}

export function loadFilterChecklistDraft(file) {
  const draft = loadJsonFile(file);
  if (!isPlainObject(draft) || !Array.isArray(draft.requirements)) {
    throw new Error('Filter checklist draft must be an object with a requirements array.');
  }
  const requirements = draft.requirements.map((item) => ({
    ...item,
    params: item.params || {},
    expected: item.expected === undefined ? null : item.expected,
  }));
  return { ...draft, requirements };
}

export function writeFixtureState(file, state) {
  const errors = validateFixtureState(state);
  if (errors.length) {
    const error = new Error(`Invalid fixture-state: ${errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    error.errors = errors;
    throw error;
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}
