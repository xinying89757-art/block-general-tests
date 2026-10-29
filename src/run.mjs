import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { launchSession } from './browser.mjs';
import { openEditor, ensureTargetPage, addBlockIfNeeded, savePage, openPreview, resolveTargetPage, getPreviewShareLink } from './editor.mjs';
import { applyBaseline } from './baseline.mjs';
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
    let selectedMethod = method;
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
    if (args.config) args.config.baselineCapabilityId = id;
    try {
      const returned = await module[selectedMethod]({ ...args, capability, profile });
      checks.push(...returned);
      await captureCheckScreenshots(returned, layer === 'front' ? args.previewPage : args.page,
        args.screenshotDir, args.runId, args.report, layer);
    }
    catch (error) {
      const name = `${id} ${layer} 层异常`;
      const check = { id: `${id}-${layer}-error`, name,
        status: 'fail', detail: error.message, suite: `capability:${id}`,
        ...checkReportText(name, 'fail', error.message) };
      checks.push(check);
      await captureCheckScreenshots([check], layer === 'front' ? args.previewPage : args.page,
        args.screenshotDir, args.runId, args.report, layer);
    }
    finally {
      if (args.config) {
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
  const capabilityIds = capabilities.map(({ id }) => id);
  // Page selection lives in the profile (recorded at first-run setup);
  // env TARGET_PAGE / TARGET_PAGE_KIND override it for one-off runs.
  config.resolvedTarget = resolveTargetPage(config, profile);
  const startedAt = new Date().toISOString();
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
    },
    added: null,
    baseline: null,
    baselineGuard: null,
    fixture: null,
    page: null,
    checks: [],
    summary: { pass: 0, fail: 0, skip: 0, na: 0, record: 0, deferred: 0 },
    previewLink: null,
    previewLinkExpiresAt: null,
    screenshots: {},
    artifactErrors: [],
    failure: null,
  };
  let session;
  let previewPage;
  let canvas;
  let fixturePreparation;
  let stage = 'launch-session';
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
    const baseline = Array.isArray(profile?.baseline) ? profile.baseline : [];
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
      if (config.capabilityFilter?.length && !config.capabilityFilter.includes('custom-filter-fields')) {
        report.fixture = { applied: false, reason: 'CAPABILITY_FILTER 未包含 custom-filter-fields，跳过夹具准备。' };
      } else {
        stage = 'fixture-prep';
        try {
          fixturePreparation = await prepareFixture({ page: session.page, canvas, context: session.context, config, profile });
          report.checks.push(...fixturePreparation.checks);
          report.fixture = { applied: !fixturePreparation.skipped,
            ...(fixturePreparation.skipped ? { reason: '筛选字段组探查为无此设置项，未准备夹具。' } : {}),
            created: fixturePreparation.created, reused: fixturePreparation.reused,
            restored: null, restoreErrors: [] };
        } catch (error) {
          fixturePreparation = error.fixturePreparation;
          report.checks.push(...(fixturePreparation?.checks || []));
          report.fixture = { applied: false, reason: error.message,
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
      const frontChecks = await runFrontChecks(preview.frame, config.blockId,
        { previewPage, screenshotDir, runId, report });
      report.checks.push(...frontChecks);
    }
    // The style capability switches viewports and takes screenshots, so it
    // needs the preview page, not just its content frame.
    report.checks.push(...await runCapabilityLayer(capabilities, 'front', { frame: preview?.frame, previewPage: preview?.previewPage, config, profile, screenshotDir, runId, report }));
  } catch (error) {
    report.failure = { stage, message: error.message };
  } finally {
    // A fixture-prep exception may carry a partial snapshot too. Retrying the
    // full restoration here also covers failures in later capabilities.
    if (fixturePreparation?.originalFieldStates && session) {
      try {
        await restoreFixture({ page: session.page, canvas, config,
          originalFieldStates: fixturePreparation.originalFieldStates });
        await savePage(session.page);
        report.fixture.restored = true;
      } catch (error) {
        report.fixture.restored = false;
        report.fixture.restoreErrors.push(error.message);
        const name = '夹具字段勾选收尾恢复';
        report.checks.push({ id: 'fixture-restore', name, status: 'fail', suite: 'fixture-prep', detail: error.message,
          ...checkReportText(name, 'fail', error.message, undefined, 'fixture-restore'),
          expected: '全部字段勾选状态应恢复运行前快照、保存，并经新会话回读一致。' });
      }
    }
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

  for (const check of report.checks) {
    if (Object.hasOwn(report.summary, check.status)) report.summary[check.status] += 1;
  }
  report.finishedAt = new Date().toISOString();
  report.status = report.failure || report.summary.fail || report.artifactErrors.length ? 'failed' : 'passed';
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  // Configuration and filesystem errors may contain secrets; do not dump them.
  console.error('[block] 无法启动或写入报告，请检查 BLOCK_ID、PROFILE、账号配置和输出目录权限。');
  process.exitCode = 1;
});
