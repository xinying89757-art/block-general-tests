// Helpers for the block-level right icon rail (.siteblocks-setting-
// operateTools), which lives inside the canvas iframe, not in the main
// page and not in a settings dialog. One rail per block on the page; only
// the selected block's rail is visible (30px wide, right edge). Clicking
// an icon opens a flyout panel to its left; again only the selected
// block's copy is visible.
import { TIMEOUT, poll } from './shared.mjs';
import { waitForControlsReady, retryTransient, saveAndWait } from '../ui-waits.mjs';

export const RAIL = {
  wrap: (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`,
  rail: '.siteblocks-setting-operateTools',
  colorIcon: '.backstage-container-color a',
  widthIcon: '.block_telescopic',
  colorPanel: '.siteblocks-setting-operateColor',
  widthPanel: '.moduleWidth',
  colorInput: 'input.siteblocks-setting-color',
  colorSave: '.siteblocks-background-operateSave',
  colorReset: '.siteblocks-color-operateReset',
};

// The visible rail: exactly one operateTools element is rendered at 30px
// width when its block is selected; the others are 0x0. The rail renders
// asynchronously after selection, so a single synchronous read right
// after the click intermittently finds nothing (2026-10-26: the color
// module's first openRailPanel and the width module's flip both hit this
// in the same run, while the width module's first open worked). Poll
// instead of reading once.
export async function selectBlock(canvas, blockId) {
  const wrap = canvas.locator(RAIL.wrap(blockId)).first();
  await wrap.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 2; attempt++) {
    await wrap.click({ timeout: TIMEOUT });
    try { return await visibleRailIndex(canvas); }
    catch { /* retry the click once, then fall through to the error */ }
  }
  return visibleRailIndex(canvas);
}

export async function visibleRailIndex(canvas) {
  const found = await poll(
    () => canvas.locator('body').evaluate((body) => {
      const rails = [...body.ownerDocument.querySelectorAll('.siteblocks-setting-operateTools')];
      return rails.findIndex((el) => el.offsetWidth > 0 && el.offsetWidth < 100);
    }),
    (index) => index >= 0,
  );
  if (!found.matched) throw new Error('未找到已选区块的右侧图标栏（可能未选中区块）。');
  return found.value;
}

export async function openRailPanel(canvas, blockId, iconSelector, panelSelector) {
  // If the panel is already open, do not click its icon again: the icon
  // toggles, and a second click closes the panel (2026-10-26: the color
  // flip's reopen waited 10s on a panel its own icon click had just
  // closed). The runner only ever selects the target block, so a visible
  // panel here is the target block's.
  const alreadyOpen = canvas.locator(`${panelSelector}:visible`).first();
  if (await alreadyOpen.isVisible().catch(() => false)) {
    const index = await visibleRailIndex(canvas);
    await retryTransient(() => waitForControlsReady(alreadyOpen));
    return { rail: canvas.locator(RAIL.rail).nth(index), panel: alreadyOpen, index };
  }
  await selectBlock(canvas, blockId);
  const index = await visibleRailIndex(canvas);
  const rail = canvas.locator(RAIL.rail).nth(index);
  const icon = rail.locator(iconSelector).first();
  await icon.scrollIntoViewIfNeeded();
  await icon.click({ timeout: TIMEOUT });
  // Several panel copies exist (one per block); only the selected block's
  // copy is visible.
  const panel = canvas.locator(`${panelSelector}:visible`).first();
  try {
    await panel.waitFor({ state: 'visible', timeout: TIMEOUT });
  } catch {
    // The click may have toggled an already-open panel closed; click once
    // more to reopen it.
    await icon.click({ timeout: TIMEOUT });
    await panel.waitFor({ state: 'visible', timeout: TIMEOUT });
  }
  await retryTransient(() => waitForControlsReady(panel));
  return { rail, panel, index };
}

// Read the color scheme value from the visible color flyout.
export async function readSchemeColor(canvas) {
  const panel = canvas.locator(`${RAIL.colorPanel}:visible`).first();
  await retryTransient(() => waitForControlsReady(panel));
  return panel.locator(RAIL.colorInput).inputValue({ timeout: TIMEOUT });
}

// Set the scheme color through the Spectrum jQuery API (same approach as
// the 40838 background-color closed loop), falling back to the Spectrum
// popup UI inside the canvas frame. Two lessons from 2026-10-26:
// (1) the API must run on the visible panel's exact input element, not
// on the first `.siteblocks-setting-operateColor input` in document
// order (there are several, including hidden ones from other blocks);
// (2) Spectrum writes the value back in rgb() form, so the readback
// comparison must normalize hex and rgb to the same form, otherwise a
// successful API set looks like a failure and the run falls through to
// the popup path.
export function normalizeColor(value) {
  const text = String(value || '').trim().toLowerCase();
  const rgb = text.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    return `#${[1, 2, 3].map((i) => Number(rgb[i]).toString(16).padStart(2, '0')).join('')}`;
  }
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1];
    return h.length === 3 ? `#${[...h].map((c) => c + c).join('')}` : `#${h}`;
  }
  return text;
}

