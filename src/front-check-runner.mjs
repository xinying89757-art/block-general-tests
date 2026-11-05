import { runFrontLayer, resolveFrontStyleCapability } from './capabilities/block-style-spec.mjs';
import { attachFrontStyleInstance } from './front-style-report.mjs';
import { markUniqueFrontInstance } from './front-instance-root.mjs';
import { runDesignSpecFrontChecks, runWrittenColorFrontChecks } from './design-spec-checklist.mjs';
import { readInstanceStructure } from './front-structure.mjs';
import { runDisplayFieldFrontChecks } from './display-field-front-check.mjs';

/** Run the exact public-page check set used by front-style-only on an existing page. */
export async function runFrontChecks({ page, profile, blockId, settingId = null, settingsReport = null,
  imageLoadTimeoutMs = 15_000, actionTimeoutMs = 30_000, includeStylesheets = true,
  rootSelector: suppliedRootSelector, captureInstance, onDiagnostic = () => {}, onProgress = () => {}, onCheck = () => {} }) {
  const capability = (profile.capabilities || []).find((item) => item.id === 'block-style-spec');
  const resolved = capability ? resolveFrontStyleCapability(capability, settingsReport) : null;
  const root = suppliedRootSelector ? null : await markUniqueFrontInstance(page, { blockId, settingId, markerValue: `front-style-${Date.now()}` });
  const rootSelector = suppliedRootSelector || root.selector;
  const config = { blockId, imageLoadTimeoutMs, actionTimeoutMs, rootSelector, settingId, settingsReport };
  const checks = [];
  const emit = (rows) => { checks.splice(0, checks.length, ...attachFrontStyleInstance(rows, settingId)); onCheck([...checks]); };
  try {
    const originalViewport = page.viewportSize();
    try {
      for (const viewport of [{ label: 'pc', width: resolved?.styleSpec?.viewports?.pc || 1440, height: 900 },
        { label: 'mobile', width: resolved?.styleSpec?.viewports?.mobile || 375, height: 667 }]) {
        onProgress(`instance-diagnostics-${viewport.label}`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForFunction(() => document.readyState !== 'loading', undefined, { timeout: actionTimeoutMs });
        try {
          const structure = await page.evaluate(readInstanceStructure, { rootSelector: config.rootSelector, imageMode: 'content' });
          onDiagnostic({ viewport, structure });
        } catch (error) { onDiagnostic({ viewport, error }); /* diagnostics must not suppress assertions */ }
        if (captureInstance) await captureInstance({ page, rootSelector: config.rootSelector, viewport,
          identity: { blockId, settingId } });
      }
    } finally { if (originalViewport) await page.setViewportSize(originalViewport); }

    const styleChecks = capability && (capability.styleSpec?.items?.length || capability.styleSpec?.recordOnly?.length)
      ? await runFrontLayer({ frame: page, previewPage: page, config,
        capability: { ...resolved, designSpec: profile.designSpec }, onProgress,
        onCheck: (check) => emit([...checks, check]) }) : [];
    emit(styleChecks);
    const designChecks = await runDesignSpecFrontChecks(profile, { page, rootSelector: config.rootSelector,
      imageLoadTimeoutMs, frontChecks: styleChecks, settingsReport, viewport: { label: 'pc', width: 1440, height: 900 },
      onProgress, onCheck: (check) => emit([...styleChecks, ...checks.filter((row) => row.id.startsWith('design-')),
        ...(check ? [check] : [])]) });
    emit([...styleChecks, ...designChecks.filter(Boolean)]);
    const writtenColors = await runWrittenColorFrontChecks({ page, rootSelector: config.rootSelector, settingsReport,
      includeStylesheets, onProgress });
    emit([...checks, ...writtenColors]);
    const displayFieldChecks = await runDisplayFieldFrontChecks({ page, rootSelector: config.rootSelector,
      settingsReport, onCheck: (check) => emit([...checks.filter((row) => row.id !== check.id), check]) });
    emit([...checks.filter((row) => row.id !== 'pld-display-field-batch-effect'), ...displayFieldChecks]);
    return [...checks];
  } finally { await root?.clear().catch(() => {}); }
}
