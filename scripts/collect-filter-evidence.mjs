#!/usr/bin/env node
// Box-side filter evidence: CMS read-back, editor settings, canvas
// data-filterfields after save and before publish, optional AUTOTEST control
// change, current-page publish. Always restores filter field checkboxes.
// Identity comes from --profile / CLI / env. No site hardcoding.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { acquireFreshRunLease } from '../src/fresh-run-lease.mjs';
import { openEditor, gotoFreshTargetPage, savePage, closeToolbarMenusBeforeAction } from '../src/editor.mjs';
import { widgetSession, isFieldCheckbox } from '../src/capabilities/shared.mjs';
import { choosePublishMenuItem, waitForPublishSignal } from '../src/publish-confirm.mjs';
import * as cms from '../src/cms.mjs';
import { loadFixtureState } from '../src/fixture-state.mjs';
import { createFixtureDataOps, createCmsFixtureAdapter } from '../src/fixture-data-ops.mjs';
import {
  parseArgv, loadJsonFile, resolveFilterEvidenceTarget, readInstanceFilterAttrsFn,
  canvasAttributeMissing, suggestFilterEvidenceClassification,
} from '../src/filter-evidence.mjs';

dotenv.config({ path: process.env.RUN_ENV_FILE || '.run.env', quiet: true });

