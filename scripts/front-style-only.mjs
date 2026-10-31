#!/usr/bin/env node
// Front-only runner for the block-style-spec capability: opens a PUBLIC
// front page (no login, no editor), finds the block by number and runs the
// profile's existing styleSpec assertions (runFrontLayer). Generic: site,
// page URL and block come from arguments; expectations come from the profile.
//
// TLS errors ignored by default like IGNORE_HTTPS_ERRORS=true in config.mjs; --strict-tls 1 to enforce.
// Usage: node scripts/front-style-only.mjs --block <id> --url <frontUrl>
//          [--profile profiles/<id>.json] [--out reports/x.json] [--setting-id <id>] [--channel chrome]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { runFrontLayer } from '../src/capabilities/block-style-spec.mjs';
import { previewSelector } from '../src/capabilities/shared.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const k = process.argv[i];
  if (!k.startsWith('--')) continue;
  args[k.slice(2)] = process.argv[i + 1]; i += 1;
}
if (!args.block || !args.url) {
  console.error('用法：node scripts/front-style-only.mjs --block <id> --url <前台URL> [--profile <json>] [--out <json>]');
  process.exit(2);
}
const blockId = String(args.block);
const profilePath = args.profile || `profiles/${blockId}.json`;
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const capability = (profile.capabilities || []).find((c) => c.id === 'block-style-spec');
if (!capability) { console.error(`${profilePath} 没有 block-style-spec 能力`); process.exit(2); }
const stamp = Date.now();
const out = args.out || `reports/front-style-${blockId}-${stamp}.json`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync('screenshots', { recursive: true });
const config = { blockId, actionTimeoutMs: 30000, navigationTimeoutMs: 60000 };

const browser = await chromium.launch({ headless: true, ...(args.channel ? { channel: args.channel } : {}) });
const report = { flow: 'front-style-only', blockId, url: args.url, settingId: args['setting-id'] || null,
  startedAt: new Date().toISOString(), host: process.platform, checks: [], error: null };
let exitCode = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: args['strict-tls'] !== '1' });
  const page = await context.newPage();
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
  const root = page.locator(previewSelector(blockId));
  await root.first().waitFor({ state: 'attached', timeout: config.actionTimeoutMs });
  report.blockInstances = await root.count();
  report.checks = await runFrontLayer({ frame: page, previewPage: page, config, capability });
  const shots = fs.readdirSync('screenshots').filter((f) => f.startsWith(`style-${blockId}-`));
  report.screenshots = shots.map((f) => `screenshots/${f}`);
} catch (error) {
  report.error = error.message; exitCode = 1;
  try {
    const pg = browser.contexts()[0]?.pages()[0];
    if (pg) {
      report.finalUrl = pg.url(); report.title = await pg.title();
      report.appIdsOnPage = await pg.evaluate(() => [...new Set([...document.querySelectorAll('[data-appid]')].map((e) => e.getAttribute('data-appid')))]);
      const f = `screenshots/front-error-${blockId}-${stamp}.png`;
      await pg.screenshot({ path: f, fullPage: true }); report.errorScreenshot = f;
    }
  } catch {}
} finally {
  await browser.close();
}
const count = (s) => report.checks.filter((c) => c.status === s).length;
report.summary = { pass: count('pass'), fail: count('fail'), na: count('na') + count('skip'), other: report.checks.length - count('pass') - count('fail') - count('na') - count('skip') };
report.finishedAt = new Date().toISOString();
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`[front-style] ${blockId} pass=${report.summary.pass} fail=${report.summary.fail} na=${report.summary.na}${report.error ? ' error=' + report.error : ''} -> ${out}`);
if (report.summary.fail) exitCode = exitCode || 1;
process.exit(exitCode);
