// One-command generic onboarding: replace only the target block on an explicitly
// selected page, inventory the resulting fresh instance, write a draft profile,
// then run the ordinary fresh-block flow against the generated requirements.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { savePage } from '../src/editor.mjs';
import { writeCheckpoint } from '../src/run-safety.mjs';
import { createFreshBlockBrowserAdapter } from '../src/fresh-block-browser-adapter.mjs';
import { createFreshSettingsAdapter } from '../src/fresh-settings-adapter.mjs';
import { parseFreshPageConfig, runFreshBlockFlow } from '../src/fresh-block-flow.mjs';
import { assertOnboardingOverwriteAllowed, buildDraftProfile, mapDiscoveredInventory, summarizeDraftMapping } from '../src/onboard-block.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const allowed = new Set(['--block', '--page-kind', '--page-id', '--page-url', '--page-name']);
const env = { ...process.env };
let overwriteReviewed = false;
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (key === '--overwrite-reviewed') { overwriteReviewed = true; continue; }
  if (!allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
    throw new Error('Usage: node scripts/onboard-block.mjs --block <id> --page-kind system --page-id <id> --page-url <path> | --page-kind custom --page-name <name>');
  }
  const value = args[++i];
  if (key === '--block') env.BLOCK_ID = value;
  if (key === '--page-kind') env.FRESH_PAGE_KIND = value;
  if (key === '--page-id') env.FRESH_PAGE_ID = value;
  if (key === '--page-url') env.FRESH_PAGE_URL = value;
  if (key === '--page-name') env.FRESH_PAGE_NAME = value;
}
const blockId = String(env.BLOCK_ID || '').trim();
if (!/^\w[\w-]*$/.test(blockId)) throw new Error('--block <id> is required and must be a valid block number.');
const pageChoice = parseFreshPageConfig(env);
const config = loadConfig();
config.blockId = blockId;
config.projectRoot = root;
if (!config.siteDomain) throw new Error('SITE_DOMAIN is required for host-scoped onboarding.');
config.siteDomain = new URL(/^https?:\/\//i.test(config.siteDomain) ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
const page = pageChoice.kind === 'custom' ? { kind: 'custom', name: pageChoice.name }
  : { kind: 'system', id: pageChoice.id, url: pageChoice.url };
if (page.kind === 'system') {
  const siteDataPath = path.resolve(root, 'sites', config.siteDomain, 'pages.json');
  const siteData = JSON.parse(await fs.readFile(siteDataPath, 'utf8'));
  const matches = Object.values(siteData.pages || {}).filter((item) => String(item.id) === String(page.id)
    && String(item.url).replace(/\/$/, '') === String(page.url).replace(/\/$/, ''));
  if (siteData.siteHost !== config.siteDomain || matches.length !== 1 || !matches[0].editorHref) {
    throw new Error('Selected system page must uniquely match host-scoped page data including editorHref.');
  }
  page.editorHref = matches[0].editorHref;
  page.name = matches[0].name || matches[0].title;
}
const profilePath = path.resolve(root, 'profiles', `${blockId}.json`);
let existing = null;
try { existing = JSON.parse(await fs.readFile(profilePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
try { assertOnboardingOverwriteAllowed(existing, overwriteReviewed); }
catch (error) { throw new Error(`${error.message} Profile: ${profilePath}`); }
const template = JSON.parse(await fs.readFile(path.resolve(root, 'profiles/TEMPLATE.json'), 'utf8'));
const siteHost = config.siteDomain;
const runId = `onboard-${blockId}-${Date.now()}`;
const checkpointPath = path.join(root, '.run-state', `${runId}.json`);
let settingsAdapter = null;
let mappingSummary = null;
let generatedProfile = null;
const session = await launchSession(config);
try {
  const adapter = createFreshBlockBrowserAdapter({ config, session, targetPage: page,
    settingsAdapter: { get batchAdapter() { return settingsAdapter?.batchAdapter; }, prepare: (...input) => settingsAdapter.prepare(...input) },
    discoverAndPrepareSettings: async ({ page: editorPage, frame, inventory }) => {
      const mapping = mapDiscoveredInventory(inventory);
      mappingSummary = summarizeDraftMapping(mapping);
      generatedProfile = buildDraftProfile(template, { blockId, page, mapping });
      await fs.writeFile(profilePath, `${JSON.stringify(generatedProfile, null, 2)}\n`, { mode: 0o644, flag: existing ? 'w' : 'wx' });
      console.log(`[onboard] profile draft written: ${path.relative(root, profilePath)}; auto-mapped=${mappingSummary.autoMappedCount}; unmapped=${mappingSummary.unmappedCount}`);
      const context = { config, session, page, profile: generatedProfile, siteHost, blockId,
        save: () => savePage(editorPage) };
      settingsAdapter = await createFreshSettingsAdapter({ capabilities: generatedProfile.capabilities,
        context, loadCapability: async (id) => import(pathToFileURL(path.join(root, 'src', 'capabilities', `${id}.mjs`)).href) });
      return settingsAdapter.prepare({ page: editorPage, canvas: frame, frame, config });
    } });
  const report = await runFreshBlockFlow({ config: { ...config, siteHost, blockId, page }, adapter, runId,
    onProgress: async (event) => {
      const entry = { at: new Date().toISOString(), ...event };
      console.log(`[onboard-progress] ${JSON.stringify(entry)}`);
      await writeCheckpoint(checkpointPath, { runId, blockId, pageKind: page.kind, stage: event.stage,
        progressAt: entry.at, counts: { target: event.targetCount ?? null, checks: event.checkCount ?? null } });
    } });
  const reportDir = path.resolve(root, config.reportDir || 'reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `fresh-block-${blockId}-${Date.now()}.json`);
  report.onboarding = { profileStatus: 'draft-unreviewed', ...mappingSummary };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const summaryPath = reportPath.replace(/\.json$/, '-summary-zh.md');
  const mapped = mappingSummary.mappedSettingIds.length ? mappingSummary.mappedSettingIds.map((id) => `- ${id}`).join('\n') : '- 无唯一命中的已知设置项';
  const unmapped = mappingSummary.unmappedControls.length ? mappingSummary.unmappedControls.map((item) => `- ${item.regionType || item.kind}：${item.control.label || '(无标签)'} [${item.control.type}]`).join('\n') : '- 无';
  const passes = report.checks.filter((item) => item.status === 'pass').length;
  const fails = report.failures.length;
  await fs.writeFile(summaryPath, `# 区块 ${blockId} 自动接入摘要\n\n- 画像：\`${path.relative(root, profilePath)}\`（草稿，未审核）\n- 前台页面：${report.links.front || '未生成'}\n- 编辑器页面：${report.links.editor || page.editorHref || '未生成'}\n- 自动映射设置：${mappingSummary.autoMappedCount}\n${mapped}\n- 未映射设置：${mappingSummary.unmappedCount}\n${unmapped}\n- 结果：${passes} pass / ${fails} fail；发布=${Boolean(report.publishedAt)}\n- 报告：\`${path.relative(root, reportPath)}\`\n\n自动映射只复用唯一匹配的通用结构签名；预期值、夹具及新断言均未推断，需人工审核草稿画像。\n`);
  console.log(`[onboard] report: ${reportPath}`);
  console.log(`[onboard] Chinese summary: ${summaryPath}`);
  console.log(`[onboard] ${passes} pass / ${fails} fail; published=${Boolean(report.publishedAt)}`);
} finally { await session.browser.close(); }
