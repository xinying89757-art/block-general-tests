import { displayFieldControls, isSystemAttribute } from './capabilities/signatures.mjs';

export function inferDisplayFieldTypes(controls, cmsFields) {
  if (!Array.isArray(cmsFields)) return { supportedTypes: null, fields: [], reason: '无法只读取得 CMS 自定义字段列表。' };
  if (!controls?.length) return { supportedTypes: null, fields: [], reason: '未能识别展示字段复选框组。' };
  const fields = [];
  for (const c of controls) {
    const label = typeof c === 'string' ? c : c.label;
    if (!label) continue;
    const found = cmsFields.filter(f => f.name?.trim() === label.trim());
    if (typeof c === 'object' && isSystemAttribute(c)) continue; // system attribute, not a custom field
    fields.push({ label, type: found.length === 1 && found[0].type ? found[0].type : null });
  }
  if (fields.some(f => !f.type)) return { supportedTypes: null, fields, reason: '部分字段在 CMS 列表中无法唯一匹配或缺少类型。' };
  if (!fields.length) return { supportedTypes: null, fields, reason: '未观察到可与 CMS 对照的自定义字段，不能推断支持类型。' };
  return { supportedTypes: [...new Set(fields.map(f => f.type))].sort(), fields, reason: null };
}
export function inspectDisplayFields(inventory, matched, cmsFields) {
  const regions = matched.filter(m => m.id === 'pld-display-fields');
  if (!regions.length) return inferDisplayFieldTypes([], cmsFields);
  return inferDisplayFieldTypes(regions.flatMap(m => displayFieldControls(inventory.find(r => r.type === m.type && r.wrapIndex === m.wrapIndex) || {})), cmsFields);
}
export function compareWithProfile(draft, profile) {
  if (!profile) return { available: false, comparisons: [] };
  const items = [];
  const add = (subject, observed, expected, comparable = true) => items.push({ subject, observed, expected, status: comparable ? (JSON.stringify(observed) === JSON.stringify(expected) ? '一致' : '不一致') : '无法比较' });
  const actual = [...new Set((draft.matched || []).map(m => m.parentModule))].sort();
  const expected = (profile.capabilities || []).map(c => c.id).sort();
  add('capabilities 模块列表', actual, expected);
  for (const cap of profile.capabilities || []) {
    const found = (draft.matched || []).filter(m => m.parentModule === cap.id);
    for (const [key, prop] of [['dialogTitle', 'title'], ['wrapIndex', 'wrapIndex']]) {
      if (cap[key] !== undefined) {
        const values = [...new Set(found.map(m => m[prop]))];
        add(`${cap.id}.${key}`, values.length === 1 ? values[0] : values, cap[key], values.length > 0);
      }
    }
  }
  const types = draft.displayFields?.supportedTypes;
  const wanted = profile.fixture?.displayFields?.supportedTypes;
  add('fixture.displayFields.supportedTypes', Array.isArray(types) ? [...types].sort() : null,
    Array.isArray(wanted) ? [...wanted].sort() : null, Array.isArray(types) && Array.isArray(wanted));
  return { available: true, comparisons: items };
}
