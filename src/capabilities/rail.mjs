// Helpers for the block-level right icon rail (.siteblocks-setting-
// operateTools), which lives inside the canvas iframe, not in the main
// page and not in a settings dialog. One rail per block on the page; only
// the selected block's rail is visible (30px wide, right edge). Clicking
// an icon opens a flyout panel to its left; again only the selected
// block's copy is visible.
import { TIMEOUT, poll } from './shared.mjs';
import { waitForControlsReady, retryTransient, retryWithFreshControl,
  waitForEditorLoadingToClear, saveAndWait } from '../ui-waits.mjs';
import { closeToolbarMenusBeforeAction } from '../editor.mjs';

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

export function identifyColorPanelInputs(inputs = []) {
  const counts = (key) => inputs.reduce((map, item) => {
    const value = String(item[key] ?? '').trim();
    if (value) map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map());
  const labelCounts = counts('label');
  const nameCounts = counts('name');
  const positionCounts = counts('position');
  const controls = inputs.map((input) => {
    const label = String(input.label || '').replace(/\s+/g, ' ').trim();
    const name = String(input.name || '').trim();
    const position = Number.isInteger(input.position) ? input.position : null;
    let identity = null;
    let identitySource = null;
    if (label && labelCounts.get(label) === 1) { identity = `label:${label}`; identitySource = 'label'; }
    else if (name && nameCounts.get(name) === 1) { identity = `name:${name}`; identitySource = 'name'; }
    else if (position !== null && positionCounts.get(String(position)) === 1) {
      identity = `position:${position}`; identitySource = 'position';
    }
    const fallbackLabel = label || name || (position === null ? '' : `Color input at position ${position + 1}`);
    const inventoryNote = identitySource === 'position'
      ? 'No unique accessible label or name; recorded by unique position within the visible color panel and not mapped to a semantic setting.'
      : identity ? null : 'Color input identity is ambiguous; recorded but skipped for setting mapping.';
    return { ...input, label: fallbackLabel, role: input.role || 'textbox', position,
      identity, identitySource, identifiable: Boolean(identity), inventoryNote };
  });
  const notes = controls.filter((control) => control.inventoryNote).map((control) => ({
    identity: control.identity, label: control.label, position: control.position, note: control.inventoryNote,
  }));
  return { controls, notes };
}

export function colorPanelReadResult(inputs = [], { panelCount = 1 } = {}) {
  if (panelCount !== 1) return { status: 'ambiguous-panel', controls: [], notes: [
    `Expected one visible color panel; found ${panelCount}. No color setting was mapped.`,
  ] };
  const inventory = identifyColorPanelInputs(inputs);
  if (inventory.controls.length === 1 && inventory.controls[0].identifiable) return inventory.controls[0].value;
  return { status: inventory.controls.length ? 'multiple-controls' : 'no-controls',
    controls: inventory.controls, notes: inventory.notes };
}

export function planColorPanelWrites(controls = [], requested) {
  const entries = Array.isArray(requested) ? requested
    : requested && typeof requested === 'object' && requested.controlIdentity
      ? [requested] : controls.length === 1 && typeof requested === 'string'
        ? [{ controlIdentity: controls[0].identity, value: requested }]
        : [];
  if (!entries.length) {
    const error = new Error(controls.length > 1
      ? `Color panel has ${controls.length} inputs; specify each target by controlIdentity.`
      : 'Color panel write requires a uniquely identified input and value.');
    error.code = 'AMBIGUOUS_COLOR_CONTROL';
    throw error;
  }
  const seen = new Set();
  return entries.map((entry) => {
    const matches = controls.filter((control) => control.identifiable && control.identity === entry.controlIdentity);
    if (matches.length !== 1 || seen.has(entry.controlIdentity)) {
      throw new Error(`Color control ${entry.controlIdentity || '(missing identity)'} resolved ${matches.length} inputs or was selected more than once.`);
    }
    if (entry.value === undefined || entry.value === null) throw new Error(`Color control ${entry.controlIdentity} has no requested value.`);
    seen.add(entry.controlIdentity);
    return { control: matches[0], value: entry.value };
  });
}

async function uniqueVisiblePanel(canvas, selector, description) {
  const panels = canvas.locator(`${selector}:visible`);
  const count = await panels.count();
  if (count !== 1) throw new Error(`${description} visible panel matched ${count} controls; expected exactly one.`);
  return panels.first();
}

async function readColorPanelInputs(panel) {
  const inputs = panel.locator(RAIL.colorInput);
  return inputs.evaluateAll((nodes) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    return nodes.map((element, domIndex) => {
      const rect = element.getBoundingClientRect();
      const labels = [...(element.labels || [])].map((node) => norm(node.innerText || node.textContent));
      const nearby = element.closest('[aria-label], [data-label], label') || element.parentElement;
      const label = norm(element.getAttribute('aria-label') || element.getAttribute('title') || labels.find(Boolean)
        || nearby?.getAttribute('aria-label') || nearby?.getAttribute('data-label') || '');
      return { name: element.getAttribute('name') || '', label,
        role: element.getAttribute('role') || element.getAttribute('type') || 'textbox',
        value: element.value, visible: visible(element), domIndex,
        position: visible(element) ? [...nodes.slice(0, domIndex + 1)].filter(visible).length - 1 : null,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
    }).filter((item) => item.visible);
  });
}

// The visible rail: exactly one operateTools element is rendered at 30px
// width when its block is selected; the others are 0x0. The rail renders
// asynchronously after selection, so a single synchronous read right
// after the click intermittently finds nothing (2026-10-26: the color
// module's first openRailPanel and the width module's flip both hit this
// in the same run, while the width module's first open worked). Poll
// instead of reading once.
export async function selectBlock(canvas, blockId, { clickTarget, waitForRail } = {}) {
  await closeToolbarMenusBeforeAction(canvas);
  const wrap = canvas.locator(RAIL.wrap(blockId)).first();
  await wrap.scrollIntoViewIfNeeded();
  const activate = clickTarget || ((element) => element.evaluate((node) => node.click()));
  const wait = waitForRail || (() => visibleRailIndex(canvas));
  for (let attempt = 0; attempt < 2; attempt++) {
    await activate(wrap);
    try { return await wait(); }
    catch { /* retry the click once, then fall through to the error */ }
  }
  return wait();
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
  await closeToolbarMenusBeforeAction(canvas);
  await waitForEditorLoadingToClear(canvas);
  // If the panel is already open, do not click its icon again: the icon
  // toggles, and a second click closes the panel (2026-10-26: the color
  // flip's reopen waited 10s on a panel its own icon click had just
  // closed). The runner only ever selects the target block, so a visible
  // panel here is the target block's.
  const openPanels = canvas.locator(`${panelSelector}:visible`);
  const openPanelCount = await openPanels.count();
  if (openPanelCount > 1) throw new Error(`Selected rail surface matched ${openPanelCount} visible panels; refusing an ambiguous interaction.`);
  const alreadyOpen = openPanels.first();
  if (openPanelCount === 1 && await alreadyOpen.isVisible().catch(() => false)) {
    const index = await visibleRailIndex(canvas);
    await waitForEditorLoadingToClear(canvas);
    await retryTransient(() => waitForControlsReady(alreadyOpen));
    return { rail: canvas.locator(RAIL.rail).nth(index), panel: alreadyOpen, index };
  }
  const { index, rail } = await retryWithFreshControl({
    attempts: 3,
    ready: () => waitForEditorLoadingToClear(canvas),
    resolve: async () => {
      await selectBlock(canvas, blockId);
      await waitForEditorLoadingToClear(canvas);
      const currentIndex = await visibleRailIndex(canvas);
      return { index: currentIndex, rail: canvas.locator(RAIL.rail).nth(currentIndex),
        icon: canvas.locator(RAIL.rail).nth(currentIndex).locator(iconSelector).first() };
    },
    act: async ({ icon, index, rail }) => {
      await icon.scrollIntoViewIfNeeded();
      await icon.click({ timeout: TIMEOUT });
      return { index, rail };
    },
  });
  // Several panel copies exist (one per block); only the selected block's
  // copy is visible.
  const panel = await uniqueVisiblePanel(canvas, panelSelector, 'Selected rail surface');
  try {
    await panel.waitFor({ state: 'visible', timeout: TIMEOUT });
  } catch {
    // The click may have toggled an already-open panel closed; click once
    // more to reopen it.
    await icon.click({ timeout: TIMEOUT });
    await panel.waitFor({ state: 'visible', timeout: TIMEOUT });
  }
  await waitForEditorLoadingToClear(canvas);
  await retryTransient(() => waitForControlsReady(panel));
  return { rail, panel, index };
}

// Read the color scheme value from the visible color flyout.
export async function readSchemeColor(canvas) {
  const panels = canvas.locator(`${RAIL.colorPanel}:visible`);
  const panelCount = await panels.count();
  if (panelCount !== 1) return colorPanelReadResult([], { panelCount });
  const panel = panels.first();
  await retryTransient(() => waitForControlsReady(panel));
  return colorPanelReadResult(await readColorPanelInputs(panel));
}

// Set the scheme color through the Spectrum jQuery API (same approach as
// the 样本区块 background-color closed loop), falling back to the Spectrum
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
  const panel = await uniqueVisiblePanel(canvas, RAIL.colorPanel, 'Color scheme');
  await retryTransient(() => waitForControlsReady(panel));
  const inventory = identifyColorPanelInputs(await readColorPanelInputs(panel));
  const plan = planColorPanelWrites(inventory.controls, value);
  const inputs = panel.locator(RAIL.colorInput);
  const replacers = panel.locator('.sp-replacer');
  const replacerCount = await replacers.count();
  const setOne = async ({ control, value: color }) => {
    const input = inputs.nth(control.domIndex);
    const read = () => input.inputValue({ timeout: TIMEOUT });
    const matches = (actual) => normalizeColor(actual) === normalizeColor(color);
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
    if (replacerCount !== inventory.controls.length || !Number.isInteger(control.position)) {
      throw new Error(`Cannot uniquely pair ${inventory.controls.length} color inputs with ${replacerCount} picker controls; refusing fallback write.`);
    }
    await replacers.nth(control.position).click({ timeout: TIMEOUT });
    const openPopups = await poll(
      () => canvas.locator('body').evaluate((body) => [...body.ownerDocument.querySelectorAll('.sp-container')]
        .flatMap((el, index) => getComputedStyle(el).display !== 'none' && el.offsetWidth > 0 ? [index] : [])),
      (indexes) => Array.isArray(indexes) && indexes.length > 0,
    );
    if (!openPopups.matched) throw new Error(`Spectrum API 失败（${apiError}）；点取色器后未出现取色弹窗`);
    if (openPopups.value.length !== 1) throw new Error(`Spectrum API 失败（${apiError}）；当前可见取色弹窗有 ${openPopups.value.length} 个，无法唯一对应颜色控件`);
    const popup = canvas.locator('.sp-container').nth(openPopups.value[0]);
    const popupInput = popup.locator('.sp-input');
    if (await popupInput.count() !== 1) throw new Error('当前 Spectrum 取色弹窗输入框不唯一。');
    await popupInput.waitFor({ state: 'visible', timeout: TIMEOUT });
    await popupInput.fill(color, { timeout: TIMEOUT });
    const choose = popup.locator('.sp-choose');
    if (await choose.count() !== 1) throw new Error('当前 Spectrum 取色弹窗确认按钮不唯一。');
    await choose.click({ timeout: TIMEOUT });
    const applied = await poll(read, matches);
    if (!applied.matched) throw new Error(`Spectrum API 失败（${apiError}）；取色面板降级失败，改写后值为 ${JSON.stringify(applied.value)}`);
    return 'Spectrum 面板';
  };
  const results = [];
  for (const entry of plan) results.push({ controlIdentity: entry.control.identity, method: await setOne(entry) });
  return results.length === 1 ? results[0].method : results;
}

