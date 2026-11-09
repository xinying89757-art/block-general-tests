#!/usr/bin/env node
// Restore recorded filter checkbox states on the selected test page. --enable is
// the one-time preparation mode; it records the snapshot before changing fields.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { loadConfig } from '../src/config.mjs';
import { launchSession, prepareContext } from '../src/browser.mjs';
import { acquireFreshRunLease } from '../src/fresh-run-lease.mjs';
import { openEditor, gotoFreshTargetPage, savePage, closeToolbarMenusBeforeAction } from '../src/editor.mjs';
import { widgetSession, isFieldCheckbox } from '../src/capabilities/shared.mjs';
import { choosePublishMenuItem, waitForPublishSignal } from '../src/publish-confirm.mjs';

dotenv.config({ path: process.env.RUN_ENV_FILE || '/workspace/47948/codex/.run.env', quiet: true });
const args = process.argv.slice(2);
const arg = (key) => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const enabling = args.includes('--enable');
const settingId = arg('--setting-id'), pageId = arg('--page-id'), statesFile = arg('--states-file');
if (!settingId || !pageId || !statesFile) throw new Error('Required: --setting-id, --page-id and --states-file');
const fields = ['AUTOTEST-下拉列表', 'AUTOTEST-单选按钮', 'AUTOTEST-多选按钮', 'AUTOTEST-文本字段'];
const siteHost = 'en-site79106751.ldwebsite.com';
process.env.BLOCK_ID = '47948';
const config = loadConfig();
if (new URL(config.siteDomain).host !== siteHost) throw new Error('Site host mismatch; refusing to modify.');
const target = { kind: 'system', id: pageId, url: '/products.html', name: 'Products' };
const lease = acquireFreshRunLease({ siteHost, runId: `filter-fields-${Date.now()}` });
let browser, currentDialog;
const report = { startedAt: new Date().toISOString(), siteHost, pageId, settingId, mode: enabling ? 'enable-publish' : 'restore', publishedConfirmed: false };
const reportPath = 'reports/filter-fields-publish-47948.json';
async function enter(context) {
  const { page } = await openEditor(await context.newPage(), config);
  const { frame } = await gotoFreshTargetPage(page, target);
  const instances = await frame.locator('.siteblocks-setting-wrap[data-appid="47948"]').evaluateAll(nodes => nodes.map(node => {
    const attrs = [...node.attributes, ...[...node.querySelectorAll('*')].flatMap(n => [...n.attributes])];
    return attrs.find(a => /setting.?id/i.test(a.name))?.value || '';
  }));
  if (instances.length !== 1 || instances[0] !== settingId) throw new Error(`Target instance identity mismatch (${instances.length} instances).`);
  return { page, frame };
}
function dialog(page, frame) { return widgetSession({ page, canvas: frame, config, type: 'phoenix_blocks_filterStyle', title: '设置自定义字段筛选' }); }
function select(controls, name) {
  const matches = controls.filter(isFieldCheckbox).filter(c => c.label === name);
  if (matches.length !== 1) throw new Error(`Field ${name} matches ${matches.length} controls.`);
  return matches[0];
}
async function exact(locator, pattern) {
  const hits = [];
  for (let i = 0; i < await locator.count(); i++) if (await locator.nth(i).isVisible() && pattern.test((await locator.nth(i).innerText()).trim())) hits.push(i);
  if (hits.length !== 1) throw new Error(`Expected one action, found ${hits.length}.`);
  return locator.nth(hits[0]);
}
try {
  const session = await launchSession(config); browser = session.browser;
  const { page, frame } = await enter(session.context);
  currentDialog = dialog(page, frame); await currentDialog.open();
  let controls = await currentDialog.read();
  let states;
  if (enabling) {
    const selected = fields.map(name => select(controls, name));
    if (selected.some(c => c.disabled && !c.checked)) throw new Error('A required field is disabled.');
    states = Object.fromEntries(selected.map(c => [c.label, c.checked]));
    fs.mkdirSync(new URL('.', `file://${statesFile}`).pathname, { recursive: true });
    if (args.includes('--resume')) {
      const snapshot = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
      if (snapshot.siteHost !== siteHost || snapshot.pageId !== pageId || snapshot.settingId !== settingId || fields.some(name => typeof snapshot.previousFieldStates?.[name] !== 'boolean')) throw new Error('Snapshot identity or states mismatch.');
      states = snapshot.previousFieldStates;
    } else fs.writeFileSync(statesFile, JSON.stringify({ siteHost, pageId, settingId, previousFieldStates: states }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    report.previousFieldStates = states;
  } else {
    const snapshot = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
    if (snapshot.siteHost !== siteHost || snapshot.pageId !== pageId || snapshot.settingId !== settingId) throw new Error('Snapshot identity mismatch.');
    states = snapshot.previousFieldStates;
    if (fields.some(name => typeof states[name] !== 'boolean')) throw new Error('Snapshot lacks valid checkbox states.');
  }
  const radios = controls.filter(c => c.type === 'radio' && c.checked).map(({ name, value }) => ({ name, value }));
  let changed = false;
  for (const name of fields) { const field = select(await currentDialog.read(), name); const desired = enabling ? true : states[name]; if (field.checked !== desired) { await currentDialog.set(field, desired); changed = true; } }
  if (changed) { await currentDialog.save(); await savePage(page); } else await currentDialog.cancel();
  await currentDialog.open(); controls = await currentDialog.read();
  for (const name of fields) if (select(controls, name).checked !== (enabling ? true : states[name])) throw new Error(`Readback mismatch: ${name}`);
  if (radios.some(r => !controls.some(c => c.type === 'radio' && c.name === r.name && c.value === r.value && c.checked))) throw new Error('A previously selected radio was lost during save.');
  await currentDialog.cancel(); currentDialog = null;
  // Verify saved values through an independent browser context.
  if (!args.includes('--resume')) {
  const verification = await browser.newContext({ storageState: await session.context.storageState(), ignoreHTTPSErrors: config.ignoreHTTPSErrors });
  await prepareContext(verification, config);
  try {
    const fresh = await enter(verification); const check = dialog(fresh.page, fresh.frame); await check.open();
    const saved = await check.read();
    for (const name of fields) if (select(saved, name).checked !== (enabling ? true : states[name])) throw new Error(`Persisted readback mismatch: ${name}`);
    await check.cancel();
  } finally { await verification.close(); }
  report.persistedReadback = true;
  } else report.persistedReadback = 'Previously verified in independent context; rechecked in this session.';
  if (enabling) {
    await closeToolbarMenusBeforeAction(page);
    const toolbar = page.locator('.backstage-topToolbar');
    await (await exact(toolbar.locator('button,a,[role="button"]'), /^(发布|发布网站)$/)).click();
    const menu = toolbar.locator('.backstage-publish-type > div'); await menu.first().waitFor({ state: 'visible', timeout: 5000 });
    const labels = await menu.evaluateAll(nodes => nodes.map(n => n.getClientRects().length ? n.textContent : ''));
    await menu.nth(choosePublishMenuItem(labels, 'current')).click();
    const confirmDialog = page.locator('.backstage-dialog:visible').filter({ hasText: '发布前请先确认以下设置项' }); await confirmDialog.first().waitFor({ state: 'visible', timeout: 5000 });
    if (await confirmDialog.count() !== 1) {
      report.dialogs = await confirmDialog.evaluateAll(nodes => nodes.map(n => ({ text: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300), classes: n.className })));
      throw new Error('Publish confirmation dialog is not unique.');
    }
    const acknowledgment = confirmDialog.getByText('我已确认', { exact: true });
    if (await acknowledgment.count() !== 1) throw new Error('Publish acknowledgment is not unique.');
    const acknowledged = await acknowledgment.evaluate(el => {
      const container = el.closest('label') || el.parentElement;
      const checkbox = container?.querySelector('input[type="checkbox"]');
      if (checkbox) return checkbox.checked;
      return container?.getAttribute('aria-checked') === 'true' || container?.classList.contains('checked');
    });
    if (!acknowledged) await acknowledgment.evaluate(el => el.click());
    report.confirmationText = '发布前请先确认以下设置项；我已确认。';
    await (await exact(confirmDialog.locator('button,a,[role="button"]'), /^(发布|确定)$/)).evaluate(el => el.click());
    const signal = await waitForPublishSignal({ readTexts: () => page.evaluate(() => [...document.querySelectorAll('[class*="message"],[class*="toast"],[class*="notice"],[class*="tip"],[role="alert"],.backstage-dialog')].filter(el => el.getClientRects().length).map(el => el.innerText)) });
    if (signal.status !== 'confirmed') {
      report.postPublishUi = await page.evaluate(() => [...document.querySelectorAll('[class*="message"],[class*="toast"],[class*="notice"],[class*="tip"],[role="alert"],.backstage-dialog')].filter(el => el.getClientRects().length).map(el => (el.innerText || '').replace(/\s+/g, ' ').slice(0, 300)).filter(Boolean));
      report.screenshot = 'reports/filter-fields-publish-47948.png';
      await page.screenshot({ path: report.screenshot });
      throw new Error('Editor did not confirm publishing.');
    }
    report.publishedConfirmed = true; report.publishSignal = signal; report.publishedAt = new Date().toISOString();
    report.screenshot = 'reports/filter-fields-publish-47948.png';
    await page.screenshot({ path: report.screenshot });
    report.fieldsEnabled = fields; report.frontVerification = 'Deferred to Mac: box cannot reach published front.';
  }
  report.ok = true;
} catch (error) { report.ok = false; report.error = String(error.message).slice(0, 500); process.exitCode = 1; }
finally {
  try { await currentDialog?.cancel(); } catch {}
  try { await browser?.close(); } catch {}
  try { lease.release(); report.leaseReleased = true; } catch { report.leaseReleased = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  if (enabling) { fs.mkdirSync('reports', { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ ok: report.ok, error: report.error, publishedConfirmed: report.publishedConfirmed, leaseReleased: report.leaseReleased, reportPath: enabling ? reportPath : undefined }));
}
