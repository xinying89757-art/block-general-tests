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
import { openEditor, gotoFreshTargetPage, savePage } from '../src/editor.mjs';
import { widgetSession, isFieldCheckbox } from '../src/capabilities/shared.mjs';
import { publishCurrentPage } from '../src/publish-current-page.mjs';
import { listSession } from '../src/capabilities/product-list-effects.mjs';
import * as cms from '../src/cms.mjs';
import { loadFixtureState } from '../src/fixture-state.mjs';
import { createFixtureDataOps, createCmsFixtureAdapter } from '../src/fixture-data-ops.mjs';
import {
  parseArgv, loadJsonFile, resolveFilterEvidenceTarget, readInstanceFilterAttrsFn,
  canvasAttributeMissing, suggestFilterEvidenceClassification,
} from '../src/filter-evidence.mjs';
import {
  resolveControlChangePlan, applyListControlPlan, assertControlPlanApplied, assertControlRestored,
  controlChangeSnapshot, shouldRestoreControlChange,
} from '../src/filter-evidence-control.mjs';

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
config.siteDomain ||= `https://${target.siteHost}`;
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
const restoreControlSettings = async ({ publish = false } = {}) => {
  if (!controlChange?.applied || !controlChange.original) return { status: 'skipped' };
  if (!page || !frame) return { status: 'failed', error: 'Editor session unavailable for control restore.' };
  try { await currentDialog?.cancel(); } catch {}
  const session = listSession({ page, canvas: frame, config });
  const result = await applyListControlPlan(session, controlChange, { restore: true, original: controlChange.original });
  assertControlRestored(result.after, controlChange.original);
  await savePage(page);
  let published;
  if (publish) published = await publishCurrentPage(page);
  return { status: 'ok', after: result.after, published };
};

try {
  const session = await launchSession(config);
  browser = session.browser;
  sessionContext = session.context;

  // (1) CMS read-back via checkFixtureData (never auto-repairs).
  const cmsPage = await cms.openProdPage(session.context, config);
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

  // (5) Optional published control change: per-page product count (unrelated
  // to data-filterfields). The new value is left in place through publish and
  // is restored only after the front has been verified, or immediately if this
  // box run fails.
  if (args['control-change']) {
    const plan = resolveControlChangePlan({ args, profile, fixtureState });
    const session = listSession({ page, canvas: frame, config });
    const result = await applyListControlPlan(session, plan);
    assertControlPlanApplied(result.after, plan);
    await savePage(page);
    await shot(page, '05-control-change.png');
    controlChange = controlChangeSnapshot(plan, result.original, {
      after: result.after,
      verifiedInEditor: true,
    });
    write('05-control-change.json', controlChange);
    write('05-control-change-original.json', { siteHost: target.siteHost, pageId: target.pageId, settingId: target.settingId, ...controlChange });
    report.steps.controlChange = { status: 'applied', restoreAfterFront: true, ...controlChange };
  } else {
    write('05-control-change.json', { applied: false, optional: true });
    report.steps.controlChange = { status: 'skipped', optional: true };
  }

  // (4) Publish current page only
  if (!args['skip-publish']) {
    const signal = await publishCurrentPage(page);
    await shot(page, '04-publish-signal.png');
    write('04-publish-signal.json', signal);
    report.steps.publish = signal;
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
  if (shouldRestoreControlChange({ runOk: report.ok })) {
    try {
      const published = report.steps.publish?.status === 'confirmed';
      report.steps.controlChangeRestore = await restoreControlSettings({ publish: published });
    } catch (error) {
      report.steps.controlChangeRestore = { status: 'failed', error: String(error.message).slice(0, 500) };
      process.exitCode = 1;
    }
  } else if (controlChange?.applied) {
    report.steps.controlChangeRestore = { status: 'deferred-until-front-verified', snapshot: '05-control-change-original.json' };
  }
  try { await browser?.close(); } catch {}
  try { lease.release(); report.leaseReleased = true; } catch { report.leaseReleased = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  write('00-report.json', report);
  write('filter-field-previous-states.json', {
    siteHost: target.siteHost, pageId: target.pageId, settingId: target.settingId, previousFieldStates: previousStates || {},
  });
  if (controlChange?.applied) write('05-control-change-original.json', {
    siteHost: target.siteHost, pageId: target.pageId, pageUrl: target.pageUrl, pageKind: target.pageKind, pageName: target.pageName,
    settingId: target.settingId, blockId: target.blockId, ...controlChange,
  });
  console.log(JSON.stringify({
    ok: report.ok, error: report.error, outDir, leaseReleased: report.leaseReleased,
    canvas: report.steps.canvas, publish: report.steps.publish, restored: report.steps.restored,
    classification: report.classification,
  }, null, 2));
}
