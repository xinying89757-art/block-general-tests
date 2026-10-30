// Baseline capture & apply (v1: widget dialogs only).
//
// A baseline is the block's configured state on its home page, recorded in
// the profile (`profile.baseline`) as dialog steps:
//   [{ title, type, wrapIndex, want: [{ label, type, value?, occurrence?, to }] }]
// checkbox/radio carry `to` as a boolean; text-like controls carry strings.
// `value` disambiguates checkbox/radio identities. When the resulting
// label+type(+value) identity still repeats, `occurrence` records its DOM
// order and is reused by apply, diff, and verification.
//
// Capture is read-only: dialogs are opened, snapshotted, and cancelled
// without saving. Apply reuses configure()'s transaction (probe once,
// change only what differs, dialog save, reopen and verify) and isolates
// failures per step: one dialog failing never drops the rest, but the
// overall result is allVerified=false.
//
// The right-rail color-scheme / module-width panels remain out of scope;
// the button zone is handled through its in-canvas editor-box popover.
import { clickSettings, controlValue, probeControls, widgetSession, TIMEOUT } from './capabilities/shared.mjs';
import { readButtonPopover, writeButtonPopover } from './capabilities/button-link.mjs';
import { matchControl, normalizeControlIdentity } from './baseline-identity.mjs';

const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';
const TITLE = '.backstage-dialog-title, .layui-layer-title';

// Radio groups cannot be set false directly: clicking a checked radio is a
// no-op, so a want entry { type: 'radio', to: false } can never be applied.
// Capture therefore only records the checked radio of a group; the group
// state is carried by that one entry.
function serializeControl(control, duplicateKeys) {
  const normalized = normalizeControlIdentity(control);
  const { label, type } = normalized;
  const key = `${type}::${label}`;
  const duplicate = duplicateKeys.has(key);
  const identity = duplicate && ['checkbox', 'radio'].includes(type) ? { value: control.value } : {};
  if (type === 'radio') {
    if (!control.checked) return null;
    return { ...normalized, label, type, ...identity, to: true };
  }
  if (type === 'checkbox') {
    return { ...normalized, label, type, ...identity, to: control.checked };
  }
  if (type === 'text' || type === 'number' || control.tag === 'SELECT' || control.tag === 'TEXTAREA') {
    return { label, type, to: control.value };
  }
  return null;
}

// Close a widget dialog without saving (取消, else 关闭), mirroring
// widgetSession's dismiss logic but on a bare dialog locator.
async function closeDialog(dialog) {
  for (const text of ['取消', '关闭']) {
    const button = dialog.locator('.backstage-dialog-bottom').getByText(text, { exact: true });
    if (await button.count()) {
      await button.click({ timeout: TIMEOUT });
      await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
      return;
    }
  }
  throw new Error('弹窗底部既无取消也无关闭按钮');
}

// Best-effort dismissal of a canvas popover (the button zone's editor-box):
// Escape first, then a neutral click, mirroring the button-link capability.
async function dismissCanvasPopover(page, canvas) {
  try { await page.keyboard.press('Escape'); } catch {}
  await page.waitForTimeout(800);
  const open = await canvas.locator('.editor-box').filter({ visible: true }).count().catch(() => 0);
  if (open) {
    try { await page.mouse.click(1, 1); await page.waitForTimeout(800); } catch {}
  }
}

// Read a dialog's title from its header; fall back to the first non-empty
// line of the dialog text. The widgetSession locator matches by this title,
// so the captured title must be a substring of the dialog text.
async function readDialogTitle(dialog) {
  const header = ((await dialog.locator(TITLE).first().innerText().catch(() => '')) || '')
    .replace(/\s+/g, ' ').trim();
  if (header) return header;
  const text = await dialog.innerText().catch(() => '');
  return text.split('\n').map((line) => line.trim()).find(Boolean) || '';
}