export async function saveColorPanel(canvas) {
  const panel = await uniqueVisiblePanel(canvas, RAIL.colorPanel, 'Color scheme');
  const save = panel.locator(RAIL.colorSave);
  if (await save.count() !== 1) throw new Error('Color panel save control is not unique; refusing to save.');
  await closeToolbarMenusBeforeAction(canvas);
  await saveAndWait(panel.page(), () => save.click({ timeout: TIMEOUT }));
}

export async function cancelColorPanel(canvas) {
  const panels = canvas.locator(`${RAIL.colorPanel}:visible`);
  const panelCount = await panels.count();
  if (!panelCount) return;
  if (panelCount !== 1) throw new Error(`Color panel close found ${panelCount} visible panels; refusing an ambiguous close.`);
  const panel = panels.first();
  const rail = canvas.locator(RAIL.rail).filter({ visible: true });
  if (await rail.count() !== 1) throw new Error('配色浮层关闭时无法唯一定位当前区块右侧图标栏。');
  const icon = rail.locator(RAIL.colorIcon);
  if (await icon.count() !== 1) throw new Error('配色浮层关闭图标不唯一。');
  await closeToolbarMenusBeforeAction(canvas);
  await icon.click({ timeout: TIMEOUT });
  await panel.waitFor({ state: 'hidden', timeout: TIMEOUT });
}

