/** Probe only one requested module number. No other library IDs are returned or stored. */
export async function searchTargetInMode({ mode, targetBlockId, selectMode, submitTarget,
  waitForLazyResults, scrollResultsToEnd, targetPresent, captureMissing }) {
  const target = String(targetBlockId ?? '').trim();
  if (!target) throw new Error('A target block number is required for module-library search.');
  let submitted = false;
  try {
    await selectMode(mode);
    await submitTarget(target);
    submitted = true;
  } catch (error) {
    error.searched = submitted;
    throw error;
  }
  try {
    await waitForLazyResults();
    await scrollResultsToEnd();
    await waitForLazyResults();
    const found = Boolean(await targetPresent(target));
    const screenshot = found ? null : await captureMissing?.(mode, target);
    return { mode: String(mode), query: target, found, searched: true, waitedForLazyResults: true, scrolledToEnd: true,
      ...(screenshot ? { screenshot } : {}) };
  } catch (error) {
    error.searched = submitted;
    throw error;
  }
}

/** Visit each declared library mode without collecting any non-target identity. */
export async function probeTargetAcrossModes({ targetBlockId, modes = ['review', 'develop', 'online'],
  probeMode, captureMissing, openModeSurface, closeModeSurface }) {
  const target = String(targetBlockId ?? '').trim();
  if (!target || typeof probeMode !== 'function') throw new Error('Target-only library probe requires a target number and mode probe.');
  const results = [];
  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    let result;
    let surface;
    let lifecycleError = null;
    try {
      if (openModeSurface) surface = await openModeSurface({ mode, index });
      result = await probeMode({ mode, targetBlockId: target, surface });
    } catch (error) {
      result = { found: false, searched: error?.searched === true, status: 'error', error: String(error?.message || error) };
    }
    const found = Boolean(result?.found);
    const completedSearch = result?.searched === true && result?.status !== 'error' && !result?.error;
    let screenshot = result?.screenshot || null;
    if (!screenshot && !found && completedSearch) screenshot = await captureMissing?.(String(mode), target, surface);
    try { if (closeModeSurface && surface !== undefined) await closeModeSurface({ mode, index, surface }); }
    catch (error) { lifecycleError = String(error?.message || error); }
    const status = lifecycleError ? 'error' : (result?.status || 'checked');
    results.push({ mode: String(mode), query: target, found, searched: result?.searched === true,
      status, error: lifecycleError || result?.error || null, screenshot: lifecycleError ? null : (screenshot || null),
      waitedForLazyResults: Boolean(result?.waitedForLazyResults), scrolledToEnd: Boolean(result?.scrolledToEnd) });
  }
  return results;
}

export function summarizeTargetSearch({ targetBlockId, modes }) {
  const target = String(targetBlockId ?? '').trim();
  if (!target || !Array.isArray(modes)) throw new Error('Target search requires a block number and mode results.');
  if (modes.some((item) => String(item.query) !== target)) throw new Error('Every library mode must query only the requested block number.');
  const searchComplete = modes.every((item) => item.searched === true && item.status !== 'error' && !item.error);
  return { targetBlockId: target, targetFound: modes.some((item) => item.found === true), searchComplete,
    modes: modes.map(({ mode, query, found, screenshot = null, status = 'checked', error = null, searched = true,
      waitedForLazyResults = false, scrolledToEnd = false }) =>
      ({ mode: String(mode), query: target, found: Boolean(found), searched: Boolean(searched), status, screenshot, error,
        waitedForLazyResults, scrolledToEnd })) };
}
