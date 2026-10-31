/** Probe only one requested module number. No other library IDs are returned or stored. */
export async function searchTargetInMode({ mode, targetBlockId, selectMode, submitTarget,
  waitForLazyResults, scrollResultsToEnd, targetPresent, captureMissing }) {
  const target = String(targetBlockId ?? '').trim();
  if (!target) throw new Error('A target block number is required for module-library search.');
  await selectMode(mode);
  await submitTarget(target);
  await waitForLazyResults();
  await scrollResultsToEnd();
  await waitForLazyResults();
  const found = Boolean(await targetPresent(target));
  const screenshot = found ? null : await captureMissing?.(mode, target);
  return { mode: String(mode), query: target, found, searched: true, waitedForLazyResults: true, scrolledToEnd: true,
    ...(screenshot ? { screenshot } : {}) };
}

/** Visit each declared library mode without collecting any non-target identity. */
export async function probeTargetAcrossModes({ targetBlockId, modes = ['review', 'develop', 'online'],
  probeMode, captureMissing }) {
  const target = String(targetBlockId ?? '').trim();
  if (!target || typeof probeMode !== 'function') throw new Error('Target-only library probe requires a target number and mode probe.');
  const results = [];
  for (const mode of modes) {
    let result;
    try { result = await probeMode({ mode, targetBlockId: target }); }
    catch (error) { result = { found: false, searched: error?.searched !== false, status: 'error', error: String(error?.message || error) }; }
    const found = Boolean(result?.found);
    const screenshot = found ? null : await captureMissing?.(String(mode), target);
    results.push({ mode: String(mode), query: target, found, searched: result?.searched !== false,
      status: result?.status || 'checked', error: result?.error || null, screenshot: screenshot || null,
      waitedForLazyResults: Boolean(result?.waitedForLazyResults), scrolledToEnd: Boolean(result?.scrolledToEnd) });
  }
  return results;
}

export function summarizeTargetSearch({ targetBlockId, modes }) {
  const target = String(targetBlockId ?? '').trim();
  if (!target || !Array.isArray(modes)) throw new Error('Target search requires a block number and mode results.');
  if (modes.some((item) => String(item.query) !== target)) throw new Error('Every library mode must query only the requested block number.');
  return { targetBlockId: target, targetFound: modes.some((item) => item.found === true),
    modes: modes.map(({ mode, query, found, screenshot = null, status = 'checked', error = null, searched = true,
      waitedForLazyResults = false, scrolledToEnd = false }) =>
      ({ mode: String(mode), query: target, found: Boolean(found), searched: Boolean(searched), status, screenshot, error,
        waitedForLazyResults, scrolledToEnd })) };
}
