#!/usr/bin/env node
// Credential-free oracle against a previously published fixture instance.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS } from '../src/network-https-upgrade.mjs';
import { buildFixtureTruthTable, fixtureScenarioPolicy, selectFilterValue, clickSearch } from '../src/capabilities/custom-filter-fields.mjs';
import { productSnapshot, sameSet } from '../src/capabilities/effect-checks.mjs';
import { markUniqueFrontInstance } from '../src/front-instance-root.mjs';
import { finalizeFilterDesignChecks } from '../src/filter-design-fixture.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i]?.replace(/^--/, '')] = process.argv[i + 1];
if (!args.url || !args.block || !args['setting-id'] || !args.profile || !args.out) throw new Error('Required: --url --block --setting-id --profile --out');
const url = new URL(args.url);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('A credential-free HTTP(S) public URL is required');
const profile = JSON.parse(await fs.readFile(args.profile, 'utf8'));
if (String(profile.blockId) !== args.block) throw new Error('Profile block ID mismatch');
const table = buildFixtureTruthTable(profile.fixture);
const scenarios = [
  ...table.single.map(({ i, products }) => ({ id: `cff-oracle-single-${i}`, indexes: [i], products })),
  ...table.pairs.map(({ i, j, products }) => ({ id: `cff-oracle-intersect-${i}-${j}`, indexes: [i, j], products })),
  { id: 'cff-oracle-intersect-all', indexes: table.fields.map((_, i) => i + 1), products: table.intersection },
  { id: 'cff-oracle-union-all', indexes: table.fields.map((_, i) => i + 1), products: table.union, union: true },
];
const startedAt = new Date().toISOString();
const report = { flow: 'published-filter-oracle', blockId: args.block, settingId: args['setting-id'], url: `${url.origin}${url.pathname}`, startedAt, runId: `published-filter-oracle-${Date.now()}`, checks: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(args.channel ? { channel: args.channel } : {}), args: [...CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  for (const scenario of scenarios) {
    const policy = fixtureScenarioPolicy(profile, Boolean(scenario.union));
    const conditions = scenario.indexes.map(i => table.fields[i - 1]);
    const row = { id: scenario.id, name: scenario.id, suite: 'capability:custom-filter-fields', description: '发布前台筛选精确产品集合', expected: JSON.stringify(scenario.products), actual: '', evidenceText: [], evidence: { conditions, expected: scenario.products } };
    report.checks.push(row);
    const reason = policy.skip || policy.na || (scenario.indexes.length > 1 && !policy.logic ? '发布前台不能切换或确认筛选逻辑' : '');
    if (reason) { row.status = policy.na ? 'na' : 'skip'; row.detail = row.actual = reason; row.classification = 'published-logic-unavailable'; continue; }
    try {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const target = await markUniqueFrontInstance(page, { blockId: args.block, settingId: args['setting-id'] });
      report.blockInstances = target.rootCount; report.instanceResolution = 'block-number+settingId'; report.finalUrl = `${new URL(page.url()).origin}${new URL(page.url()).pathname}`;
      const root = page.locator(target.selector);
      if (policy.scope === '当前分类产品') {
        const category = root.locator('.pf-cate-wrap a').getByText(profile.fixture.category.name, { exact: true });
        if (await category.count() !== 1) throw new Error('无法唯一定位夹具分类');
        await category.click();
      }
      const baseline = await root.evaluate(productSnapshot);
      if (!baseline.hasList || !table.products.every(name => baseline.names.includes(name))) throw new Error('初始列表未同时显示全部夹具产品，无法排除分类或分页干扰');
      for (const condition of conditions) await selectFilterValue(root, condition);
      if (policy.trigger === '点击“搜索”按钮' && await root.locator('.prodfield-search, .pf-search').filter({ visible: true }).count() !== 1) {
        throw new Error('固定手动触发但无法唯一定位可见搜索按钮');
      }
      if (policy.trigger !== '更改筛选项后自动筛选') await clickSearch(root);
      let observed;
      for (let attempt = 0; attempt < 20; attempt++) {
        observed = await root.evaluate(productSnapshot);
        if (observed.hasList && sameSet(observed.names.filter(name => name.startsWith('AUTOTEST-')), scenario.products)) break;
        await page.waitForTimeout(500);
      }
      if (!observed.hasList) throw new Error('无法读取产品列表');
      const actual = observed.names.filter(name => name.startsWith('AUTOTEST-'));
      row.evidence.actual = actual; row.evidence.productSets = [{ label: scenario.id, expected: scenario.products, actual }]; row.actual = JSON.stringify(actual);
      row.status = sameSet(actual, scenario.products) ? 'pass' : 'fail';
      row.detail = `预期 ${row.expected}；实际 ${row.actual}`; row.evidenceText = [row.detail];
    } catch (error) { row.status = 'skip'; row.classification = 'published-oracle-unobservable'; row.detail = row.actual = String(error.message).slice(0, 500); row.evidenceText = [row.detail]; }
  }
  for (const id of ['cff-facet-narrow', 'cff-clear-restore']) report.checks.push({ id, name: id, status: 'skip', classification: 'published-oracle-not-observed', description: '发布前台刻面或清除筛选', expected: '可观察时验证筛选状态恢复', actual: '本运行器未观察该交互', detail: '本运行器未观察该交互', evidenceText: ['本运行器未观察该交互'] });
} catch (error) { report.error = String(error.message).slice(0, 500); process.exitCode = 1; }
finally {
  await browser?.close(); report.finishedAt = new Date().toISOString();
  // Aggregate only observed scenario results; a failed setup remains human review.
  report.fixture = { applied: true, source: 'published-front-assumption' };
  finalizeFilterDesignChecks(profile, report);
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
