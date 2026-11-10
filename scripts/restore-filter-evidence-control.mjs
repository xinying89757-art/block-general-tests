#!/usr/bin/env node
// Restore the published control change (per-page product count / data source)
// after the Mac front has verified it. Reads the original snapshot recorded
// by collect-filter-evidence.mjs. Always restores on failure of this command.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { acquireFreshRunLease } from '../src/fresh-run-lease.mjs';
import { openEditor, gotoFreshTargetPage, savePage } from '../src/editor.mjs';
import { parseArgv, loadJsonFile, firstDefined } from '../src/filter-evidence.mjs';
import { applyListControlPlan, assertControlRestored } from '../src/filter-evidence-control.mjs';
import { listSession } from '../src/capabilities/product-list-effects.mjs';
import { publishCurrentPage } from '../src/publish-current-page.mjs';

dotenv.config({ path: process.env.RUN_ENV_FILE || '.run.env', quiet: true });

const args = parseArgv(process.argv.slice(2), { flags: ['skip-publish'] });
const snapshotPath = firstDefined(args['states-file'], args['box-report'], args.snapshot);
if (!snapshotPath) throw new Error('Required: --states-file <05-control-change-original.json> or --box-report <00-report.json>');
const raw = loadJsonFile(snapshotPath);
const snapshot = raw.steps?.controlChange || raw;
if (!snapshot?.applied || !snapshot.original) throw new Error('Snapshot does not contain an applied control change and its original values.');
const siteHost = String(firstDefined(args['site-host'], snapshot.siteHost, process.env.SITE_HOST) || '').replace(/^https?:\/\//, '');
const blockId = String(firstDefined(args.block, args['block-id'], snapshot.blockId, process.env.BLOCK_ID) || '');
const settingId = firstDefined(args['setting-id'], snapshot.settingId, process.env.FRESH_SETTING_ID);
const pageId = firstDefined(args['page-id'], snapshot.pageId, process.env.FRESH_PAGE_ID);
const pageUrl = firstDefined(args['page-url'], snapshot.pageUrl, process.env.FRESH_PAGE_URL);
const pageKind = firstDefined(args['page-kind'], snapshot.pageKind, 'system');
const pageName = firstDefined(args['page-name'], snapshot.pageName, '');
if (!siteHost || !blockId || !settingId || !pageId || !pageUrl) {
  throw new Error('Restore needs site host, block, setting id, page id and page url (snapshot, CLI or env).');
}
process.env.BLOCK_ID = blockId;
const config = loadConfig();
if (new URL(config.siteDomain || `http://${siteHost}`).host !== siteHost) throw new Error('Configured site host does not match the snapshot site host.');

const out = args.out || path.join('reports', `filter-evidence-control-restore-${Date.now()}.json`);
const lease = acquireFreshRunLease({ siteHost, runId: `filter-evidence-control-restore-${Date.now()}` });
const report = { startedAt: new Date().toISOString(), siteHost, blockId, settingId, pageId, snapshot: snapshotPath };
let browser;
try {
  const session = await launchSession(config);
  browser = session.browser;
  const { page } = await openEditor(await session.context.newPage(), config);
  const { frame } = await gotoFreshTargetPage(page, { kind: pageKind, id: pageId, url: pageUrl, name: pageName });
  const list = listSession({ page, canvas: frame, config });
  const result = await applyListControlPlan(list, snapshot, { restore: true, original: snapshot.original });
  assertControlRestored(result.after, snapshot.original);
  await savePage(page);
  report.after = result.after;
  if (!args['skip-publish']) report.publish = await publishCurrentPage(page);
  else report.publish = { status: 'skipped' };
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error.message).slice(0, 800);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  try { lease.release(); report.leaseReleased = true; } catch { report.leaseReleased = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, error: report.error, out, publish: report.publish, leaseReleased: report.leaseReleased }, null, 2));
}
