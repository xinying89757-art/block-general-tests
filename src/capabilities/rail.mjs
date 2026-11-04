// Helpers for the block-level right icon rail (.siteblocks-setting-
// operateTools), which lives inside the canvas iframe, not in the main
// page and not in a settings dialog. One rail per block on the page; only
// the selected block's rail is visible (30px wide, right edge). Clicking
// an icon opens a flyout panel to its left; again only the selected
// block's copy is visible.
import { TIMEOUT, poll } from './shared.mjs';
import { waitForControlsReady, retryTransient, retryWithFreshControl,
  waitForEditorLoadingToClear, saveAndWait } from '../ui-waits.mjs';
import { closeToolbarMenusBeforeAction, waitForEditorOverlaysBeforeAction } from '../editor.mjs';

export function describeInterceptingElement(message) {
  // 从完整元素摘要取起始标签，避免把闭合标签当成拦截元素。
  const match = String(message ?? '').match(/<([a-z][\w:-]*)\b((?:[^<>"']|"[^"]*"|'[^']*')*)>[^\r\n]*?\s+intercepts pointer events/i);
  if (!match) return null;
  const attributes = new Map();
  for (const attr of match[2].matchAll(/\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]);
  }
  const classes = (attributes.get('class') || '').trim().split(/\s+/).filter(Boolean);
  return match[1].toLowerCase() + (attributes.has('id') ? `#${attributes.get('id')}` : '')
    + classes.map((name) => `.${name}`).join('');
}

export function isStaleBackdropInterceptor(detail) {
  // Inspect only the described hit element, excluding diagnostic annotations
  // and the probe's ancestor chain. Both class tokens must belong to that hit.
  const element = String(detail ?? '').replace(/^hit-test:/, '').split(/[\s(;]/, 1)[0];
  const classes = new Set(element.split('.').slice(1));
  return ['backstage-dialog-overlay', 'layui-layer-shade'].some((name) => classes.has(name))
    && ['hide', 'hidden', 'invisible'].some((name) => classes.has(name));
}

export async function probeClickInterceptor(toggle) {
  return toggle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = element.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || element.contains(hit)) return null;
    const describe = (node) => node.tagName.toLowerCase() + (node.hasAttribute('id') ? `#${node.id}` : '')
      + [...node.classList].map((name) => `.${name}`).join('');
    const chain = [];
    // 保留命中元素和最多六层祖先，便于定位实际拦截区域。
    for (let node = hit, depth = 0; node && depth <= 6; node = node.parentElement, depth += 1) {
      chain.push(describe(node));
    }
    return { hit: describe(hit), chain: chain.join(' < ') };
  });
}

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

export function isColorControlSurfaceVisible({ inputRendered = false, pickerRendered = false } = {}) {
  return Boolean(inputRendered || pickerRendered);
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
    const matches = controls.filter((control) => control.identifiable && (control.identity === entry.controlIdentity
      || entry.controlIdentity === `position:${control.position}`));
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
  const candidates = await inputs.evaluateAll((nodes) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    return nodes.map((element, domIndex) => {
      const rect = element.getBoundingClientRect();
      const picker = element.parentElement?.querySelector('.sp-replacer, [role="colorpicker"], [data-color-picker]') || null;
      const pickerVisible = Boolean(picker && visible(picker));
      const labels = [...(element.labels || [])].map((node) => norm(node.innerText || node.textContent));
      const nearby = element.closest('[aria-label], [data-label], label') || element.parentElement;
      const label = norm(element.getAttribute('aria-label') || element.getAttribute('title') || labels.find(Boolean)
        || nearby?.getAttribute('aria-label') || nearby?.getAttribute('data-label') || '');
      const inputVisible = visible(element);
      const proxyRect = pickerVisible ? picker.getBoundingClientRect() : rect;
      const proxyIndexes = nodes.slice(0, domIndex + 1).filter((node) => {
        const candidate = node.parentElement?.querySelector('.sp-replacer, [role="colorpicker"], [data-color-picker]');
        return visible(node) || Boolean(candidate && visible(candidate));
      }).length - 1;
      return { name: element.getAttribute('name') || '', label,
        role: element.getAttribute('role') || (pickerVisible ? 'color' : element.getAttribute('type') || 'textbox'),
        value: element.value, visible: inputVisible, pickerVisible, domIndex,
        position: inputVisible || pickerVisible ? proxyIndexes : null,
        rect: { x: Math.round(proxyRect.x), y: Math.round(proxyRect.y), width: Math.round(proxyRect.width), height: Math.round(proxyRect.height) } };
    });
  });
  return candidates.filter((item) => isColorControlSurfaceVisible({ inputRendered: item.visible, pickerRendered: item.pickerVisible }));
}

