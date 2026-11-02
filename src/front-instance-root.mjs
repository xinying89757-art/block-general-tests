/** Generic instance scoping shared by box and front-only style readers. */
export function normalizeInstanceSettingId(value) {
  return String(value || '').replace(/^siteblocks-setting-wrap-/, '');
}

export function resolveInstanceRootIndexes(records = [], { blockId, settingId } = {}) {
  if (!blockId || !settingId) return { status: 'unavailable', indexes: [], reason: 'block-number-and-settingId-required' };
  const indexes = [];
  (records || []).forEach((record, index) => {
    if (String(record.blockId) !== String(blockId)) return;
    if ((record.settingIds || []).some((id) => normalizeInstanceSettingId(id) === normalizeInstanceSettingId(settingId))) indexes.push(index);
  });
  return { status: indexes.length === 1 ? 'resolved' : 'unavailable', indexes,
    reason: indexes.length === 1 ? null : 'instance-identity-not-unique' };
}

/** Mark the exact [data-appid] subtree; callers remove the temporary marker in finally. */
export async function markUniqueFrontInstance(page, { blockId, settingId, markerValue = `target-${Date.now()}` } = {}) {
  if (!page?.evaluate || !blockId || !settingId) throw new Error('Front instance lookup requires page, blockId and settingId.');
  const outcome = await page.evaluate(({ blockId, settingId, markerValue }) => {
    const roots = [...document.querySelectorAll('[data-appid]')].filter((root) => String(root.getAttribute('data-appid')) === String(blockId));
    const matches = roots.filter((root) => [root, ...root.querySelectorAll('*')].some((element) =>
      [...element.attributes].some((attribute) => (/setting.?id/i.test(attribute.name)
        || (attribute.name === 'data-id' && String(attribute.value).startsWith('siteblocks-setting-wrap-')))
        && String(attribute.value).replace(/^siteblocks-setting-wrap-/, '') === String(settingId))));
    if (matches.length !== 1) return { status: 'unavailable', rootCount: roots.length, matchCount: matches.length };
    matches[0].setAttribute('data-front-instance-target', markerValue);
    return { status: 'resolved', rootCount: roots.length, matchCount: 1 };
  }, { blockId: String(blockId), settingId: String(settingId), markerValue });
  if (outcome.status !== 'resolved') {
    const error = new Error(`Could not uniquely locate the selected block instance by block number and settingId (root count ${outcome.rootCount}, identity matches ${outcome.matchCount}).`);
    error.code = 'FRONT_INSTANCE_IDENTITY_UNAVAILABLE';
    throw error;
  }
  return { selector: `[data-front-instance-target=${JSON.stringify(markerValue)}]`, rootCount: outcome.rootCount,
    clear: () => page.locator(`[data-front-instance-target=${JSON.stringify(markerValue)}]`).evaluate((element) => element.removeAttribute('data-front-instance-target')) };
}
