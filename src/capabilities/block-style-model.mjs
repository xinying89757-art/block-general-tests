export const normColor = (c) => {
  const m = (c || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return (c || '').toLowerCase();
  const [r, g, b] = m[1].split(',').map((x) => parseInt(x.trim(), 10));
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const px = (v) => {
  const n = parseFloat(String(v ?? '').replace('px', ''));
  return Number.isFinite(n) ? n : null;
};
// Size measurements are rounded to CSS pixels in the reader. A delta strictly
// below the configured tolerance is accepted; a full 2px delta remains visible
// as a mismatch (e.g. 30px vs 28px with the default tolerance).
const close = (a, b, tol, exclusive = false) => a != null && b != null
  && (exclusive ? Math.abs(a - b) < tol : Math.abs(a - b) <= tol);

const SIZE_PROPERTIES = new Set(['fontSize', 'borderRadius', 'letterSpacing', 'width', 'height']);

export function compareProps(expected, actual, tolerances = {}) {
  const diffs = [];
  const { px = 0.6, sizePx = 2 } = typeof tolerances === 'number' ? { px: tolerances, sizePx: tolerances } : tolerances;
  const names = { fontSize: '字号', fontWeight: '字重', color: '文字颜色',
    backgroundColor: '背景色', borderColor: '边框色', borderRadius: '圆角', textAlign: '对齐方式',
    letterSpacing: '字距', width: '宽', height: '高' };
  for (const [k, want] of Object.entries(expected)) {
    // Product policy: line-height is informational only, including legacy
    // style expectations for button and pagination controls.
    if (k === 'lineHeight' || k === 'line-height') continue;
    const got = actual[k];
    let ok;
    if (typeof want === 'number') ok = close(got, want, SIZE_PROPERTIES.has(k) ? sizePx : px, SIZE_PROPERTIES.has(k));
    else ok = String(got ?? '').toLowerCase() === String(want).toLowerCase();
    const unit = ['fontSize', 'borderRadius', 'letterSpacing', 'width', 'height'].includes(k) ? 'px' : '';
    const shownWant = typeof want === 'number' ? `${want}${unit}` : want;
    const measured = got == null ? '实测未取到' : `实测为 ${typeof got === 'number' ? `${got}${unit}` : got}`;
    if (!ok) diffs.push(`${names[k] || k}设计为 ${shownWant}，${measured}`);
  }
  return diffs;
}

export const PAGINATION_CONTAINER_PATTERN = 'pagination|pager|page[-_ ]?nav|分页';
export function isPaginationContainerMetadata({ tagName = '', role = '', ariaLabel = '', id = '', className = '' } = {}) {
  return new RegExp(PAGINATION_CONTAINER_PATTERN, 'i').test([tagName, role, ariaLabel, id, className].join(' '));
}