const args = parseArgv(process.argv.slice(2), { flags: ['skip-publish', 'control-change'] });
const profile = args.profile ? loadJsonFile(args.profile) : {};
const fixtureStatePath = args['fixture-state'] || process.env.FIXTURE_STATE || (fs.existsSync('fixture-state.json') ? 'fixture-state.json' : null);
if (!fixtureStatePath) throw new Error('A fixture-state.json is required (pass --fixture-state). Run scripts/fixture-baseline.mjs first.');
const fixtureState = loadFixtureState(fixtureStatePath);
const target = resolveFilterEvidenceTarget({ args, env: process.env, profile, fixtureState });
if (new URL(loadConfig().siteDomain || `http://${target.siteHost}`).host !== target.siteHost) {
  throw new Error('Configured site host does not match the requested site host.');
}
process.env.BLOCK_ID = target.blockId;
const config = loadConfig();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = args.out || path.join('reports', `filter-evidence-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });
const write = (name, value) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
};
const shot = async (handle, name) => {
  const file = path.join(outDir, name);
  try { await handle.screenshot({ path: file, fullPage: true }); } catch (error) {
    write(`${name}.error.json`, { error: String(error.message).slice(0, 500) });
  }
  return file;
};
function dialog(page, frame) {
  return widgetSession({ page, canvas: frame, config, type: 'phoenix_blocks_filterStyle', title: '设置自定义字段筛选' });
}
function selectField(controls, name) {
  const matches = controls.filter(isFieldCheckbox).filter((item) => item.label === name);
  if (matches.length !== 1) throw new Error(`Field ${name} matches ${matches.length} controls.`);
  return matches[0];
}
async function exactAction(locator, pattern) {
  const hits = [];
  for (let i = 0; i < await locator.count(); i++) {
    if (await locator.nth(i).isVisible() && pattern.test((await locator.nth(i).innerText()).trim())) hits.push(i);
  }
  if (hits.length !== 1) throw new Error(`Expected one action, found ${hits.length}.`);
  return locator.nth(hits[0]);
}
async function enter(context) {
  const { page } = await openEditor(await context.newPage(), config);
  const { frame } = await gotoFreshTargetPage(page, { kind: target.pageKind, id: target.pageId, url: target.pageUrl, name: target.pageName });
  const instances = await frame.locator(`.siteblocks-setting-wrap[data-appid="${target.blockId}"]`).evaluateAll((nodes, settingId) => nodes.map((node) => {
    const attrs = [...node.attributes, ...[...node.querySelectorAll('*')].flatMap((n) => [...n.attributes])];
    return attrs.find((a) => /setting.?id/i.test(a.name))?.value || '';
  }), target.settingId);
  if (instances.length !== 1 || instances[0] !== target.settingId) {
    throw new Error(`Target instance identity mismatch (${instances.length} instances).`);
  }
  return { page, frame };
}

const lease = acquireFreshRunLease({ siteHost: target.siteHost, runId: `filter-evidence-${Date.now()}` });
const report = { startedAt: new Date().toISOString(), target: { ...target, fixture: undefined }, outDir, steps: {} };
let browser, sessionContext, currentDialog, previousStates, page, frame, changed = false, controlChange;
const restoreFieldStates = async () => {
  if (!page || !frame || !previousStates) return { status: 'skipped' };
  try {
    try { await currentDialog?.cancel(); } catch {}
    currentDialog = dialog(page, frame);
    await currentDialog.open();
    for (const name of target.fields) {
      const field = selectField(await currentDialog.read(), name);
      if (field.checked !== previousStates[name]) await currentDialog.set(field, previousStates[name]);
    }
    await currentDialog.save();
    await savePage(page);
    await currentDialog.cancel();
    currentDialog = null;
    return { status: 'ok', previousFieldStates: previousStates };
  } catch (error) {
    return { status: 'failed', error: String(error.message).slice(0, 500) };
  }
};
const restoreControlChange = async () => {
  // Control changes are block settings only; restoreFieldStates covers them.
  return { status: controlChange?.applied ? 'restored-with-settings' : 'skipped' };
};

try {
  const session = await launchSession(config);
  browser = session.browser;
  sessionContext = session.context;

  // (1) CMS read-back via checkFixtureData (never auto-repairs).
  const cmsPage = await cms.openProdPage(session.context);
  try {
    const ops = createFixtureDataOps(createCmsFixtureAdapter(cmsPage, cms));
    const checked = await ops.checkFixtureData(fixtureState);
    await shot(cmsPage, '01-cms-readback.png');
    write('01-cms-readback.json', checked);
    fixtureState.lastCheckedAt = checked.lastCheckedAt;
    report.steps.cms = { status: 'ok', file: '01-cms-readback.json', lastCheckedAt: checked.lastCheckedAt };
  } catch (error) {
    write('01-cms-readback.json', { ok: false, diff: error.diff || [], error: String(error.message).slice(0, 800) });
    report.steps.cms = { status: 'drift', diff: error.diff || [], error: String(error.message).slice(0, 800) };
    throw error;
  } finally { await cmsPage.close(); }

  // (2) Editor settings read-back
  ({ page, frame } = await enter(session.context));
  currentDialog = dialog(page, frame);
  await currentDialog.open();
  let controls = await currentDialog.read();
  previousStates = Object.fromEntries(target.fields.map((name) => [name, selectField(controls, name).checked]));
  await shot(page, '02-editor-settings-before.png');
  write('02-editor-settings-before.json', { previousFieldStates: previousStates });
  report.steps.editorSettingsBefore = { status: 'ok', previousFieldStates: previousStates };

  for (const name of target.fields) {
    const field = selectField(await currentDialog.read(), name);
    if (!field.checked) { await currentDialog.set(field, true); changed = true; }
  }
  if (changed) { await currentDialog.save(); await savePage(page); }
  else await currentDialog.cancel();
  currentDialog = dialog(page, frame);
  await currentDialog.open();
  const afterSave = {};
  {
    const saved = await currentDialog.read();
    for (const name of target.fields) afterSave[name] = selectField(saved, name).checked;
  }
  if (target.fields.some((name) => afterSave[name] !== true)) throw new Error('Target filter fields were not all checked after save.');
  await shot(page, '02-editor-settings-after-save.png');
  write('02-editor-settings-after-save.json', { previousFieldStates: previousStates, afterSave, changed });
  await currentDialog.cancel();
  currentDialog = null;
  report.steps.editorSettingsAfterSave = { status: 'ok', afterSave, changed };

  // (3) Canvas data-filterfields after save, before publish
  const canvas = await frame.evaluate(readInstanceFilterAttrsFn(), { blockId: target.blockId, settingId: target.settingId });
  write('03-canvas-filterfields.json', canvas);
  if (canvas.instanceOuterHTML) write('03-canvas-instance.fragment.html', canvas.instanceOuterHTML);
  await shot(page, '03-editor-canvas.png');
  try { await frame.locator('body').screenshot({ path: path.join(outDir, '03-editor-canvas-iframe.png') }); } catch {}
  report.steps.canvas = {
    status: canvas.status,
    attributePresent: canvas.attributePresent,
    rawFilterfields: canvas.rawFilterfields,
    previewSkippedOnBox: true,
    previewSkipReason: 'Editor preview is forced to http and is not used on runners that cannot reach plaintext http. The canvas iframe is the primary source.',
    macPreviewFallbackNeeded: canvasAttributeMissing(canvas),
  };
  write('03-preview-path.json', report.steps.canvas);

  // (5) Optional harmless AUTOTEST-marked block setting change (never mutates fixture data).
  if (args['control-change']) {
    const marker = `AUTOTEST-EVIDENCE-${Date.now()}`;
    currentDialog = dialog(page, frame);
    await currentDialog.open();
    const name = target.fields[0];
    const field = selectField(await currentDialog.read(), name);
    await currentDialog.set(field, false);
    await currentDialog.save();
    await savePage(page);
    currentDialog = dialog(page, frame);
    await currentDialog.open();
    const verified = selectField(await currentDialog.read(), name).checked === false;
    await currentDialog.set(selectField(await currentDialog.read(), name), true);
    await currentDialog.save();
    await savePage(page);
    await currentDialog.cancel();
    currentDialog = null;
    await shot(page, '05-control-change.png');
    controlChange = { applied: true, kind: 'block-setting', field: name, marker, verified };
    write('05-control-change.json', controlChange);
    report.steps.controlChange = { status: verified ? 'applied' : 'failed', ...controlChange };
    if (!verified) throw new Error('Control-change setting was not verified.');
  } else {
    write('05-control-change.json', { applied: false, optional: true });
    report.steps.controlChange = { status: 'skipped', optional: true };
  }

  // (4) Publish current page only
  if (!args['skip-publish']) {
    await closeToolbarMenusBeforeAction(page);
    const toolbar = page.locator('.backstage-topToolbar');
    await (await exactAction(toolbar.locator('button,a,[role="button"]'), /^(发布|发布网站)$/)).evaluate((el) => el.click());
    const menu = toolbar.locator('.backstage-publish-type > div');
    await menu.first().waitFor({ state: 'visible', timeout: 5000 });
    const labels = await menu.evaluateAll((nodes) => nodes.map((n) => (n.getClientRects().length ? n.textContent : '')));
    await menu.nth(choosePublishMenuItem(labels, 'current')).evaluate((el) => el.click());
    const confirmDialog = page.locator('.backstage-dialog:visible').filter({ hasText: '发布前请先确认以下设置项' });
    await confirmDialog.first().waitFor({ state: 'visible', timeout: 5000 });
    if (await confirmDialog.count() !== 1) throw new Error('Publish confirmation dialog is not unique.');
    const acknowledgment = confirmDialog.getByText('我已确认', { exact: true });
    if (await acknowledgment.count() === 1) {
      const acknowledged = await acknowledgment.evaluate((el) => {
        const container = el.closest('label') || el.parentElement;
        const checkbox = container?.querySelector('input[type="checkbox"]');
        if (checkbox) return checkbox.checked;
        return container?.getAttribute('aria-checked') === 'true' || container?.classList.contains('checked');
      });
      if (!acknowledged) await acknowledgment.evaluate((el) => el.click());
    }
    await (await exactAction(confirmDialog.locator('button,a,[role="button"]'), /^(发布|确定)$/)).evaluate((el) => el.click());
    const signal = await waitForPublishSignal({
      readTexts: () => page.evaluate(() => [...document.querySelectorAll('[class*="message"],[class*="toast"],[class*="notice"],[class*="tip"],[role="alert"],.backstage-dialog')]
        .filter((el) => el.getClientRects().length).map((el) => el.innerText)),
    });
    await shot(page, '04-publish-signal.png');
    write('04-publish-signal.json', signal);
    if (signal.status !== 'confirmed') throw new Error(`Editor did not confirm current-page publish: ${signal.status}`);
    report.steps.publish = { status: 'confirmed', signal: signal.signal, publishedAt: new Date().toISOString(), scope: 'current' };
  } else {
    report.steps.publish = { status: 'skipped' };
  }

  report.classification = suggestFilterEvidenceClassification({
    fields: target.fields,
    editorSettingsAfterSave: report.steps.editorSettingsAfterSave,
    canvas: report.steps.canvas,
    controlChange: report.steps.controlChange,
  });
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error.message).slice(0, 800);
  process.exitCode = 1;
} finally {
  const restore = await restoreFieldStates();
  report.steps.restored = restore;
  if (restore.status === 'failed') process.exitCode = 1;
  try { await currentDialog?.cancel(); } catch {}
  try { report.steps.controlChangeRestore = await restoreControlChange(); }
  catch (error) { report.steps.controlChangeRestore = { status: 'failed', error: String(error.message).slice(0, 500) }; }
  try { await browser?.close(); } catch {}
  try { lease.release(); report.leaseReleased = true; } catch { report.leaseReleased = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  write('00-report.json', report);
  write('filter-field-previous-states.json', {
    siteHost: target.siteHost, pageId: target.pageId, settingId: target.settingId, previousFieldStates: previousStates || {},
  });
  console.log(JSON.stringify({
    ok: report.ok, error: report.error, outDir, leaseReleased: report.leaseReleased,
    canvas: report.steps.canvas, publish: report.steps.publish, restored: report.steps.restored,
    classification: report.classification,
  }, null, 2));
}
