/**
 * Find the editor's page-save action across its top document and child frames.
 * The generic editor id is required and exactly one visible match is allowed.
 */
export function matchingPageSaveControls(scopes = []) {
  return scopes.flatMap((scope) => (scope.controls || []).flatMap((control, index) =>
    control.id === 'saveLayout' && control.visible
      ? [{ scope: scope.name, index, locator: scope.locator, frameUrl: scope.frameUrl || null }]
      : []));
}

export async function waitForUniquePageSaveControl({ readScopes, timeoutMs = 10_000, intervalMs = 200 }) {
  if (typeof readScopes !== 'function') throw new Error('Page-save lookup requires a scope reader.');
  const deadline = Date.now() + timeoutMs;
  let lastMatches = [];
  do {
    lastMatches = matchingPageSaveControls(await readScopes());
    if (lastMatches.length === 1) return lastMatches[0];
    if (lastMatches.length > 1) {
      throw new Error(`Page-save control matched ${lastMatches.length} visible #saveLayout actions across editor documents; refusing to choose.`);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  } while (Date.now() <= deadline);
  throw new Error(`Page-save control did not become visible in the editor documents within ${timeoutMs}ms (matches=${lastMatches.length}).`);
}
