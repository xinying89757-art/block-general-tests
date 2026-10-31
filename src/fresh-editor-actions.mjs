const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Return exact target-instance delete action indexes; callers must require one. */
export function matchingDeleteActionIndexes(actions, settingId) {
  if (!settingId) return [];
  const expectedDataId = `siteblocks-setting-wrap-${settingId}`;
  return (actions || []).flatMap((action, index) => {
    if (action.visible === false || action.dataId !== expectedDataId) return [];
    const labels = [action.text, action.textContent, action.title, action.ariaLabel].map(normalize).filter(Boolean);
    const hasExactDeleteLabel = labels.some((label) => ['删除', 'delete', 'remove'].includes(label));
    const icons = (action.iconClasses || []).map(normalize).join(' ');
    const hasDeleteIcon = /(?:^|[\s_-])(?:icon-trash|icon-delete|fa-trash|fa-trash-o|trash|delete)(?:$|[\s_-])/.test(icons);
    return hasExactDeleteLabel && hasDeleteIcon ? [index] : [];
  });
}

export function matchingDeleteActionMatches(scopes, settingId) {
  return (scopes || []).flatMap((scope) => matchingDeleteActionIndexes(scope.actions, settingId)
    .map((index) => ({ scope: scope.name, index, locator: scope.locator })));
}

export async function waitForUniqueDeleteAction({ settingId, readScopes, timeoutMs = 10_000,
  intervalMs = 100, now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (typeof readScopes !== 'function') throw new Error('Delete action search requires a scope reader.');
  const deadline = now() + Math.max(0, timeoutMs);
  do {
    const scopes = await readScopes();
    const matches = matchingDeleteActionMatches(scopes, settingId);
    if (matches.length > 1) throw new Error(`Selected block delete control is ambiguous (${matches.length}); nothing was deleted.`);
    if (matches.length === 1) return matches[0];
    if (now() >= deadline) break;
    await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  throw new Error('Selected block delete control matched 0 visible instance-bound actions before timeout; nothing was deleted.');
}

/** Resolve only a uniquely identified destructive confirmation action. */
export function matchingDeleteConfirmIndexes(actions) {
  return (actions || []).flatMap((action, index) => {
    if (action.visible === false) return [];
    const label = normalize([action.text, action.textContent, action.title, action.ariaLabel].filter(Boolean).join(' '));
    return ['删除', 'delete', 'remove', '确定', 'confirm'].includes(label) ? [index] : [];
  });
}

export function matchingDeleteConfirmMatches(scopes) {
  return (scopes || []).flatMap((scope) => matchingDeleteConfirmIndexes(scope.actions)
    .map((index) => ({ scope: scope.name, index, locator: scope.locator })));
}