// The visible rail: exactly one operateTools element is rendered at 30px
// width when its block is selected; the others are 0x0. The rail renders
// asynchronously after selection, so a single synchronous read right
// after the click intermittently finds nothing (2026-10-26: the color
// module's first openRailPanel and the width module's flip both hit this
// in the same run, while the width module's first open worked). Poll
// instead of reading once.
export async function selectBlock(canvas, blockId, { clickTarget, waitForRail, timeout = TIMEOUT } = {}) {
  await closeToolbarMenusBeforeAction(canvas);
  const wrap = canvas.locator(RAIL.wrap(blockId)).first();
  await wrap.scrollIntoViewIfNeeded({ timeout });
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

const RAIL_OPEN_ATTEMPTS = 3;
const RAIL_ACTION_TIMEOUT = 1_500;
const RAIL_PANEL_WAIT_MS = 900;

/** Small, dependency-injected rail opener so stale DOM collections can be tested offline. */
export async function openRailPanelWithRetry({ readPanelOpen, resolveToolbar, resolveToggle,
  clickToggle, waitPanelOpen, prepareToggle = async () => {}, attempts = RAIL_OPEN_ATTEMPTS }) {
  const strategies = [];
  let lastFailure = null;
  let failureCode = 'rail-toolbar-not-found';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await readPanelOpen()) return { alreadyOpen: true, attempt: attempt - 1, strategies };
    let toolbar;
    try { toolbar = await resolveToolbar(); }
    catch (error) {
      failureCode = 'rail-toolbar-not-found';
      lastFailure = error;
      strategies.push(`toolbar-resolution:${error.message}`);
      continue;
    }
    if (!toolbar) {
      strategies.push('target-instance-toolbar');
      lastFailure = Object.assign(new Error('No toolbar matched the target instance.'), { code: 'rail-toolbar-not-found' });
      failureCode = 'rail-toolbar-not-found';
      continue;
    }
    strategies.push('target-instance-toolbar');
    let toggle;
    failureCode = 'rail-toggle-not-visible';
    try { toggle = await resolveToggle(toolbar, { preferred: true }); }
    catch (error) { lastFailure = error; strategies.push(`preferred-toggle:${error.message}`); }
    if (!toggle) {
      strategies.push('preferred-toggle');
      try { toggle = await resolveToggle(toolbar, { preferred: false }); }
      catch (error) { lastFailure = error; strategies.push(`fallback-toggle:${error.message}`); }
      if (toggle) strategies.push('fallback-toggle');
    }
    if (toggle?.absent === true) {
      strategies.push('toggle-absent-confirmation');
      let confirmed;
      try {
        const freshToolbar = await resolveToolbar();
        confirmed = freshToolbar ? await resolveToggle(freshToolbar, { preferred: true, confirmAbsent: true }) : null;
        if (!confirmed) confirmed = freshToolbar ? await resolveToggle(freshToolbar, { preferred: false, confirmAbsent: true }) : null;
      } catch (error) { lastFailure = error; }
      if (confirmed?.absent === true) {
        const error = new Error('rail-toggle-absent: target rail is visible but has no matching preferred or fallback toggle.');
        error.code = 'rail-toggle-absent';
        error.matchCounts = confirmed.matchCounts;
        throw error;
      }
      // A newly rendered control or a stale toolbar is handled by the usual
      // bounded retry path; absence is reported only after fresh confirmation.
      if (confirmed && !confirmed.absent) toggle = confirmed;
      else continue;
    }
    if (!toggle) {
      lastFailure = Object.assign(new Error('No visible rail toggle matched the preferred or fallback selector.'), { code: 'rail-toggle-not-visible' });
      failureCode = 'rail-toggle-not-visible';
      continue;
    }
    try {
      failureCode = 'panel-not-opened';
      await prepareToggle(toggle, { timeout: RAIL_ACTION_TIMEOUT });
      await clickToggle(toggle, { timeout: RAIL_ACTION_TIMEOUT });
      if (await waitPanelOpen()) return { alreadyOpen: false, attempt, toolbar, toggle, strategies };
      strategies.push(`panel-not-opened-after-attempt-${attempt}`);
      lastFailure = Object.assign(new Error('The rail toggle did not open the requested panel.'), { code: 'panel-not-opened' });
      failureCode = 'panel-not-opened';
    } catch (error) {
      lastFailure = error;
      failureCode = error?.code === 'rail-toggle-intercepted' ? error.code : 'panel-not-opened';
      strategies.push(`toggle-action-attempt-${attempt}:${error.message}`);
    }
  }
  const code = failureCode;
  const error = new Error(`${code}: unable to open requested rail panel after ${attempts} attempts; strategies=${strategies.join(' | ') || 'none'}; last=${lastFailure?.message || 'no matching target toolbar'}`);
  error.code = code;
  error.strategies = strategies;
  throw error;
}

