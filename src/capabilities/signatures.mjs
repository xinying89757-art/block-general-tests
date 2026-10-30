// Declarative, evidence-based hints, not assertions about hidden settings.
const gallery = { type: 'phoenix_blocks_gallery', title: /产品列表|选取数据/ };
const filter = { type: 'phoenix_blocks_filterStyle', title: /自定义字段筛选/ };
const button = { type: 'phoenix_blocks_button' };
const rule = (id, parentModule, region, control) => ({ id, parentModule, region, control });
export const signatures = [
  rule('pld-display-fields', 'product-list-display', gallery, { displayFields: true }),
  rule('pld-pagination', 'product-list-display', gallery, { type: 'radio', label: /^(是|否)$|分页/ }),
  rule('pld-page-size', 'product-list-display', gallery, { type: /^(text|number)$/, text: /每页|分页.*数量/ }),
  rule('pld-product-count', 'product-list-display', gallery, { type: /^(text|number)$/, text: /^(?!.*每页).*(?:产品(?:总)?数量|展示数量|显示数量)/ }),
  rule('pld-compare', 'product-list-display', gallery, { type: 'radio', label: /^(关闭|开启)$|产品对比/ }),
  rule('pld-data-source', 'product-list-display', gallery, { type: 'radio', label: /^(所有产品|部分产品|部分分类|指定产品)/ }),
  rule('cff-fields', 'custom-filter-fields', filter, { type: 'checkbox' }),
  rule('cff-logic', 'custom-filter-fields', filter, { type: 'radio', label: /^(交集|并集)/ }),
  rule('cff-trigger', 'custom-filter-fields', filter, { type: 'radio', label: /^(点击.*搜索|更改筛选项后自动)/ }),
  rule('cff-scope', 'custom-filter-fields', filter, { type: 'radio', label: /^(当前分类产品|所有产品)/ }),
  rule('cff-jump', 'custom-filter-fields', filter, { type: /select/, text: /跳转/ }),
  rule('cff-background', 'custom-filter-fields', filter, { text: /背景颜色/ }),
  rule('btn-text', 'button-link', button, { type: 'text', label: /按钮文本/ }),
  rule('btn-url', 'button-link', button, { type: 'text', label: /链接网址/ }),
  rule('btn-target', 'button-link', button, { type: 'checkbox', label: /新窗口打开/ }),
  rule('product-category', 'product-category-select', { type: 'phoenix_blocks_gallery', title: /产品分类/ }, { type: 'radio', label: /产品分类/ }),
  rule('color-scheme', 'block-color-scheme', { title: /区块配色|配色方案/ }, { text: /配色|颜色/ }),
  rule('module-width', 'module-width', { title: /模块宽度|模块展开/ }, { text: /1200|1440|1600|1920|全屏|自定义/ }),
];

const textOf = (c) => [c.label, c.context, c.value, ...(c.options || []).flatMap(o => typeof o === 'object' ? [o.label, o.value, o.text] : [o])].filter(v => v != null).join(' ');
const accepts = (pattern, value) => pattern == null || (pattern instanceof RegExp ? pattern.test(String(value ?? '')) : pattern === value);
// Display-field group, found by structure rather than names: the checkbox
// list that follows a "全选" select-all inside a gallery dialog. Duplicate
// copies (a hidden sortable template repeats every value) are dropped by value.
// System attributes carry non-positive numeric ids (e.g. -3); custom fields
// carry CMS ids. This is a structural hint, verified against the CMS list.
export const isSelectAll = (c) => c?.type === 'checkbox' && /^全选(?:\s|$)/.test(c.label || '');
export const isSystemAttribute = (c) => /^-\d+$/.test(String(c?.value ?? ''));
export function displayFieldControls(region) {
  const controls = region.controls || [];
  const start = controls.findIndex(isSelectAll);
  if (start < 0) return [];
  const result = [], seen = new Set();
  for (const c of controls.slice(start + 1)) {
    if (c.type !== 'checkbox' || isSelectAll(c)) break;
    const key = String(c.value ?? c.label);
    if (seen.has(key)) continue;
    seen.add(key); result.push(c);
  }
  return result;
}
// Structural noise that is never a setting by itself: hidden inputs (ids,
// serialized state) and select-all toggles; duplicate copies by name+value.
function isNoise(c, seen) {
  if (c.type === 'hidden' || isSelectAll(c)) return true;
  const key = `${c.type}|${c.name || ''}|${c.label || ''}|${c.value ?? ''}`;
  if (seen.has(key)) return true;
  seen.add(key); return false;
}
export function matchCapabilities(inventory, rules = signatures) {
  const matched = [], claimedIds = new Set(), unrecognized = [];
  for (const region of inventory) {
    const controls = region.controls || [];
    const claimed = new Set();
    let regionClaimed = false;
    for (const r of rules) {
      if (!accepts(r.region.type, region.type) || !accepts(r.region.title, region.title)) continue;
      const groupKey = (c) => `${c.type}|${c.name || ''}|${c.value ?? c.label}`;
      // The dialog also carries a hidden sortable copy of the same checkboxes;
      // claim every control with the same type+name+value as the group.
      const fields = r.control.displayFields ? new Set(displayFieldControls(region).map(groupKey)) : null;
      // A display-field group is only that when its dialog is a list dialog (gallery);
      // the filter dialog's field list is claimed by cff-fields.
      const hits = controls.filter(c => fields ? fields.has(groupKey(c)) : accepts(r.control.type, c.type)
        && accepts(r.control.label, c.label) && accepts(r.control.text, textOf(c)));
      if (!hits.length) continue;
      hits.forEach(c => claimed.add(c));
      regionClaimed = true; claimedIds.add(r.id);
      matched.push({ id: r.id, parentModule: r.parentModule, type: region.type, wrapIndex: region.wrapIndex,
        title: region.title, evidence: hits.map(c => ({ label: c.label || '', value: c.value ?? c.checked ?? null })) });
    }
    const seenNoise = new Set();
    const remaining = controls.filter(c => !claimed.has(c) && !isNoise(c, seenNoise));
    if (!regionClaimed || remaining.length) unrecognized.push({ type: region.type, wrapIndex: region.wrapIndex, title: region.title, controls: remaining, ...(region.skipped ? { skipped: region.skipped } : {}) });
  }
  return { matched, absent: rules.filter(r => !claimedIds.has(r.id)).map(({ id, parentModule }) => ({ id, parentModule })), unrecognized };
}
