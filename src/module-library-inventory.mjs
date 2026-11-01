const normalized = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function normalizeLibraryEntries(entries = []) {
  const result = [];
  const seen = new Set();
  for (const item of entries) {
    const blockId = normalized(item.blockId ?? item.appid);
    if (!blockId) continue;
    const name = normalized(item.name ?? item.displayText);
    const key = `${blockId}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ blockId, name: name || null, ...(item.visible !== undefined ? { visible: Boolean(item.visible) } : {}) });
  }
  return result;
}

export function summarizeLibraryInventory({ modes, targetBlockId }) {
  if (!Array.isArray(modes) || targetBlockId == null || String(targetBlockId).trim() === '') {
    throw new Error('Library inventory requires mode rows and a target block number.');
  }
  const target = String(targetBlockId);
  const normalizedModes = modes.map((mode) => ({
    mode: String(mode.mode), source: mode.source || 'visible-list', query: mode.query ?? null,
    entries: normalizeLibraryEntries(mode.entries), complete: mode.complete !== false,
    ...(mode.note ? { note: mode.note } : {}),
  }));
  const matches = normalizedModes.flatMap(({ mode, entries }) => entries
    .filter((entry) => entry.blockId === target).map((entry) => ({ mode, ...entry })));
  return { targetBlockId: target, targetFound: matches.length > 0, targetMatches: matches,
    allBlockNumbers: [...new Set(normalizedModes.flatMap((mode) => mode.entries.map((entry) => entry.blockId)))].sort(),
    modes: normalizedModes };
}
