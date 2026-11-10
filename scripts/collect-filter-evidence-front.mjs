#!/usr/bin/env node
// Credential-free public-front evidence: cache-busted HTML, data-filterfields,
// response headers, optional control-change verification, and one selected
// filter value with network + product list. Identity from CLI / profile / env.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS } from '../src/network-https-upgrade.mjs';
import { markUniqueFrontInstance } from '../src/front-instance-root.mjs';
import { productSnapshot, sameSet } from '../src/capabilities/effect-checks.mjs';
import { selectFilterValue } from '../src/capabilities/custom-filter-fields.mjs';
import {
  parseArgv, loadJsonFile, resolveFilterEvidenceTarget, readInstanceFilterAttrsFn,
  cacheBustedFrontUrl, suggestFilterEvidenceClassification,
} from '../src/filter-evidence.mjs';
import { loadFixtureState } from '../src/fixture-state.mjs';
import { readFrontPaginationFn, assessPublishedPageCount } from '../src/filter-evidence-control.mjs';

const args = parseArgv(process.argv.slice(2));
const profile = args.profile ? loadJsonFile(args.profile) : {};
const boxReport = args['box-report'] ? loadJsonFile(args['box-report']) : null;
const fixtureStatePath = args['fixture-state'] || process.env.FIXTURE_STATE || null;
const fixtureState = fixtureStatePath ? loadFixtureState(fixtureStatePath) : null;
const target = resolveFilterEvidenceTarget({ args, env: process.env, profile, fixtureState });
const frontUrl = args.url || `http://${target.siteHost}${target.pageUrl.startsWith('/') ? target.pageUrl : `/${target.pageUrl}`}`;
const outDir = args.out || path.join('reports', `filter-evidence-front-${Date.now()}`);
fs.mkdirSync(outDir, { recursive: true });
const write = (name, value) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
};
const pageUrl = cacheBustedFrontUrl(frontUrl);
const report = { startedAt: new Date().toISOString(), url: pageUrl, target: { ...target, fixture: undefined } };
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(args.channel ? { channel: args.channel } : {}),
    args: [...CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const requests = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!/product|filter|prodfield|pf-|ajax|phoenix/i.test(url)) return;
    let body = '';
    try { body = (await response.text()).slice(0, 2000); } catch {}
    requests.push({ url, status: response.status(), headers: response.headers(), bodySnippet: body });
  });
  const nav = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  write('04-response-headers.json', { status: nav?.status() ?? null, headers: nav ? nav.headers() : {}, finalUrl: page.url() });
  write('04-published-front.html', await page.content());
  await page.screenshot({ path: path.join(outDir, '04-published-front.png'), fullPage: true });
  const marked = await markUniqueFrontInstance(page, { blockId: target.blockId, settingId: target.settingId });
  const attrs = await page.locator(marked.selector).evaluate(readInstanceFilterAttrsFn(), { blockId: target.blockId, settingId: target.settingId });
  const baseline = await page.locator(marked.selector).evaluate(productSnapshot);
  const fixtureNames = target.products;
  write('04-published-attrs.json', {
    ...attrs,
    baseline: {
      names: baseline.names,
      fixtureNames: baseline.names.filter((name) => fixtureNames.includes(name)),
      count: baseline.count,
      hasList: baseline.hasList,
    },
  });
  report.published = attrs;
  const control = boxReport?.steps?.controlChange || boxReport?.controlChange;
  if (control?.applied && control.expectedPages != null) {
    const pagination = await page.locator(marked.selector).evaluate(readFrontPaginationFn());
    const assessed = assessPublishedPageCount(pagination.pageCount, control.expectedPages);
    report.controlChange = { ...control, ...assessed, pagination };
    write('05-control-change-verified.json', report.controlChange);
    if (!assessed.verified) throw new Error(`Published page count is ${assessed.actualPages}, expected ${assessed.expectedPages}.`);
  }

  if (!target.select) throw new Error('A select title and value are required (profile fixture or --select-title / --select-value).');
  const root = page.locator(marked.selector);
  await selectFilterValue(root, target.select);
  await page.waitForTimeout(2000);
  const after = await root.evaluate(productSnapshot);
  await page.screenshot({ path: path.join(outDir, '06-after-select.png'), fullPage: true });
  const selected = await root.evaluate((node, wanted) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return {
      select: [...node.querySelectorAll('select')].flatMap((s) => [...s.selectedOptions].map((o) => norm(o.textContent))),
      checked: [...node.querySelectorAll('label')].filter((label) => label.querySelector('input:checked')).map((label) => norm(label.innerText)),
      text: [...node.querySelectorAll('input[type="text"], textarea')].map((input) => input.value),
      wanted,
    };
  }, target.select.value);
  const confirmed = selected.select.includes(target.select.value)
    || selected.checked.includes(target.select.value)
    || selected.text.includes(target.select.value);
  const actualFixture = after.names.filter((name) => fixtureNames.includes(name));
  const beforeFixture = baseline.names.filter((name) => fixtureNames.includes(name));
  report.selection = {
    confirmed,
    selected,
    actualFixtureNames: actualFixture,
    baselineFixtureNames: beforeFixture,
    setUnchanged: sameSet(actualFixture, beforeFixture) || (actualFixture.length === fixtureNames.length && fixtureNames.every((name) => actualFixture.includes(name))),
  };
  write('06-select-network.json', { ...report.selection, requests: requests.slice(-40) });
  report.classification = suggestFilterEvidenceClassification({
    fields: target.fields,
    editorSettingsAfterSave: boxReport?.steps?.editorSettingsAfterSave,
    canvas: boxReport?.steps?.canvas,
    published: report.published,
    controlChange: report.controlChange,
    selection: report.selection,
  });
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error.message).slice(0, 800);
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  write('00-front-report.json', report);
  console.log(JSON.stringify({
    ok: report.ok, error: report.error, out: outDir,
    published: report.published && { attributePresent: report.published.attributePresent, rawFilterfields: report.published.rawFilterfields },
    selection: report.selection, controlChange: report.controlChange && { verified: report.controlChange.verified, actualPages: report.controlChange.actualPages, expectedPages: report.controlChange.expectedPages }, classification: report.classification,
  }, null, 2));
}