export async function inventorySettings({ page, canvas, config, blockId, onProgress }) {
  const wrapLocator = canvas.locator(
    `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(blockId))}] .backstage-blocksEditor-wrap`);
  if (!await wrapLocator.count()) throw new Error(`区块 ${blockId} 不在当前页。`);
  const types = await wrapLocator.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-blockseditor-type') || ''));
  const seen = new Map();
  const regions = types.map((type) => {
    const wrapIndex = seen.get(type) ?? 0;
    seen.set(type, wrapIndex + 1);
    return { type, wrapIndex };
  });
  const inventory = [];
  for (const [index, { type, wrapIndex }] of regions.entries()) {
    onProgress?.({ index: index + 1, total: regions.length, type, wrapIndex });
    if (type === 'phoenix_blocks_button') {
      const region = { type, wrapIndex, title: null, kind: 'button-popover', controls: [] };
      try {
        const popover = await readButtonPopover({ page, canvas, config });
        region.controls = popover.want.map(({ to, ...item }) => ({ ...item,
          ...(item.type === 'checkbox' ? { checked: to } : { value: to }) }));
      } catch (error) { region.skipped = error.message; }
      inventory.push(region);
      continue;
    }
    const region = { title: null, type, wrapIndex, kind: 'widget-dialog', controls: [] };
    let dialog = null;
    let session = null;
    try {
      await clickSettings(canvas, config, type, wrapIndex);
      dialog = page.locator(DIALOG).filter({ visible: true }).first();
      await dialog.waitFor({ state: 'visible', timeout: TIMEOUT });
      const title = await readDialogTitle(dialog);
      if (!title) {
        region.skipped = '读不到 dialog 标题';
        await closeDialog(dialog);
        inventory.push(region);
        continue;
      }
      region.title = title;
      session = widgetSession({ page, canvas, config, type, title, wrapIndex });
      region.controls = await session.read();
      await session.cancel();
    } catch (error) {
      region.skipped = /Timeout.*exceeded/.test(error.message)
        ? '打开后 10 秒内未出现 widget dialog（可能打开的是画布内浮层而非设置弹窗）'
        : error.message;
      try { if (session) await session.cancel(); else if (dialog) await closeDialog(dialog); } catch {}
      await dismissCanvasPopover(page, canvas);
    }
    inventory.push(region);
  }
  return inventory;
}

export async function captureBaseline(args) {
  const inventory = await inventorySettings(args);
  return inventory.map((region) => {
    const { title, type, wrapIndex, controls } = region;
    if (region.kind === 'button-popover') {
      return { type, wrapIndex, title: null, kind: 'button-popover',
        want: controls.map((c) => ({ label: c.label, type: c.type, to: c.type === 'checkbox' ? c.checked : c.value })),
        ...(region.skipped ? { skipped: region.skipped } : {}) };
    }
    const step = { title, type, wrapIndex, want: [] };
    if (title && controls.length) {
      const keyCounts = new Map();
      for (const control of controls) {
        const key = `${control.type}::${control.label}`;
        keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      }
      const duplicateKeys = new Set([...keyCounts.entries()]
        .filter(([, count]) => count > 1).map(([key]) => key));
      const serializedControls = controls.map((control) => serializeControl(control, duplicateKeys));
      const itemCounts = new Map();
      for (const item of serializedControls) {
        if (!item) continue;
        const key = JSON.stringify([item.label, item.type, item.value]);
        itemCounts.set(key, (itemCounts.get(key) || 0) + 1);
      }
      let skippedDisabled = 0;
      let skippedNoLabel = 0;
      const captured = [];
      const occurrences = new Map();
      for (const [index, control] of controls.entries()) {
        const item = serializedControls[index];
        const key = item ? JSON.stringify([item.label, item.type, item.value]) : null;
        const occurrence = key === null ? undefined : (occurrences.get(key) || 0);
        if (key !== null) occurrences.set(key, occurrence + 1);
        if (control.disabled) { skippedDisabled += 1; continue; }
        if (!control.label) { skippedNoLabel += 1; continue; }
        if (control.readOnly && !['checkbox', 'radio'].includes(control.type)) continue;
        if (item) captured.push(itemCounts.get(key) > 1 ? { ...item, occurrence } : item);
      }
      step.want = captured;
      if (skippedDisabled) step.skippedDisabled = skippedDisabled;
      if (skippedNoLabel) step.skippedNoLabel = skippedNoLabel;
    }
    if (region.skipped) step.skipped = region.skipped;
    return step;
  });
}