/** Resolve one visible toggle while preserving match counts for absent vs hidden controls. */
export async function resolveRailToggle(rail, iconSelector, fallbackSelector, { preferred = true } = {}) {
  if (!await rail.isVisible().catch(() => false)) return null;
  const selectors = preferred ? [iconSelector, fallbackSelector] : [fallbackSelector];
  const matches = [];
  for (const selector of selectors) {
    const locator = rail.locator(selector);
    const count = await locator.count();
    matches.push({ selector, locator, count });
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  const total = matches.reduce((sum, item) => sum + item.count, 0);
  return total === 0 ? { absent: true, matchCounts: matches.map(({ selector, count }) => ({ selector, count })) } : null;
}

function hasSettingId(element, settingId) {
  const nodes = [element, ...element.querySelectorAll('*')];
  return nodes.some((node) => [...node.attributes].some((attr) => /setting.?id/i.test(attr.name)
    && String(attr.value) === String(settingId)));
}

async function resolveTargetRail(canvas, blockId, settingId) {
  const wraps = canvas.locator(RAIL.wrap(blockId));
  const wrapCount = await wraps.count();
  let targetWrap = null;
  if (settingId) {
    const matched = [];
    for (let i = 0; i < wrapCount; i += 1) {
      const wrap = wraps.nth(i);
      if (await wrap.evaluate(hasSettingId, String(settingId))) matched.push(wrap);
    }
    if (matched.length === 1) targetWrap = matched[0];
  } else if (wrapCount === 1) targetWrap = wraps.first();
  if (!targetWrap) return null;
  // The rail is normally inside the block wrapper. Re-query this relationship
  // every attempt; never carry a document-wide .nth() across a reload/delete.
  const scoped = targetWrap.locator(RAIL.rail);
  const scopedCount = await scoped.count();
  if (scopedCount === 1) return { rail: scoped.first(), wrap: targetWrap };
  if (scopedCount > 1) {
    const visible = [];
    for (let i = 0; i < scopedCount; i += 1) {
      const rail = scoped.nth(i);
      if (await rail.isVisible().catch(() => false)) visible.push(rail);
    }
    return visible.length === 1 ? { rail: visible[0], wrap: targetWrap } : null;
  }
  const rails = canvas.locator(RAIL.rail);
  const associated = [];
  for (let i = 0, count = await rails.count(); i < count; i += 1) {
    const rail = rails.nth(i);
    const belongs = await rail.evaluate((element, identity) => {
      const root = element.closest('.siteblocks-setting-wrap[data-appid]');
      if (!root) return false;
      if (identity.settingId) {
        const nodes = [root, ...root.querySelectorAll('*')];
        return nodes.some((node) => [...node.attributes].some((attr) => /setting.?id/i.test(attr.name)
          && String(attr.value) === String(identity.settingId)));
      }
      return root.getAttribute('data-appid') === identity.blockId;
    }, { settingId: settingId || '', blockId: String(blockId) });
    if (belongs) associated.push(rail);
  }
  return associated.length === 1 ? { rail: associated[0], wrap: targetWrap } : null;
}

export async function openRailPanel(canvas, blockId, iconSelector, panelSelector, { settingId } = {}) {
  await closeToolbarMenusBeforeAction(canvas);
  await waitForEditorLoadingToClear(canvas);
  const initialPanels = canvas.locator(`${panelSelector}:visible`);
  const initialCount = await initialPanels.count();
  if (initialCount > 1) throw new Error(`Selected rail surface matched ${initialCount} visible panels; refusing an ambiguous interaction.`);
  if (initialCount === 0) {
    try {
      await selectBlock(canvas, blockId, {
        timeout: RAIL_ACTION_TIMEOUT,
        waitForRail: async () => {
          const deadline = Date.now() + RAIL_ACTION_TIMEOUT;
          do {
            const target = await resolveTargetRail(canvas, blockId, settingId);
            if (target && await target.rail.isVisible().catch(() => false)) return target;
            await new Promise((resolve) => setTimeout(resolve, 50));
          } while (Date.now() < deadline);
          const error = new Error('rail-toolbar-not-found: selected target instance did not expose its toolbar within the bounded selection wait.');
          error.code = 'rail-toolbar-not-found';
          throw error;
        },
      });
    } catch (cause) {
      if (cause?.code === 'rail-toolbar-not-found') throw cause;
      const error = new Error(`rail-toolbar-not-found: could not select target block within the bounded wait; cause=${cause?.message || cause}`);
      error.code = 'rail-toolbar-not-found';
      throw error;
    }
  }
  const panel = await openRailPanelWithRetry({
    readPanelOpen: async () => {
      const panels = canvas.locator(`${panelSelector}:visible`);
      const count = await panels.count();
      if (count > 1) throw new Error(`Selected rail surface matched ${count} visible panels; refusing an ambiguous interaction.`);
      return count === 1;
    },
    resolveToolbar: async () => (await resolveTargetRail(canvas, blockId, settingId))?.rail || null,
    resolveToggle: async (rail, { preferred }) => {
      const fallback = iconSelector.includes('telescopic')
        ? '[class*="telescopic"], [data-action*="width"], [aria-label*="宽度"], [title*="宽度"]'
        : '[class*="operateColor"], [data-action*="color"], [aria-label*="配色"], [title*="配色"]';
      return resolveRailToggle(rail, iconSelector, fallback, { preferred });
    },
    prepareToggle: async () => {
      const blockers = await waitForEditorOverlaysBeforeAction(canvas);
      if (blockers.length) {
        const error = new Error(`rail-toggle-intercepted: editor overlay still blocks pointer input: ${blockers.join('; ')}`);
        error.code = 'rail-toggle-intercepted';
        error.interceptingElements = blockers;
        throw error;
      }
    },
    clickToggle: async (toggle, { timeout }) => {
      await toggle.scrollIntoViewIfNeeded({ timeout });
      try { await toggle.click({ timeout }); }
      catch (cause) {
        // Selecting a fresh block can rebuild its toolbar between Playwright's
        // actionability check and the click. Re-resolve the scoped locator and
        // invoke the control once when that specific detach race occurs.
        if (/detached from the DOM/i.test(String(cause?.message || ''))) {
          try {
            await toggle.evaluate((node) => node.click());
            return;
          } catch (retryCause) {
            if (!/intercepts pointer events/i.test(String(retryCause?.message || ''))) throw retryCause;
            cause = retryCause;
          }
        }
        if (!/intercepts pointer events/i.test(String(cause?.message || ''))) throw cause;
        const blockers = await waitForEditorOverlaysBeforeAction(canvas, { timeoutMs: 100 });
        let detail = blockers.length ? blockers.join('; ') : describeInterceptingElement(cause.message);
        if (!detail) {
          const interceptor = await probeClickInterceptor(toggle).catch(() => null);
          detail = interceptor ? `hit-test:${interceptor.hit} (${interceptor.chain})` : 'unknown overlay';
        }
        if (isStaleBackdropInterceptor(detail)) {
          try {
            // Closed backdrops can retain pointer events, as with page save.
            // The caller still verifies that the requested panel actually opens.
            await toggle.evaluate((node) => node.click());
            return;
          } catch { /* preserve the interception diagnostic if the bypass fails */ }
        }
        const error = new Error(`rail-toggle-intercepted: ${detail}`);
        error.code = 'rail-toggle-intercepted';
        error.interceptingElements = blockers;
        throw error;
      }
    },
    waitPanelOpen: async () => {
      const deadline = Date.now() + RAIL_PANEL_WAIT_MS;
      do {
        const panels = canvas.locator(`${panelSelector}:visible`);
        const count = await panels.count();
        if (count > 1) throw new Error(`Selected rail surface matched ${count} visible panels; refusing an ambiguous interaction.`);
        if (count === 1) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      return false;
    },
  });
  const openPanels = canvas.locator(`${panelSelector}:visible`);
  const panelCount = await openPanels.count();
  if (panelCount !== 1) {
    const error = new Error(`panel-not-opened: requested rail panel resolved ${panelCount} visible panels after ${panel.attempt} attempts; strategies=${panel.strategies.join(' | ')}`);
    error.code = 'panel-not-opened';
    error.strategies = panel.strategies;
    throw error;
  }
  const visiblePanel = openPanels.first();
  await waitForEditorLoadingToClear(canvas);
  await retryTransient(() => waitForControlsReady(visiblePanel));
  const target = await resolveTargetRail(canvas, blockId, settingId);
  return { rail: target?.rail || null, panel: visiblePanel, index: null };
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

export function paletteWriteReadback(setValue, readBackValue) {
  const matched = normalizeColor(setValue) === normalizeColor(readBackValue);
  return { setValue, readBackValue: readBackValue ?? null, matched,
    ...(matched ? {} : { reason: 'palette-write-readback-mismatch' }) };
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
      if (api.available && applied.matched) return { method: 'Spectrum API', controlIdentity: control.identity,
        ...paletteWriteReadback(color, applied.value) };
      if (api.available) {
        const error = new Error('Palette input readback did not equal the requested value after write.');
        error.code = 'palette-write-readback-mismatch';
        error.paletteReadback = { controlIdentity: control.identity, ...paletteWriteReadback(color, applied.value) };
        throw error;
      }
      apiError = api.available ? `API 后值为 ${JSON.stringify(applied.value)}` : '画布内没有可用的 Spectrum jQuery API';
    } catch (error) {
      if (error.code === 'palette-write-readback-mismatch') throw error;
      apiError = error.message;
    }
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
    if (!applied.matched) {
      const error = new Error('Palette input readback did not equal the requested value after picker write.');
      error.code = 'palette-write-readback-mismatch';
      error.paletteReadback = { controlIdentity: control.identity, ...paletteWriteReadback(color, applied.value) };
      throw error;
    }
    return { method: 'Spectrum 面板', controlIdentity: control.identity, ...paletteWriteReadback(color, applied.value) };
  };
  const results = [];
  for (const entry of plan) results.push({ controlIdentity: entry.control.identity, method: await setOne(entry) });
  const writes = results.map((entry) => entry.method);
  // Preserve the legacy return shape for capability-level callers that write
  // an entire palette. A target-specific write (used by a setting unit)
  // returns the exact set/readback values for its report.
  if (value && typeof value === 'object' && value.controlIdentity) return writes[0];
  return writes.length === 1 ? writes[0].method : writes;
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
