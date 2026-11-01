import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { launchSession } from './browser.mjs';
import { openEditor, ensureTargetPage, addBlockIfNeeded, savePage, openPreview, resolveTargetPage, getPreviewShareLink } from './editor.mjs';
import { applyBaseline, captureBaseline } from './baseline.mjs';
import { baselineValueFor, guardBaseline } from './baseline-guard.mjs';
import { prepareFixture, restoreFixture } from './fixture.mjs';
import { runFrontChecks } from './checks.mjs';
import { frontRunPhases, shouldRunLayer } from './front-results.mjs';
import * as customFilterFields from './capabilities/custom-filter-fields.mjs';
import * as productListDisplay from './capabilities/product-list-display.mjs';
import * as buttonLink from './capabilities/button-link.mjs';
import * as productCategorySelect from './capabilities/product-category-select.mjs';
import * as blockColorScheme from './capabilities/block-color-scheme.mjs';
import * as moduleWidth from './capabilities/module-width.mjs';
import * as blockStyleSpec from './capabilities/block-style-spec.mjs';
import { checkReportText } from './capabilities/shared.mjs';
import { acquireRunLock } from './run-lock.mjs';
import { createPauseDetector, createProgressWatchdog, retryWithEnvironmentRecovery, RunTimeoutError, withTimeout, writeCheckpoint } from './run-safety.mjs';
import { spawnSync } from 'node:child_process';
import { readSiteBaseline, writeSiteBaseline } from './site-baseline.mjs';
import { verifyBaselineWithRecovery } from './batch-save.mjs';
export { frontRunPhases, shouldRunLayer } from './front-results.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const capabilityRegistry = {
  'custom-filter-fields': customFilterFields,
  'product-list-display': productListDisplay,
  'button-link': buttonLink,
  'product-category-select': productCategorySelect,
  'block-color-scheme': blockColorScheme,
  'module-width': moduleWidth,
  'block-style-spec': blockStyleSpec,
};

export function deferredCheck(id, name = id) {
  return { id, name, suite: 'front-runner', status: 'deferred', detail: 'deferred-to-front-runner',
    ...checkReportText(name, 'deferred', 'deferred-to-front-runner', { deferred: true }, id) };
}

export function deferredCapabilityChecks(capability) {
  const ids = {
    'button-link': ['btn-front-text'],
    'product-list-display': ['pld-front-note'],
    'product-category-select': ['pcs-front-note'],
    'custom-filter-fields': ['cff-groups-baseline', 'cff-facet-narrow', 'cff-clear-restore'],
    'block-style-spec': [...(capability.styleSpec?.items || []).map((item) => `bss-${item.id}`),
      ...((capability.styleSpec?.items || []).some((item) => item.clamp) ? ['bss-product-name-clamp'] : [])],
  }[capability.id] || [];
  return ids.map((id) => deferredCheck(id, id));
}