// Read the module-width state from the visible width flyout: which radio
// is checked, the custom value, and the effective width in px
// ('fullscreen' for 全屏). The default is stored as 自定义 1440, not as
// the 1440px preset, so the effective value is what matters.
export async function readModuleWidth(canvas) {
  const panel = await uniqueVisiblePanel(canvas, RAIL.widthPanel, 'Module-width');
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
  const panel = await uniqueVisiblePanel(canvas, RAIL.widthPanel, 'Module-width');
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
  const panel = await uniqueVisiblePanel(canvas, RAIL.widthPanel, 'Module-width');
  const save = panel.getByText('保存', { exact: true });
  if (await save.count() !== 1) throw new Error('Module-width save control is not unique; refusing to save.');
  await closeToolbarMenusBeforeAction(canvas);
  await saveAndWait(panel.page(), () => save.click({ timeout: TIMEOUT }));
}

export async function cancelWidthPanel(canvas) {
  const panel = await uniqueVisiblePanel(canvas, RAIL.widthPanel, 'Module-width');
  const cancel = panel.getByText('取消', { exact: true });
  if (await cancel.count() !== 1) throw new Error('Module-width cancel control is not unique; refusing to close.');
  await closeToolbarMenusBeforeAction(canvas);
  await cancel.click({ timeout: TIMEOUT });
}
