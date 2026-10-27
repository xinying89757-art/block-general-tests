import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { launchSession } from './browser.mjs';
import { openEditor, ensureTargetPage, addBlockIfNeeded, savePage, openPreview, resolveTargetPage, getPreviewShareLink } from './editor.mjs';
import { applyBaseline } from './baseline.mjs';
import { runFrontChecks } from './checks.mjs';
import * as customFilterFields from './capabilities/custom-filter-fields.mjs';
import * as productListDisplay from './capabilities/product-list-display.mjs';
import * as buttonLink from './capabilities/button-link.mjs';
import * as productCategorySelect from './capabilities/product-category-select.mjs';
import * as blockColorScheme from './capabilities/block-color-scheme.mjs';
import * as moduleWidth from './capabilities/module-width.mjs';
import * as blockStyleSpec from './capabilities/block-style-spec.mjs';
import { checkReportText } from './capabilities/shared.mjs';

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

export async function runCapabilityLayer(capabilities, layer, args, registry = capabilityRegistry) {
  const checks = [];
  const method = layer === 'settings' ? 'runSettingsLayer' : 'runFrontLayer';
  // capabilities are profile entries, not bare ids: a module may need its
  // profile parameters (dialogTitle, wrapIndex, variant) to locate its dialog
  // when several sub-regions share one editor type.
  for (const capability of capabilities) {
    const id = capability.id;
    const module = registry[id];
    if (typeof module?.[method] !== 'function') continue;
    try {
      const returned = await module[method]({ ...args, capability });
      checks.push(...returned);
      await captureCheckScreenshots(returned, layer === 'settings' ? args.page : args.previewPage,
        args.screenshotDir, args.runId, args.report, layer);
    }
    catch (error) {
      const name = `${id} ${layer} 层异常`;
      const check = { id: `${id}-${layer}-error`, name,
        status: 'fail', detail: error.message, suite: `capability:${id}`,
        ...checkReportText(name, 'fail', error.message) };
      checks.push(check);
      await captureCheckScreenshots([check], layer === 'settings' ? args.page : args.previewPage,
        args.screenshotDir, args.runId, args.report, layer);
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
    return text.replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
      try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
      } catch { return '[url]'; }
    });
  }));
}

async function main() {
  const config = loadConfig();
  let profile = null;
  try {
    profile = JSON.parse(await readFile(path.resolve(projectRoot, config.profile || `profiles/${config.blockId}.json`), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const capabilities = profile?.capabilities || [];
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
    page: null,
    checks: [],
    summary: { pass: 0, fail: 0, skip: 0, na: 0, record: 0 },
    previewLink: null,
    previewLinkExpiresAt: null,
    screenshots: {},
    artifactErrors: [],
    failure: null,
  };
  let session;
  let previewPage;
  let stage = 'launch-session';
  try {
    console.log(`[block] 开始：BLOCK_ID=${config.blockId}，TARGET_PAGE=${config.resolvedTarget.page}（${config.resolvedTarget.kind === 'custom' ? '自定义页面' : '系统页面'}）`);
    session = await launchSession(config);
    stage = 'open-editor';
    session.page = (await openEditor(session.page, config)).page;
    stage = 'goto-target-page';
    const { frame: canvas, created: pageCreated } = await ensureTargetPage(session.page, config);
    report.page = { ...config.resolvedTarget, created: pageCreated };
    stage = 'add-block';
    report.added = await addBlockIfNeeded(session.page, canvas, config);
    stage = 'apply-baseline';
    // A freshly added block carries factory defaults, not the profile's
    // baseline, so capability checks that assume the baseline would skip
    // or misjudge. Apply the baseline once, right after adding. This is a
    // precondition, not a capability: a failed application stops the run
    // (fail-fast) instead of recording one fail per capability.
    const baseline = Array.isArray(profile?.baseline) ? profile.baseline : [];
    const shouldApplyBaseline = report.added?.added === true || config.applyBaseline;
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
    stage = 'capability-settings';
    report.checks.push(...await runCapabilityLayer(capabilities, 'settings', {
      page: session.page, canvas, context: session.context, config, screenshotDir, runId, report,
    }));
    stage = 'save-page';
    await savePage(session.page);
    stage = 'open-preview';
    const preview = await openPreview(session.page, session.context);
    previewPage = preview.previewPage;
    report.previewLink = await getPreviewShareLink(previewPage);
    if (report.previewLink) {
      const expires = new Date(startedAt);
      expires.setUTCDate(expires.getUTCDate() + 7);
      report.previewLinkExpiresAt = expires.toISOString().slice(0, 10);
    }
    stage = 'front-checks';
    const frontChecks = await runFrontChecks(preview.frame, config.blockId,
      { previewPage, screenshotDir, runId, report });
    report.checks.push(...frontChecks);
    // The style capability switches viewports and takes screenshots, so it
    // needs the preview page, not just its content frame.
    report.checks.push(...await runCapabilityLayer(capabilities, 'front', { frame: preview.frame, previewPage: preview.previewPage, config, screenshotDir, runId, report }));
  } catch (error) {
    report.failure = { stage, message: error.message };
  } finally {
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
  const { pass, fail, skip, na, record } = report.summary;
  console.log(`[block] ${report.status}：pass=${pass} fail=${fail} skip=${skip} na=${na} record=${record}`);
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