export async function runCapabilityLayer(capabilities, layer, args, registry = capabilityRegistry) {
  const checks = [];
  const { profile } = args;
  const method = { settings: 'runSettingsLayer', backend: 'runBackendLayer', front: 'runFrontLayer' }[layer];
  // capabilities are profile entries, not bare ids: a module may need its
  // profile parameters (dialogTitle, wrapIndex, variant) to locate its dialog
  // when several sub-regions share one editor type.
  for (const capability of capabilities) {
    const id = capability.id;
    const module = registry[id];
    if (args.config?.checkGroup) {
      const layers = module?.checkGroups?.[args.config.checkGroup];
      if (!layers?.includes(layer)) continue;
    }
    let selectedMethod = method;
    if (layer === 'settings' && args.config?.batchSave && typeof module?.runBatchSettingsLayer === 'function') {
      selectedMethod = 'runBatchSettingsLayer';
    }
    if (layer === 'settings' && args.config?.frontOnly) {
      if (typeof module?.runFrontEffectsLayer === 'function') selectedMethod = 'runFrontEffectsLayer';
      else if (['block-color-scheme', 'module-width'].includes(id)) selectedMethod = 'runSettingsLayer';
      else continue;
    }
    if (typeof module?.[selectedMethod] !== 'function') continue;
    if (layer === 'front' && args.config?.deferFront) {
      checks.push(...deferredCapabilityChecks(capability));
      continue;
    }
    const previousCapabilityId = args.config?.baselineCapabilityId;
    const previousReplayMode = args.config?.replayCachedCheck;
    if (args.config) args.config.baselineCapabilityId = id;
    console.log(`[progress] ${new Date().toISOString()} 能力 ${id} ${layer} 层开始`);
    args.config?.watchdogProgress?.();
    try {
      let returned;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0 && args.config) args.config.replayCachedCheck = true;
        try {
          returned = await withTimeout(() => module[selectedMethod]({ ...args, capability, profile }),
            args.config?.layerTimeoutMs || 600_000, `能力 ${id} ${layer} 层`, {
              onTimeout: (error) => args.config?.abortEnvironment?.(error.envStatus),
            });
          const envChecks = returned.filter((item) => ['env-paused', 'env-timeout'].includes(item.status));
          if (!envChecks.length) break;
          if (attempt === 1 || typeof args.config?.recoverEnvironment !== 'function') break;
          Object.assign(args, await args.config.recoverEnvironment(envChecks[0].status));
        } catch (error) {
          const environmentStatus = error.envStatus || args.config?.environmentStatus
            || (error instanceof RunTimeoutError ? error.envStatus : null);
          if (!(environmentStatus === 'env-paused' || environmentStatus === 'env-timeout') || attempt === 1
            || typeof args.config?.recoverEnvironment !== 'function') throw error;
          Object.assign(args, await args.config.recoverEnvironment(environmentStatus));
        }
      }
      if (returned) {
        const environmentIssue = returned.find((item) => ['env-paused', 'env-timeout'].includes(item.status));
        if (environmentIssue) {
          const replacement = { ...environmentIssue, status: environmentIssue.status,
            evidence: { ...(environmentIssue.evidence || {}), retryExhausted: true } };
          returned = returned.map((item) => item.id === replacement.id ? replacement : item);
        }
        checks.push(...returned);
        for (const check of returned) await args.config?.checkpointCheck?.(check, id, layer);
        await captureCheckScreenshots(returned, layer === 'front' ? args.previewPage : args.page,
          args.screenshotDir, args.runId, args.report, layer);
      }
    }
    catch (error) {
      const name = `${id} ${layer} 层异常`;
      const status = error.envStatus || args.config?.environmentStatus
        || (error instanceof RunTimeoutError ? 'env-timeout' : 'fail');
      const check = { id: `${id}-${layer}-error`, name,
        status, detail: error.message, suite: `capability:${id}`,
        ...checkReportText(name, status, error.message) };
      checks.push(check);
      await args.config?.checkpointCheck?.(check, id, layer);
      await captureCheckScreenshots([check], layer === 'front' ? args.previewPage : args.page,
        args.screenshotDir, args.runId, args.report, layer);
    }
    finally {
      if (args.config) {
        args.config.replayCachedCheck = previousReplayMode;
        if (previousCapabilityId === undefined) delete args.config.baselineCapabilityId;
        else args.config.baselineCapabilityId = previousCapabilityId;
      }
    }
  }
  return checks;
}

async function captureCheckScreenshots(checks, page, screenshotDir, runId, report, layer) {
  if (!page || page.isClosed?.()) return;
  for (const check of checks) {
    if (!['fail', 'skip', 'na'].includes(check.status)) continue;
    const safeId = String(check.id || 'check').replace(/[^a-zA-Z0-9_-]/g, '_');
    const file = path.join(screenshotDir, `${safeId}-${runId}.png`);
    try {
      await page.screenshot({ path: file, fullPage: true, timeout: 30_000 });
      check.screenshot = file;
    } catch (error) {
      report.artifactErrors.push({ artifact: `check:${check.id}`, layer, message: error.message });
    }
  }
}

