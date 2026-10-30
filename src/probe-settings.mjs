import { displayFieldControls, matchCapabilities, signatures } from './capabilities/signatures.mjs';

// params narrow the signature's region without changing its control rule.
export function checkRequirements(inventory, requirements) {
  const requested = Array.isArray(requirements?.capabilities) ? requirements.capabilities : [];
  const rules = requested.map(({ id, params = {} }) => {
    const signature = signatures.find(r => r.id === id);
    if (!signature) return null;
    return { ...signature, region: { ...signature.region, ...(params.dialogTitle !== undefined ? { expectedTitle: params.dialogTitle } : {}), ...(params.wrapIndex !== undefined ? { wrapIndex: params.wrapIndex } : {}) } };
  }).filter(Boolean);
  const result = matchCapabilities(inventory, rules);
  const requirementCheck = requested.map(({ id }) => {
    const hits = result.matched.filter(m => m.id === id);
    if (!hits.length) return { id, status: 'missing', location: null, evidence: [] };
    // Keep all locations when a rule matches more than one region.
    const locations = hits.map(({ kind, type, wrapIndex, title }) => ({ kind, type, wrapIndex, title: title ?? null }));
    return { id, status: 'located', location: locations[0], ...(locations.length > 1 ? { locations } : {}), evidence: hits.flatMap(m => m.evidence), ...(hits.find(m => m.dependsOn) ? { dependsOn: hits.find(m => m.dependsOn).dependsOn } : {}) };
  });
  return { requirementCheck, outOfScope: result.unrecognized, requirementMessage: requested.length ? null : '需求未提供，需人工补充' };
}

export function checkDisplayFieldRequirement(inventory, profile) {
  const required = profile?.requirements?.displayFieldTypes;
  if (!Array.isArray(required) || !required.length) return { status: 'missing-requirement', message: '需求未提供，需人工补充', types: [] };
  const regions = inventory.filter(r => r.type === 'phoenix_blocks_gallery' && r.title === '设置产品列表');
  const controls = regions.flatMap(displayFieldControls);
  const fixtures = profile?.fixture?.displayFields?.fields || [];
  const types = [...new Set(required)].map(type => {
    const fields = fixtures.filter(f => f.type === type && typeof f.name === 'string' && f.name.startsWith('AUTOTEST-'));
    if (fields.length !== 1) return { type, status: 'unknown', message: fields.length ? '夹具该类型字段不唯一，需人工确认' : '夹具缺该类型字段，需先准备夹具' };
    const matches = controls.filter(c => c.label?.trim() === fields[0].name.trim());
    if (!matches.length) return { type, field: fields[0].name, status: 'unknown', message: controls.length ? '复选框中未找到夹具字段；若夹具未建，先运行 fixture 准备' : '未识别“设置产品列表”的显示字段复选框；若夹具未建，先运行 fixture 准备' };
    if (!matches.some(c => !c.disabled)) return { type, field: fields[0].name, status: 'problem', message: '夹具字段复选框存在但不可勾选' };
    return { type, field: fields[0].name, status: 'ok', message: '夹具字段复选框可勾选' };
  });
  return { status: types.some(t => t.status === 'problem') ? 'problem' : types.some(t => t.status === 'unknown') ? 'unknown' : 'ok', types };
}

export function compareWithProfile(draft, profile) {
  if (!profile) return { available: false, comparisons: [] };
  const comparisons = [];
  for (const cap of profile.capabilities || []) {
    const ids = signatures.filter(s => s.parentModule === cap.id).map(s => s.id);
    const found = (draft.requirementCheck || []).filter(c => ids.includes(c.id) && c.status === 'located').flatMap(c => c.locations || [c.location]);
    for (const [key, prop] of [['dialogTitle', 'title'], ['wrapIndex', 'wrapIndex']]) {
      if (cap[key] === undefined) continue;
      const values = [...new Set(found.map(m => m[prop]))];
      const observed = values.length === 1 ? values[0] : values;
      comparisons.push({ subject: `${cap.id}.${key}`, observed, expected: cap[key], status: !values.length ? '无法比较' : values.every(v => v === cap[key]) ? '一致' : '不一致' });
    }
  }
  return { available: true, comparisons };
}