export async function applyBaseline({ page, canvas, config, baseline }) {
  const steps = [];
  let allVerified = true;
  for (const stepDef of baseline || []) {
    const { title, type, wrapIndex } = stepDef;
    if (stepDef.kind === 'button-popover') {
      const step = { title: null, type, wrapIndex, kind: stepDef.kind, set: [], verified: [], allVerified: false, errors: [] };
      try {
        const applied = await writeButtonPopover({ page, canvas, config, want: stepDef.want || [] });
        step.verified = (stepDef.want || []).map((want) => ({ label: want.label,
          value: ({ 按钮文本: applied.values.text, 链接网址: applied.values.url, 新窗口打开: applied.values.newWindow })[want.label],
          ok: ({ 按钮文本: applied.values.text, 链接网址: applied.values.url, 新窗口打开: applied.values.newWindow })[want.label] === want.to }));
        step.set = step.verified.map((item) => `${item.label}：${String(item.value)}`);
        step.allVerified = applied.verified && step.verified.every((item) => item.ok);
      } catch (error) { step.errors.push(error.message); }
      if (!step.allVerified) allVerified = false;
      steps.push(step);
      continue;
    }
    if (stepDef.skipped || !Array.isArray(stepDef.want) || stepDef.want.length === 0) {
      steps.push({ title: title ?? null, type, wrapIndex, set: [], verified: [],
        allVerified: true, skipped: stepDef.skipped || '无可应用的设置项' });
      continue;
    }
    const step = { title, type, wrapIndex, set: [], verified: [], allVerified: false, errors: [] };
    const session = widgetSession({ page, canvas, config, type, title, wrapIndex });
    try {
      const probe = await probeControls(session);
      if (probe.reason) { step.errors.push(probe.reason); steps.push(step); allVerified = false; continue; }
      // Do not partially save a dialog when its recorded controls cannot all
      // be resolved. A changing or incompletely loaded list needs investigation.
      const missing = [];
      for (const w of stepDef.want) {
        try { if (!matchControl(probe.controls, w)) missing.push(w.label); }
        catch (error) { step.errors.push(error.message); }
      }
      if (missing.length || step.errors.length) {
        if (missing.length) step.errors.push(`恢复前找不到控件：${missing.join('、')}`);
        allVerified = false;
        steps.push(step);
        continue;
      }
      for (const w of stepDef.want) {
        let target;
        try { target = matchControl(probe.controls, w); }
        catch (error) { step.errors.push(error.message); step.set.push(`${w.label}：身份不唯一`); continue; }
        if (!target) { step.set.push(`${w.label}：未找到`); continue; }
        const current = controlValue(target);
        if (current === w.to) { step.set.push(`${w.label}：已是目标值`); continue; }
        if (target.disabled) {
          step.errors.push(`${w.label}：不可切换（disabled），当前 ${String(current)}，目标 ${String(w.to)}`);
          step.set.push(`${w.label}：不可切换，跳过`);
          continue;
        }
        await session.set(target, w.to);
        step.set.push(`${w.label}：${String(current)} → ${String(w.to)}`);
      }
      await session.save();
      await session.open();
      const after = await session.read();
      step.verified = stepDef.want.map((w) => {
        let item = null;
        try { item = matchControl(after, w); }
        catch (error) { step.errors.push(error.message); }
        const value = item ? controlValue(item) : null;
        return { label: w.label, ...(w.occurrence === undefined ? {} : { occurrence: w.occurrence }), value, ok: value === w.to };
      });
      step.allVerified = step.verified.every((v) => v.ok) && step.errors.length === 0;
      if (!step.allVerified) allVerified = false;
    } catch (error) {
      step.errors.push(error.message);
      step.allVerified = false;
      allVerified = false;
    } finally {
      try { await session.cancel(); } catch {}
    }
    steps.push(step);
  }
  return { steps, allVerified };
}
