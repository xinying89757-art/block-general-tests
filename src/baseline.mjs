// Baseline capture & apply (v1: widget dialogs only).
//
// A baseline is the block's configured state on its home page, recorded in
// the profile (`profile.baseline`) as dialog steps:
//   [{ title, type, wrapIndex, want: [{ label, type, value?, to }] }]
// `want` mirrors scripts/configure-47748.mjs: checkbox/radio carry `to` as
// a boolean, text/number/select/textarea carry `to` as the value string.
// `value` is an identity disambiguator, only recorded for checkbox/radio
// when the same label+type appears more than once in the dialog (e.g.
// duplicate display-field copies). It is never recorded for text-like
// controls: their `value` is the mutable content, and apply matches them
// by label+type, so recording it would make apply fail to find a control
// whose current value differs from the captured one.
//
// Capture is read-only: dialogs are opened, snapshotted, and cancelled
// without saving. Apply reuses configure()'s transaction (probe once,
// change only what differs, dialog save, reopen and verify) and isolates
// failures per step: one dialog failing never drops the rest, but the
// overall result is allVerified=false.
//
// Out of v1 scope (recorded as skipped, never applied): the right-rail
// color-scheme / module-width panels and the button zone's in-canvas
// editor-box popover (that one opens no widget dialog at all).
import { clickSettings, controlValue, probeControls, widgetSession, TIMEOUT } from './capabilities/shared.mjs';

const DIALOG = '.backstage-dialog.backstage-dialog-widgetsettinsframe';
const TITLE = '.backstage-dialog-title, .layui-layer-title';

// Radio groups cannot be set false directly: clicking a checked radio is a
// no-op, so a want entry { type: 'radio', to: false } can never be applied.
// Capture therefore only records the checked radio of a group; the group
// state is carried by that one entry.
function serializeControl(control, duplicateKeys) {
  const { label, type } = control;
  const key = `${type}::${label}`;
  const identity = duplicateKeys.has(key) ? { value: control.value } : {};
  if (type === 'radio') {
    if (!control.checked) return null;
    return { label, type, ...identity, to: true };
  }
  if (type === 'checkbox') {
    return { label, type, ...identity, to: control.checked };
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

export async function captureBaseline({ page, canvas, config, blockId }) {
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

  const steps = [];
  for (const { type, wrapIndex } of regions) {
    const step = { title: null, type, wrapIndex, want: [] };
    let dialog = null;
    let session = null;
    try {
      await clickSettings(canvas, config, type, wrapIndex);
      dialog = page.locator(DIALOG).filter({ visible: true }).first();
      await dialog.waitFor({ state: 'visible', timeout: TIMEOUT });
      const title = await readDialogTitle(dialog);
      if (!title) {
        step.skipped = '读不到 dialog 标题';
        steps.push(step);
        await closeDialog(dialog);
        continue;
      }
      step.title = title;
      session = widgetSession({ page, canvas, config, type, title, wrapIndex });
      const controls = await session.read();
      const keyCounts = new Map();
      for (const control of controls) {
        const key = `${control.type}::${control.label}`;
        keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      }
      const duplicateKeys = new Set([...keyCounts.entries()]
        .filter(([, count]) => count > 1).map(([key]) => key));
      let skippedDisabled = 0;
      let skippedNoLabel = 0;
      for (const control of controls) {
        if (control.disabled) { skippedDisabled += 1; continue; }
        if (!control.label) { skippedNoLabel += 1; continue; }
        if (control.readOnly && !['checkbox', 'radio'].includes(control.type)) continue;
        const item = serializeControl(control, duplicateKeys);
        if (item) step.want.push(item);
      }
      if (skippedDisabled) step.skippedDisabled = skippedDisabled;
      if (skippedNoLabel) step.skippedNoLabel = skippedNoLabel;
      await session.cancel();
    } catch (error) {
      // No widget dialog appeared (the button zone opens an in-canvas
      // editor-box popover instead), or the settings button itself failed.
      step.skipped = /Timeout.*exceeded/.test(error.message)
        ? '打开后 10 秒内未出现 widget dialog（可能打开的是画布内浮层而非设置弹窗）'
        : error.message;
      // A widget dialog may still be open if the failure came after it
      // appeared; close it before dismissing any canvas popover.
      try { if (session) await session.cancel(); else if (dialog) await closeDialog(dialog); } catch {}
      await dismissCanvasPopover(page, canvas);
    }
    steps.push(step);
  }
  return steps;
}

export async function applyBaseline({ page, canvas, config, baseline }) {
  const steps = [];
  let allVerified = true;
  for (const stepDef of baseline || []) {
    const { title, type, wrapIndex } = stepDef;
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
      for (const w of stepDef.want) {
        const target = probe.controls.find((c) => c.label === w.label && c.type === w.type
          && (w.value === undefined || c.value === w.value));
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
        const item = after.find((c) => c.label === w.label && c.type === w.type
          && (w.value === undefined || c.value === w.value));
        const value = item ? controlValue(item) : null;
        return { label: w.label, value, ok: value === w.to };
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