export async function setSchemeColor(canvas, value) {
  const panel = canvas.locator(`${RAIL.colorPanel}:visible`).first();
  const input = panel.locator(RAIL.colorInput);
  const read = () => input.inputValue({ timeout: TIMEOUT });
  const matches = (actual) => normalizeColor(actual) === normalizeColor(value);
  const set = async (color) => {
    let apiError = '';
    try {
      const api = await input.evaluate((el, colorValue) => {
        const win = el.ownerDocument.defaultView;
        const jq = win.jQuery || win.$;
        if (!jq || !jq.fn || typeof jq.fn.spectrum !== 'function') return { available: false };
        jq(el).spectrum('set', colorValue);
        jq(el).trigger('change');
        return { available: true, value: el.value };
      }, color);
      const applied = await poll(read, matches);
      if (api.available && applied.matched) return 'Spectrum API';
      apiError = api.available ? `API 后值为 ${JSON.stringify(applied.value)}` : '画布内没有可用的 Spectrum jQuery API';
    } catch (error) { apiError = error.message; }
    // Fallback: open the Spectrum popup from the replacer and type the value.
    // Scope every step to the container that actually opened: several
    // .sp-container copies exist (one per Spectrum instance on the page),
    // and the global `:visible` selectors can resolve to a different
    // instance's controls.
    await panel.locator('.sp-replacer').click({ timeout: TIMEOUT });
    const openIndex = await poll(
      () => canvas.locator('body').evaluate((body) => {
        const list = [...body.ownerDocument.querySelectorAll('.sp-container')];
        return list.findIndex((el) => getComputedStyle(el).display !== 'none' && el.offsetWidth > 0);
      }),
      (index) => index >= 0,
    );
    if (!openIndex.matched) throw new Error(`Spectrum API 失败（${apiError}）；点取色器后未出现取色弹窗`);
    const popup = canvas.locator('.sp-container').nth(openIndex.value);
    const popupInput = popup.locator('.sp-input');
    await popupInput.waitFor({ state: 'visible', timeout: TIMEOUT });
    await popupInput.fill(color, { timeout: TIMEOUT });
    await popup.locator('.sp-choose').click({ timeout: TIMEOUT });
    const applied = await poll(read, matches);
    if (!applied.matched) throw new Error(`Spectrum API 失败（${apiError}）；取色面板降级失败，改写后值为 ${JSON.stringify(applied.value)}`);
    return 'Spectrum 面板';
  };
  return set(value);
}

export async function saveColorPanel(canvas) {
  const panel = canvas.locator(`${RAIL.colorPanel}:visible`).first();
  await saveAndWait(panel.page(), () => panel.locator(RAIL.colorSave).click({ timeout: TIMEOUT }));
}

// Read the module-width state from the visible width flyout: which radio
// is checked, the custom value, and the effective width in px
// ('fullscreen' for 全屏). The default is stored as 自定义 1440, not as
// the 1440px preset, so the effective value is what matters.
export async function readModuleWidth(canvas) {
  const panel = canvas.locator(`${RAIL.widthPanel}:visible`).first();
  await retryTransient(() => waitForControlsReady(panel));
  const data = await panel.evaluate((el) => {
    const radios = [...el.querySelectorAll("input[name='modulewidth']")].map((r) => ({
      value: r.value, label: (r.closest('label')?.innerText || '').trim(), checked: r.checked }));
    const custom = el.querySelector('.customizeVal');
    return { radios, customVal: custom ? custom.value : null,
      globalApply: el.querySelector("input[name='globalApply']")?.checked ?? null };
  });
  const checked = data.radios.find((r) => r.checked);
  let effective = null;
  if (checked) {
    if (checked.value === '-1') effective = data.customVal ? Number(data.customVal) : null;
    else if (checked.value === '-2') effective = 'fullscreen';
    else effective = Number(checked.label.replace(/[^0-9]/g, ''));
  }
  return { ...data, checked, effective };
}

// Set the width by preset label ('1200px', '1440px', ...) or custom value.
// Does not save; the caller clicks the flyout's 保存.
export async function setModuleWidth(canvas, { preset, custom }) {
  const panel = canvas.locator(`${RAIL.widthPanel}:visible`).first();
  if (preset) {
    const target = panel.locator('label', { hasText: preset }).first().locator('input');
    await target.scrollIntoViewIfNeeded();
    await target.click({ force: true, timeout: TIMEOUT });
  } else if (custom !== undefined) {
    const customRadio = panel.locator("input[name='modulewidth'][value='-1']");
    await customRadio.click({ force: true, timeout: TIMEOUT });
    const input = panel.locator('.customizeVal');
    await input.fill(String(custom), { timeout: TIMEOUT });
  }
}

export async function saveWidthPanel(canvas) {
  const panel = canvas.locator(`${RAIL.widthPanel}:visible`).first();
  const save = panel.getByText('保存', { exact: true }).first();
  await saveAndWait(panel.page(), () => save.click({ timeout: TIMEOUT }));
}

export async function cancelWidthPanel(canvas) {
  const panel = canvas.locator(`${RAIL.widthPanel}:visible`).first();
  const cancel = panel.getByText('取消', { exact: true }).first();
  await cancel.click({ timeout: TIMEOUT });
}
