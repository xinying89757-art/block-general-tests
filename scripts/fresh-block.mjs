import { prepareFixture, restoreFixture } from '../src/fixture.mjs';
import { fixtureOracleChecks, runFrontLayer as runFilterFrontLayer } from '../src/capabilities/custom-filter-fields.mjs';
import { reloadEditor, openPreview } from '../src/editor.mjs';
import { finalizeFilterDesignChecks, isFilterSupportedTypes } from '../src/filter-design-fixture.mjs';
import { countVerdicts, collectHumanReview } from '../src/human-review.mjs';
import { accountDesignRequirementCoverage } from '../src/design-spec-model.mjs';
import { verdictCountsZh } from '../src/human-review.mjs';
// Explicit fresh-block workflow. Capability-owned definitions feed one shared
// batch adapter; unsupported capabilities stay visible as not-adapted.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { redact } from '../src/run.mjs';
import { launchSession } from '../src/browser.mjs';
import { acquireRunLock } from '../src/run-lock.mjs';
import { savePage } from '../src/editor.mjs';
import { writeCheckpoint } from '../src/run-safety.mjs';
import { createFreshBlockBrowserAdapter } from '../src/fresh-block-browser-adapter.mjs';
import { createFreshSettingsAdapter } from '../src/fresh-settings-adapter.mjs';
import { parseFreshPageConfig, runFreshBlockFlow, targetBlockInstances } from '../src/fresh-block-flow.mjs';
import { runDesignSpecEditorChecks } from '../src/design-spec-checklist.mjs';
import { detectPreviewAvailable, resolveFrontMode } from '../src/front-provider.mjs';
import { runFrontChecks } from '../src/front-check-runner.mjs';
import { runFinalFrontChecks } from '../src/fresh-front-final.mjs';
import { acquireFreshRunLease } from '../src/fresh-run-lease.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function cliEnv(argv, env) {
  const mapped = { '--page-kind': 'FRESH_PAGE_KIND', '--page-name': 'FRESH_PAGE_NAME',
    '--page-id': 'FRESH_PAGE_ID', '--page-url': 'FRESH_PAGE_URL' };
  const result = { ...env };
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapped[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Usage: node scripts/fresh-block.mjs --page-kind custom --page-name <name> | --page-kind system --page-id <id> --page-url <url>`);
    }
    result[key] = argv[++index];
  }
  return result;
}

const env = cliEnv(process.argv.slice(2), process.env);
const pageChoice = parseFreshPageConfig(env);
const config = loadConfig();
config.projectRoot = root;
if (!config.siteDomain) throw new Error('SITE_DOMAIN is required for host-scoped defaults.');
config.siteDomain = new URL(/^https?:\/\//i.test(config.siteDomain) ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
const page = pageChoice.kind === 'custom'
  ? { kind: 'custom', name: pageChoice.name }
  : { kind: 'system', id: pageChoice.id, url: pageChoice.url };
const siteHost = config.siteDomain;
if (page.kind === 'system') {
  const siteDataPath = path.resolve(root, 'sites', siteHost, 'pages.json');
  const siteData = JSON.parse(await fs.readFile(siteDataPath, 'utf8'));
  const matches = Object.values(siteData.pages || {}).filter((item) => String(item.id) === String(page.id)
    && String(item.url).replace(/\/$/, '') === String(page.url).replace(/\/$/, ''));
  if (siteData.siteHost !== siteHost || matches.length !== 1) {
    throw new Error('Selected system page does not uniquely match the configured site page data; refusing to open the editor.');
  }
  if (!matches[0].editorHref) throw new Error('Selected system page record has no page-specific editorHref; refusing to report a generic editor URL.');
  page.editorHref = matches[0].editorHref;
}
const profilePath = path.resolve(root, 'profiles', `${config.blockId}.json`);
const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
if (String(profile.blockId) !== String(config.blockId)) throw new Error('Profile block identity does not match BLOCK_ID.');
const runLock = acquireRunLock({ site: config.siteDomain, mode: `fresh-block:${config.blockId}` });
let siteLease;
try { siteLease = acquireFreshRunLease({ siteHost: config.siteDomain, runId: `fresh-${config.blockId}-${Date.now()}` }); }
catch (error) { runLock.release(); throw error; }
let session;
try {
  session = await launchSession(config);
  const requestedMode = String(env.FRONT_PROVIDER ?? '').trim().toLowerCase();
  const explicitMode = requestedMode === 'preview' || requestedMode === 'published';
  if (!explicitMode) process.env.FRONT_PROVIDER = 'auto';
  let frontMode = explicitMode ? resolveFrontMode(env) : null;
  if (frontMode) process.env.FRONT_PROVIDER = frontMode.frontMode;
  const runId = `fresh-${config.blockId}-${Date.now()}`;
  const checkpointPath = path.join(root, '.run-state', `${runId}.json`);
  const settingsAdapter = await createFreshSettingsAdapter({
    capabilities: profile.capabilities || [],
    context: { config, session, page, profile, siteHost, blockId: config.blockId,
      save: () => savePage(session.page),
      persistProfile: async (nextProfile) => {
        const temporary = `${profilePath}.${process.pid}.tmp`;
        await fs.writeFile(temporary, `${JSON.stringify(nextProfile, null, 2)}\n`, { mode: 0o600 });
        await fs.rename(temporary, profilePath);
      } },
    loadCapability: async (id) => import(pathToFileURL(path.join(root, 'src', 'capabilities', `${id}.mjs`)).href),
  });
  const adapter = createFreshBlockBrowserAdapter({ config, session,
    targetPage: page, settingsAdapter });
  const flowConfig = { ...config, projectRoot: root, siteHost, blockId: config.blockId, page,
    frontMode: frontMode?.frontMode || 'preview', frontModeReason: frontMode?.frontModeReason || 'auto-detection-pending' };
  let report;
  if (env.FRESH_REUSE_EXISTING === '1') {
    const opened = await adapter.openPage(page);
    const instances = targetBlockInstances(await adapter.listAllBlockInstances(), config.blockId);
    if (instances.length !== 1 || !instances[0].settingId) throw new Error('复用模式要求页面恰有一个可识别的目标区块实例。');
    if (env.FRESH_SETTING_ID && instances[0].settingId !== env.FRESH_SETTING_ID) throw new Error('目标实例与指定 settingId 不符，拒绝运行。');
    config.freshSettingId = instances[0].settingId;
    process.env.FRONT_PROVIDER = 'preview';
    frontMode = { frontMode: 'preview', frontModeReason: 'reuse-existing-preview' };
    report = { schemaVersion: 1, flow: 'fresh-block-reuse-fixture-oracle', runId, siteHost, blockId: config.blockId,
      page, block: instances[0], lifecycle: { reusedSettingId: instances[0].settingId }, links: opened,
      frontMode: 'preview', checks: await runDesignSpecEditorChecks({ ...profile, designSpec: { ...profile.designSpec,
        requirements: (profile.designSpec?.requirements || []).filter(isFilterSupportedTypes) } }, []), capabilities: [],
      publishedConfirmed: false, flowErrors: [], startedAt: new Date().toISOString() };
  } else report = await runFreshBlockFlow({ config: flowConfig,
    adapter, runId,
    onPageOpened: async () => {
      if (!frontMode) {
        const detection = await detectPreviewAvailable(session.page, session.context);
        frontMode = resolveFrontMode(env, detection);
        flowConfig.frontMode = frontMode.frontMode;
        flowConfig.frontModeReason = frontMode.frontModeReason;
        process.env.FRONT_PROVIDER = frontMode.frontMode;
      }
    },
    onProgress: async (event) => {
      siteLease.assertValid();
      const entry = { at: new Date().toISOString(), ...event };
      console.log(`[fresh-progress] ${JSON.stringify(entry)}`);
      await writeCheckpoint(checkpointPath, { runId, blockId: config.blockId, pageKind: page.kind,
        stage: event.stage, progressAt: entry.at, counts: { target: event.targetCount ?? null, checks: event.checkCount ?? null } });
    } });
  siteLease.assertValid();
  if (profile.fixture && profile.capabilities?.some(item => item.id === 'custom-filter-fields')) {
    let preparation;
    try {
      const canvas = (await reloadEditor(session.page, config)).frame;
      preparation = await prepareFixture({ page: session.page, canvas, context: session.context, config, profile });
      report.fixture = { applied: !preparation.skipped, records: preparation.records, writes: preparation.writes,
        ...(preparation.skipped ? { reason: '筛选字段组不可用。' } : {}) };
      report.checks.push(...preparation.checks);
      if (!preparation.skipped) {
        let preview;
        try {
          preview = await openPreview(session.page, session.context);
          report.checks.push(...await runFilterFrontLayer({ frame: preview.frame, config }));
        } catch (error) {
          report.checks.push({ id: 'cff-preview-unavailable', status: 'skip', detail: error.message });
        } finally { await preview?.previewPage.close().catch(() => {}); }
      }
      const currentCanvas = (await reloadEditor(session.page, config)).frame;
      const capability = profile.capabilities.find(item => item.id === 'custom-filter-fields');
      report.checks.push(...await fixtureOracleChecks({ page: session.page, canvas: currentCanvas, context: session.context, config, profile, capability, report }));
    } catch (error) {
      preparation ||= error.fixturePreparation;
      report.fixture = { applied: false, reason: error.message, failedStep: error.fixtureStep || null,
        records: preparation?.records, writes: preparation?.writes };
      report.checks.push(...(preparation?.checks || []), { id: 'fixture-prep', name: 'AUTOTEST 夹具准备', status: 'fail', detail: error.message });
    } finally {
      if (preparation?.originalFieldStates && !preparation.restored) {
        try {
          const canvas = (await reloadEditor(session.page, config)).frame;
          await restoreFixture({ page: session.page, canvas, config, originalFieldStates: preparation.originalFieldStates });
          report.fixture.restored = true;
        } catch (error) {
          report.fixture.restored = false;
          report.checks.push({ id: 'fixture-restore', name: '夹具设置恢复', status: 'fail', detail: error.message });
        }
      }
    }
  }
  finalizeFilterDesignChecks(profile, report);
  report.summary = countVerdicts(report.checks);
  report.failures = report.checks.filter(check => check.status === 'fail').map(check => ({ checkId: check.id, detail: check.detail, expected: check.expected, actual: check.actual }));
  report.finishedAt = new Date().toISOString();
  report.humanReview = collectHumanReview(report.checks);
  report.designRequirementCoverage = accountDesignRequirementCoverage(profile, report.checks);
  if (report.publishedConfirmed) {
    const frontPage = await session.context.newPage();
    try {
      const finalFront = await runFinalFrontChecks({ report, mode: frontMode.frontMode, frontLink: report.links?.front,
        page: frontPage, runChecks: (pageHandle) => runFrontChecks({ page: pageHandle, profile,
          blockId: config.blockId, settingId: report.block?.settingId || null,
          settingsReport: { block: report.block, checks: report.checks, styleScopeLearning: report.styleScopeLearning },
          imageLoadTimeoutMs: config.imageLoadTimeoutMs, actionTimeoutMs: config.actionTimeoutMs }) });
      report = finalFront.report;
    } finally { await frontPage.close().catch(() => {}); }
  }
  siteLease.assertValid();
  const reportDir = path.resolve(root, config.reportDir || 'reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `fresh-block-${config.blockId}-${Date.now()}.json`);
  const safeReport = redact(report, config);
  await fs.writeFile(reportPath, `${JSON.stringify(safeReport, null, 2)}\n`);
  if (safeReport.summary.fail > 0) process.exitCode = 1;
  console.log(`[fresh-block] report: ${reportPath}`);
  const notAdapted = safeReport.capabilities.filter((item) => item.status === 'not-adapted').length;
  console.log(`[fresh-block] ${verdictCountsZh(safeReport.summary)} / ${notAdapted} not-adapted capabilities; published=${Boolean(safeReport.publishedConfirmed ?? safeReport.publishedAt)}`);
} finally {
  try { await session?.browser.close(); }
  finally { try { siteLease.release(); } finally { runLock.release(); } }
}