export function redact(value, config) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (typeof item !== 'string') return item;
    let text = item;
    for (const secret of [config.password, config.httpsProxy, config.editSiteUrl]) {
      if (secret) text = text.split(secret).join('[redacted]');
    }
    if (key === 'previewLink') return text;
    return text.replace(/https?:\/\/[^\s"'<>，。；：！？、（）【】“”‘’《》]+/g, (raw) => {
      try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
      } catch { return '[url]'; }
    });
  }));
}

export function formatBaselineGuard(guard) {
  if (!guard || guard.reason === 'no baseline in profile') return '[block] 基线守卫：no baseline in profile';
  if (!guard.residue) return '[block] 基线守卫：无残留';
  const rows = guard.diffs.map((d) => `${d.type} / ${d.label}: ${JSON.stringify(d.actual)} → ${JSON.stringify(d.expected)}（${d.reason}）`);
  return `[block] 基线守卫：发现 ${rows.length} 项残留，已恢复；新会话复验${guard.verifiedFresh ? '通过（无差异）' : '失败'}\n${rows.join('\n')}`;
}

async function main() {
  const config = loadConfig();
  const runLock = acquireRunLock({ site: config.siteDomain, mode: config.frontOnly ? 'front' : 'full' });
  console.log(`[block] 运行锁已取得：${runLock.record.host} pid=${runLock.record.pid} mode=${runLock.record.mode}`);
  console.log('[block] 注意：盒子端 live run 与 Mac 前台 run 使用独立文件系统锁，必须人工确保两者不重叠。');
  let profile = null;
  try {
    profile = JSON.parse(await readFile(path.resolve(projectRoot, config.profile || `profiles/${config.blockId}.json`), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let capabilities = profile?.capabilities || [];
  if (config.capabilityFilter?.length) {
    capabilities = capabilities.filter(({ id }) => config.capabilityFilter.includes(id));
    if (!capabilities.length) {
      throw new Error(`CAPABILITY_FILTER 未匹配到任何能力：${config.capabilityFilter.join(',')}`);
    }
  }
  if (config.checkGroup) {
    const matching = capabilities.filter(({ id }) => capabilityRegistry[id]?.checkGroups?.[config.checkGroup]);
    if (matching.length !== 1) {
      throw new Error(`CHECK_GROUP 必须唯一匹配能力，当前组=${config.checkGroup}，匹配数=${matching.length}`);
    }
  }
  const capabilityIds = capabilities.map(({ id }) => id);
  // Page selection lives in the profile (recorded at first-run setup);
  // env TARGET_PAGE / TARGET_PAGE_KIND override it for one-off runs.
  config.resolvedTarget = resolveTargetPage(config, profile);
  const startedAt = new Date().toISOString();
  const startedMonotonic = performance.now();
  const timestamp = startedAt.replace(/[:.]/g, '-');
  const safeBlockId = String(config.blockId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const runId = `${safeBlockId}-${timestamp}`;
  const reportDir = path.resolve(projectRoot, config.reportDir);
  const screenshotDir = path.resolve(projectRoot, config.screenshotDir);
  const reportPath = path.join(reportDir, `report-${runId}.json`);
  await Promise.all([mkdir(reportDir, { recursive: true }), mkdir(screenshotDir, { recursive: true })]);

  const report = {
    runId,
    startedAt,
    capabilityFilter: config.capabilityFilter ?? null,
    profile: profile ? { blockId: profile.blockId, capabilities: capabilityIds } : null,
    config: {
      blockId: config.blockId,
      targetPage: config.resolvedTarget.page,
      targetPageKind: config.resolvedTarget.kind,
      siteDomain: config.siteDomain,
      moduleType: config.moduleType,
      browser: config.browser,
      ignoreHTTPSErrors: config.ignoreHTTPSErrors,
      accountConfigured: Boolean(config.account),
      storageStateConfigured: Boolean(config.storageState),
      proxyConfigured: Boolean(config.httpsProxy),
      batchSave: config.batchSave,
    },
    added: null,
    baseline: null,
    baselineGuard: null,
    fixture: null,
    page: null,
    checks: [],
    summary: { pass: 0, fail: 0, skip: 0, na: 0, record: 0, deferred: 0, 'env-paused': 0, 'env-timeout': 0 },
    previewLink: null,
    previewLinkExpiresAt: null,
    screenshots: {},
    artifactErrors: [],
    failure: null,
  };
  if (config.batchSave) report.batchSave = { enabled: true, capabilities: [] };
  let session;
  let previewPage;
  let canvas;
  let fixturePreparation;
  let stage = 'launch-session';
  const checkpointPath = path.join(projectRoot, '.run-state', `${runId}.json`);
  const environmentEvents = [];
  const closeCurrentBrowser = async () => { try { await session?.browser.close(); } catch {} };
  config.onEnvironmentFailure = async (error) => {
    config.environmentStatus = error.envStatus || 'env-timeout';
    environmentEvents.push({ status: config.environmentStatus, message: error.message, at: new Date().toISOString() });
    await closeCurrentBrowser();
  };
  config.abortEnvironment = async (status = 'env-timeout') => {
    config.environmentStatus = status;
    await closeCurrentBrowser();
  };
  config.checkpointCheck = async (check, capability, layer) => {
    const checks = [...report.checks, check];
    if (!['env-paused', 'env-timeout'].includes(check.status)) config.resumeChecks.set(check.id, redact(check, config));
    await writeCheckpoint(checkpointPath, { runId, blockId: config.blockId, capability, layer,
      currentCheckId: check.id, completedChecks: redact(checks, config), updatedAt: new Date().toISOString() });
    watchdog?.progress();
  };
  config.resumeChecks = new Map();
  let watchdog;
  const pauseDetector = createPauseDetector({ onPause: (event) => {
    environmentEvents.push({ status: 'env-paused', ...event });
    config.environmentStatus = 'env-paused';
    void closeCurrentBrowser();
  } });
  watchdog = createProgressWatchdog({ timeoutMs: config.watchdogTimeoutMs, onTimeout: () => {
    const error = new RunTimeoutError(`运行 ${Math.round(config.watchdogTimeoutMs / 60_000)} 分钟没有检查进度`);
    environmentEvents.push({ status: 'env-timeout', message: error.message, at: new Date().toISOString() });
    config.environmentStatus = 'env-timeout';
    void closeCurrentBrowser();
  } });
  config.watchdogProgress = () => watchdog.progress();
  try {
    console.log(`[block] 开始：BLOCK_ID=${config.blockId}，TARGET_PAGE=${config.resolvedTarget.page}（${config.resolvedTarget.kind === 'custom' ? '自定义页面' : '系统页面'}）`);
    if (config.capabilityFilter?.length) console.log(`[block] 能力过滤：${config.capabilityFilter.join(',')}`);
    session = await launchSession(config);
    stage = 'open-editor';
    session.page = (await openEditor(session.page, config)).page;
    stage = 'goto-target-page';
    const target = await ensureTargetPage(session.page, config);
    canvas = target.frame;
    const pageCreated = target.created;
    report.page = { ...config.resolvedTarget, created: pageCreated };
    stage = 'add-block';
    report.added = await addBlockIfNeeded(session.page, canvas, config);
    const loadedSiteBaseline = await readSiteBaseline(projectRoot, config.siteDomain, config.blockId);
    let baselineDocument = loadedSiteBaseline.baseline;
    let baseline;
    if (!baselineDocument) {
      baseline = await captureBaseline({ page: session.page, canvas, config, blockId: config.blockId });
      const selected = report.added?.selectedInstance || null;
      const fixtureRefs = profile?.fixture || {};
      baselineDocument = (await writeSiteBaseline(projectRoot, config.siteDomain, config.blockId, baseline, {
        capturedAt: new Date().toISOString(), onboarding: true, fixtureRefs,
        instance: { selection: 'first-in-dom-order', ...selected, instanceCount: report.added?.countAfter || 1 },
      })).baseline;
      report.siteBaseline = { file: loadedSiteBaseline.file, onboardingCaptured: true,
        instance: baselineDocument.instance };
      console.log(`[block] 站点首次接入：已只读捕获并记录站点基线 ${loadedSiteBaseline.file}`);
    } else {
      report.siteBaseline = { file: loadedSiteBaseline.file, onboardingCaptured: false,
        instance: baselineDocument.instance };
      baseline = baselineDocument.steps;
      profile.baseline = baseline; // Runtime-only bridge for existing capability APIs.
    }
    baseline = baselineDocument.steps;
    if (baselineDocument.fixtureRefs) profile.fixture = baselineDocument.fixtureRefs;
    if (profile) profile.baseline = baseline; // Runtime-only bridge; profiles remain site-independent.
    config.verifyBatchBaseline = async () => guardBaseline({ page: session?.page, canvas, config, baseline });
    config.recoverEnvironment = async (reason, recoveryOptions = {}) => {
      const existingEvent = [...environmentEvents].reverse().find((event) => event.status === reason && !event.recoveryStartedAt);
      if (existingEvent) existingEvent.recoveryStartedAt = new Date().toISOString();
      else environmentEvents.push({ status: reason, at: new Date().toISOString() });
      await closeCurrentBrowser();
      const openFresh = async () => {
        session = await launchSession(config);
        session.page = (await openEditor(session.page, config)).page;
        canvas = (await ensureTargetPage(session.page, config)).frame;
      };
      try { await openFresh(); }
      catch {
        await closeCurrentBrowser();
        const login = spawnSync(process.execPath, ['scripts/explore-login.mjs', '--force-login'],
          { cwd: projectRoot, stdio: 'ignore', timeout: 120_000, env: process.env });
        if (login.error || login.status !== 0) throw new Error('环境恢复时重新登录失败');
        await openFresh();
      }
      let baselineVerification = null;
      if (!recoveryOptions.skipBaselineGuard) {
        baselineVerification = await guardBaseline({ page: session.page, canvas, config, baseline });
        if (baselineVerification.residue && !baselineVerification.verifiedFresh) throw new Error('环境恢复后基线复原未通过');
      }
      config.environmentStatus = null;
      watchdog.progress();
      return { session, page: session.page, canvas, context: session.context, baselineVerification };
    };
    const phases = frontRunPhases(config, profile || {}, report.added?.added === true);
    if (baseline.length) {
      config.baselineValue = (type, label) => {
        const semantic = /按钮文本/.test(label) ? '按钮文本'
          : /链接网址|域名|邮箱地址/.test(label) ? '链接网址'
            : /在新窗口打开|新窗口打开/.test(label) ? '新窗口打开' : label;
        return baselineValueFor(baseline, type, semantic) ?? baselineValueFor(baseline, type, label);
      };
      if (phases.baselineGuard) {
        stage = 'baseline-guard';
        report.baselineGuard = await guardBaseline({ page: session.page, canvas, config, baseline });
        console.log(formatBaselineGuard(report.baselineGuard));
        if (report.baselineGuard.residue) {
          // Restoring leaves editor UI state (e.g. the button editor-box) in the
          // main session; start capabilities from a fresh session instead.
          stage = 'baseline-guard-reopen';
          await session.browser.close();
          session = await launchSession(config);
          session.page = (await openEditor(session.page, config)).page;
          canvas = (await ensureTargetPage(session.page, config)).frame;
        }
      }
    } else {
      report.baselineGuard = { reason: 'no baseline in profile' };
      console.log(formatBaselineGuard(report.baselineGuard));
    }
    stage = 'apply-baseline';
    // A freshly added block carries factory defaults, not the profile's
    // baseline, so capability checks that assume the baseline would skip
    // or misjudge. Apply the baseline once, right after adding. This is a
    // precondition, not a capability: a failed application stops the run
    // (fail-fast) instead of recording one fail per capability.
    const shouldApplyBaseline = phases.applyBaseline;
    if (shouldApplyBaseline && baseline.length > 0) {
      const applied = await applyBaseline({ page: session.page, canvas, config, baseline });
      report.baseline = { applied: true, steps: applied.steps };
      if (!applied.allVerified) {
        throw new Error('基线应用未全部验证通过，详见报告 baseline.steps。');
      }
    } else if (shouldApplyBaseline) {
      report.baseline = { applied: false, reason: 'no baseline in profile' };
    } else {
      report.baseline = { applied: false, reason: 'block already on page' };
    }
    if (phases.prepareFixture) {
      if (config.capabilityFilter?.length && !config.capabilityFilter.some(id => ['custom-filter-fields', 'product-category-select', 'product-list-display'].includes(id))) {
        report.fixture = { applied: false, reason: 'CAPABILITY_FILTER 未包含 custom-filter-fields，跳过夹具准备。' };
      } else {
        stage = 'fixture-prep';
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              fixturePreparation = await withTimeout(() => prepareFixture({ page: session.page, canvas, context: session.context, config, profile }),
                config.layerTimeoutMs, '夹具准备', { onTimeout: (error) => config.abortEnvironment(error.envStatus) });
              break;
            } catch (error) {
              const environmentStatus = error.envStatus || config.environmentStatus
                || (error instanceof RunTimeoutError ? 'env-timeout' : null);
              if (!(environmentStatus === 'env-paused' || environmentStatus === 'env-timeout') || attempt === 1) throw error;
              const recovered = await config.recoverEnvironment(environmentStatus);
              session = recovered.session;
              canvas = recovered.canvas;
            }
          }
          report.checks.push(...fixturePreparation.checks);
          for (const check of fixturePreparation.checks) await config.checkpointCheck(check, 'fixture-prep', 'fixture');
          report.fixture = { applied: !fixturePreparation.skipped,
            ...(fixturePreparation.skipped ? { reason: '筛选字段组探查为无此设置项，未准备夹具。' } : {}),
            created: fixturePreparation.created, reused: fixturePreparation.reused, records: fixturePreparation.records, writes: fixturePreparation.writes,
            restored: null, restoreErrors: [] };
        } catch (error) {
          fixturePreparation = error.fixturePreparation;
          report.checks.push(...(fixturePreparation?.checks || []));
          report.fixture = { applied: false, reason: error.message,
            ...(error.fixtureStep ? { failedStep: error.fixtureStep } : {}),
            created: fixturePreparation?.created || { fields: [], products: [] },
            reused: fixturePreparation?.reused || { fields: [], products: [] },
            restored: fixturePreparation?.restored ?? null, restoreErrors: fixturePreparation?.restoreErrors || [] };
          const name = '自定义筛选夹具准备';
          report.checks.push({ id: 'fixture-prep', name, status: 'fail', suite: 'fixture-prep', detail: error.message,
            ...checkReportText(name, 'fail', error.message, undefined, 'fixture-prep'),
            expected: '夹具字段、产品及区块勾选状态应按画像准备完成并回读核对。' });
        }
      }
    }
    if (shouldRunLayer('settings', config)) {
      stage = config.frontOnly ? 'capability-front-effects' : 'capability-settings';
      report.checks.push(...await runCapabilityLayer(capabilities, 'settings', {
        page: session.page, canvas, context: session.context, config, profile, screenshotDir, runId, report,
      }));
    }
    stage = 'save-page';
    await savePage(session.page);
    if (phases.backend) {
      stage = 'capability-backend';
      report.checks.push(...await runCapabilityLayer(capabilities, 'backend', {
        page: session.page, canvas, context: session.context, config, profile, screenshotDir, runId, report,
      }));
    }
    stage = 'open-preview';
    let preview;
    if (!config.deferFront) {
      preview = await openPreview(session.page, session.context);
      previewPage = preview.previewPage;
      report.previewLink = await getPreviewShareLink(previewPage);
      if (report.previewLink) {
        const expires = new Date(startedAt);
        expires.setUTCDate(expires.getUTCDate() + 7);
        report.previewLinkExpiresAt = expires.toISOString().slice(0, 10);
      }
    }
    stage = 'front-checks';
    if (config.deferFront) {
      report.checks.push(...['block-present', 'img-alt', 'link-href', 'cursor-pointer', 'css-font-follow', 'css-word-break', 'carousel-arrows']
        .map((id) => deferredCheck(id, id)));
    } else {
      const frontChecks = await withTimeout(() => runFrontChecks(preview.frame, config.blockId,
        { previewPage, screenshotDir, runId, report }), config.layerTimeoutMs, '前台检查层', {
          onTimeout: (error) => config.abortEnvironment(error.envStatus),
        });
      report.checks.push(...frontChecks);
      for (const check of frontChecks) await config.checkpointCheck(check, 'front-runner', 'front');
    }
    // The style capability switches viewports and takes screenshots, so it
    // needs the preview page, not just its content frame.
    report.checks.push(...await runCapabilityLayer(capabilities, 'front', { frame: preview?.frame, previewPage: preview?.previewPage, config, profile, screenshotDir, runId, report }));
  } catch (error) {
    report.failure = { stage, message: error.message, ...(config.environmentStatus ? { status: config.environmentStatus } : {}) };
    if (stage === 'baseline-guard') {
      const name = '基线守卫';
      report.checks.push({ id: 'baseline-guard', name, status: 'fail', suite: 'baseline-guard', detail: error.message,
        ...checkReportText(name, 'fail', error.message, undefined, 'baseline-guard') });
      for (const id of ['block-present', 'img-alt', 'link-href', 'cursor-pointer', 'css-font-follow', 'css-word-break', 'carousel-arrows']) {
        const check = deferredCheck(id, id);
        report.checks.push({ ...check, status: 'blocked', detail: `基线守卫失败，未运行：${error.message}`,
          actual: '基线守卫未通过，后续检查被阻止。', evidenceText: ['基线守卫失败，后续检查未执行。'] });
      }
      for (const capability of capabilities) {
        for (const check of deferredCapabilityChecks(capability)) {
          report.checks.push({ ...check, status: 'blocked', detail: `基线守卫失败，未运行：${error.message}`,
            actual: '基线守卫未通过，后续检查被阻止。', evidenceText: ['基线守卫失败，后续检查未执行。'] });
        }
      }
    }
  } finally {
    // A fixture-prep exception may carry a partial snapshot too. Retrying the
    // full restoration here also covers failures in later capabilities.
    if (fixturePreparation?.originalFieldStates && session) {
      try {
        if (typeof config.recoverEnvironment !== 'function') throw new Error('环境恢复入口不可用。');
        const restoreResult = await retryWithEnvironmentRecovery(async (recovery) => {
          if (recovery) {
            session = recovery.session;
            canvas = recovery.canvas;
          }
          await restoreFixture({ page: session.page, canvas, config,
            originalFieldStates: fixturePreparation.originalFieldStates });
          await savePage(session.page);
        }, () => config.recoverEnvironment(config.environmentStatus || 'env-timeout'), (error) =>
          !session?.page || session.page.isClosed?.() || session.browser?.isConnected?.() === false
          || /Target page, context or browser has been closed/i.test(error?.message || ''));
        report.fixture.restored = true;
        if (restoreResult.recovery) report.fixture.restoreRecovery = 'browser-relaunched';
      } catch (error) {
        report.fixture.restored = false;
        report.fixture.restoreErrors.push(error.message);
        const name = '夹具字段勾选收尾恢复';
        report.checks.push({ id: 'fixture-restore', name, status: 'fail', suite: 'fixture-prep', detail: error.message,
          ...checkReportText(name, 'fail', error.message, undefined, 'fixture-restore'),
          expected: '全部字段勾选状态应恢复运行前快照、保存，并经新会话回读一致。' });
      }
    }
    if (config.batchSaveUsed && typeof config.verifyBatchBaseline === 'function') {
      const started = performance.now();
      try {
        const verification = await verifyBaselineWithRecovery({
          verify: () => config.verifyBatchBaseline(),
          recover: () => config.recoverEnvironment?.('env-timeout'),
        });
        const check = verification.check;
        report.batchSave ||= { enabled: true, capabilities: [] };
        report.batchSave.finalBaselineCheck = { status: check.residue ? 'restored-and-verified' : 'clean', ...check,
          ...(verification.recovered ? { recovery: 'browser-relaunched' } : {}), durationMs: performance.now() - started };
      } catch (error) {
        report.batchSave ||= { enabled: true, capabilities: [] };
        report.batchSave.finalBaselineCheck = { status: 'fail', error: error.message,
          durationMs: performance.now() - started };
        report.failure ||= { stage: 'batch-save-final-baseline-check', message: error.message };
      }
    }
    pauseDetector.stop();
    watchdog.stop();
    // Preserve both views on success and best-effort failure evidence. If
    // openPreview throws after creating its tab, recover that tab for evidence.
    if (!previewPage && session) {
      previewPage = session.context.pages().find((candidate) => candidate !== session.page && !candidate.isClosed());
    }
    try {
      for (const [name, page] of [['editor', session?.page], ['preview', previewPage]]) {
        if (!page || page.isClosed()) continue;
        const screenshotPath = path.join(screenshotDir, `${name}-${runId}.png`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30_000 });
          report.screenshots[name] = screenshotPath;
        } catch (error) {
          report.artifactErrors.push({ artifact: name, message: error.message });
        }
      }
    } finally {
      try { await session?.browser.close(); } catch (error) {
        report.failure ||= { stage: 'close-browser', message: error.message };
      }
    }
  }

  report.environmentEvents = environmentEvents;
  if (report.failure?.status && Object.hasOwn(report.summary, report.failure.status)
    && !report.checks.some((check) => check.status === report.failure.status)) report.summary[report.failure.status] += 1;
  for (const check of report.checks) {
    if (Object.hasOwn(report.summary, check.status)) report.summary[check.status] += 1;
  }
  for (const status of ['env-paused', 'env-timeout']) {
    report.summary[status] = Math.max(report.summary[status], environmentEvents.filter((event) => event.status === status).length);
  }
  report.finishedAt = new Date().toISOString();
  report.timing = { startedAt, finishedAt: report.finishedAt, durationMs: performance.now() - startedMonotonic,
    saveMode: config.batchSave ? 'batch' : 'individual' };
  report.status = report.failure || report.summary.fail || report.summary['env-paused'] || report.summary['env-timeout'] || report.artifactErrors.length ? 'failed' : 'passed';
  const safeReport = redact(report, config);
  await writeFile(reportPath, `${JSON.stringify(safeReport, null, 2)}\n`, 'utf8');
  const { pass, fail, skip, na, record, deferred } = report.summary;
  console.log(`[block] ${report.status}：pass=${pass} fail=${fail} skip=${skip} na=${na} record=${record} deferred=${deferred}`);
  console.log(`[block] 报告：${reportPath}`);
  for (const check of safeReport.checks.filter((item) => item.status === 'fail')) {
    console.error(`[block] ${check.id}：${check.detail}`);
  }
  if (safeReport.failure) console.error(`[block] ${safeReport.failure.stage}：${safeReport.failure.message}`);
  for (const error of safeReport.artifactErrors) console.error(`[block] 截图 ${error.artifact}：${error.message}`);
  if (report.status === 'failed') process.exitCode = 1;
  runLock.release();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  // Configuration and filesystem errors may contain secrets; do not dump them.
  console.error('[block] 无法启动或写入报告，请检查 BLOCK_ID、PROFILE、账号配置和输出目录权限。');
  process.exitCode = 1;
});
