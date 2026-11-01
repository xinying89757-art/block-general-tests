#!/usr/bin/env node
// Front-only runner for the block-style-spec capability: opens a PUBLIC
// front page (no login, no editor), finds the block by number and runs the
// profile's existing styleSpec assertions (runFrontLayer). Generic: site,
// page URL and block come from arguments; expectations come from the profile.
//
// TLS errors ignored by default like IGNORE_HTTPS_ERRORS=true in config.mjs; --strict-tls 1 to enforce.
// Usage: node scripts/front-style-only.mjs --block <id> --url <frontUrl>
//          [--profile profiles/<id>.json] [--run-report reports/run.json] [--out reports/x.json]
//          [--setting-id <id>] [--channel chrome]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { runFrontLayer, resolveFrontStyleCapability } from '../src/capabilities/block-style-spec.mjs';
import { attachFrontStyleInstance, buildFrontStyleExecutionErrors, finalizeFrontStyleReport, preservePartialFrontStyleReport,
  sanitizeFrontStyleError, sanitizeFrontStyleUrl } from '../src/front-style-report.mjs';
import { markUniqueFrontInstance } from '../src/front-instance-root.mjs';
import { buildDesignHumanReview, runDesignSpecFrontChecks, runWrittenColorFrontChecks } from '../src/design-spec-checklist.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const k = process.argv[i];
  if (!k.startsWith('--')) continue;
  args[k.slice(2)] = process.argv[i + 1]; i += 1;
}
if (!args.block || !args.url) {
  console.error('用法：node scripts/front-style-only.mjs --block <id> --url <前台URL> [--profile <json>] [--run-report <json>] [--out <json>]');
  process.exit(2);
}
const blockId = String(args.block);
const profilePath = args.profile || `profiles/${blockId}.json`;
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const capability = (profile.capabilities || []).find((c) => c.id === 'block-style-spec');
if (!capability && !profile.designSpec) { console.error(`${profilePath} 没有 block-style-spec 或 designSpec`); process.exit(2); }
const settingsReport = args['run-report'] ? JSON.parse(fs.readFileSync(args['run-report'], 'utf8')) : null;
if (settingsReport && String(settingsReport.blockId ?? '') !== blockId) {
  console.error(`运行报告区块 ID 与目标不一致：预期 ${blockId}，实际 ${settingsReport.blockId ?? 'missing'}`);
  process.exit(2);
}
if (settingsReport?.block?.settingId && args['setting-id']
  && String(settingsReport.block.settingId) !== String(args['setting-id'])) {
  console.error('运行报告 settingId 与 --setting-id 不一致。');
  process.exit(2);
}
const resolvedCapability = capability ? resolveFrontStyleCapability(capability, settingsReport) : null;
const stamp = Date.now();
const out = args.out || `reports/front-style-${blockId}-${stamp}.json`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync('screenshots', { recursive: true });
const config = { blockId, actionTimeoutMs: 30000, navigationTimeoutMs: 60000 };

const report = { flow: 'front-style-only', blockId, url: sanitizeFrontStyleUrl(args.url),
  settingId: args['setting-id'] || settingsReport?.block?.settingId || null,
  startedAt: new Date().toISOString(), host: process.platform, checks: [], error: null };
let exitCode = 0;
let stage = 'launch-browser';
let browser;
const configuredTimeout = Number(args['global-timeout-ms'] || process.env.FRONT_STYLE_TIMEOUT_MS || 480000);
const configuredStateActionTimeout = Number(args['state-action-timeout-ms'] || 4000);
const configuredStateOverallTimeout = Number(args['state-timeout-ms'] || 45000);
const globalTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.max(1000, configuredTimeout) : 480000;
const stateActionTimeoutMs = Number.isFinite(configuredStateActionTimeout) && configuredStateActionTimeout > 0
  ? Math.max(100, configuredStateActionTimeout) : 4000;
const stateOverallTimeoutMs = Number.isFinite(configuredStateOverallTimeout) && configuredStateOverallTimeout > 0
  ? Math.max(stateActionTimeoutMs, configuredStateOverallTimeout) : 45000;
let abortReason = null;
const progress = (name) => console.log(`[front-style] stage=${name}`);
const abortRun = (kind) => {
  if (abortReason) return;
  abortReason = { kind, stage, at: new Date().toISOString() };
  report.partial = true;
  report.interruption = abortReason;
  progress(`${kind.toLowerCase()}-requested`);
  browser?.close().catch(() => {});
};
const globalTimer = setTimeout(() => abortRun('GLOBAL_TIMEOUT'), globalTimeoutMs);
const onSigint = () => abortRun('SIGINT');
const onSigterm = () => abortRun('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);
try {
  progress(stage);
  browser = await chromium.launch({ headless: true, ...(args.channel ? { channel: args.channel } : {}) });
  if (abortReason) throw new Error(`Front style run interrupted: ${abortReason.kind}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: args['strict-tls'] !== '1' });
  const page = await context.newPage();
  stage = 'navigate';
  progress(stage);
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
  stage = 'locate-block';
  progress(stage);
  const settingId = args['setting-id'] || settingsReport?.block?.settingId || null;
  const markedRoot = await markUniqueFrontInstance(page, { blockId, settingId, markerValue: `front-style-${Date.now()}` });
  report.blockInstances = markedRoot.rootCount;
  report.settingId = settingId;
  report.instanceResolution = 'block-number+settingId';
  config.rootSelector = markedRoot.selector;
  config.settingId = settingId;
  stage = 'read-style';
  progress('style-checks');
  report.expectedValueSourceReport = args['run-report'] || null;
  try {
    const incrementalStyleChecks = new Map();
    const styleChecks = capability && (capability.styleSpec?.items?.length || capability.styleSpec?.recordOnly?.length)
      ? await runFrontLayer({ frame: page, previewPage: page, config,
        capability: { ...resolvedCapability, designSpec: profile.designSpec }, onProgress: progress,
        onCheck: (check) => {
          incrementalStyleChecks.set(check.id, check);
          report.checks = attachFrontStyleInstance([...incrementalStyleChecks.values()], report.settingId);
        } }) : [];
    report.checks = attachFrontStyleInstance(styleChecks, report.settingId);
    progress(`style-checks-complete count=${styleChecks.length}`);
    stage = 'design-spec-checks'; progress(stage);
    const designChecks = await runDesignSpecFrontChecks(profile, { page, rootSelector: config.rootSelector,
      frontChecks: styleChecks, settingsReport, viewport: { label: 'pc', width: 1440, height: 900 },
      onProgress: progress, onCheck: (check) => {
        report.checks = attachFrontStyleInstance([...styleChecks, ...report.checks.filter((row) => row.id.startsWith('design-')),
          ...(check ? [check] : [])], report.settingId);
      } });
    report.checks = attachFrontStyleInstance([...styleChecks, ...designChecks.filter(Boolean)], report.settingId);
    progress(`design-spec-checks-complete count=${designChecks.filter(Boolean).length}`);
    stage = 'written-color-checks'; progress(stage);
    const writtenColors = await runWrittenColorFrontChecks({ page, rootSelector: config.rootSelector, settingsReport,
      includeStylesheets: args['include-stylesheets'] !== '0', stateExercise: args['exercise-states'] === '1',
      stateActionTimeoutMs, stateOverallTimeoutMs, onProgress: progress });
    report.checks = attachFrontStyleInstance([...report.checks, ...writtenColors], report.settingId);
    progress(`written-color-checks-complete count=${writtenColors.length}`);
    report.finalUrl = sanitizeFrontStyleUrl(page.url());
  } finally { await markedRoot.clear().catch(() => {}); }
  const shots = fs.readdirSync('screenshots').filter((f) => f.startsWith(`style-${blockId}-`));
  report.screenshots = shots.map((f) => `screenshots/${f}`);
} catch (error) {
  const safe = sanitizeFrontStyleError(error);
  report.error = safe.message; exitCode = 1;
  if (!report.checks.length) report.checks = attachFrontStyleInstance(buildFrontStyleExecutionErrors({ capability, blockId, stage, error: safe,
    viewport: capability.styleSpec?.viewports }), report.settingId);
  else Object.assign(report, preservePartialFrontStyleReport(report, { stage, error: safe }));
  try {
    const pg = browser?.contexts()[0]?.pages()[0];
    if (pg) {
      report.finalUrl = sanitizeFrontStyleUrl(pg.url());
      const f = `screenshots/front-error-${blockId}-${stamp}.png`;
      await pg.screenshot({ path: f, fullPage: true }); report.errorScreenshot = f;
    }
  } catch {}
  if (report.errorScreenshot) {
    for (const check of report.checks) if (check.reason) check.reason.screenshot = report.errorScreenshot;
  }
} finally {
  clearTimeout(globalTimer);
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  if (browser) await browser.close().catch(() => {});
}
Object.assign(report, finalizeFrontStyleReport(report));
report.humanReview = buildDesignHumanReview(profile, report.checks);
report.finishedAt = new Date().toISOString();
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`[front-style] ${blockId} pass=${report.summary.pass} fail=${report.summary.fail} na=${report.summary.na}${report.error ? ' error=' + report.error : ''} -> ${out}`);
if (report.summary.fail) exitCode = exitCode || 1;
process.exit(exitCode);
