const STATUS_PRIORITY = Object.freeze({ fail: 6, error: 6, record: 5, pass: 4, na: 3, deferred: 2, skip: 1 });

/** Keep one conservative result per check id; a duplicate failure can never be hidden by a pass. */
export function dedupeChecksById(checks = []) {
  const output = [];
  const indexes = new Map();
  for (const check of checks) {
    if (!check || typeof check.id !== 'string' || !check.id) { output.push(check); continue; }
    if (!indexes.has(check.id)) {
      indexes.set(check.id, output.length);
      output.push(check);
      continue;
    }
    const index = indexes.get(check.id);
    const previous = output[index];
    const previousPriority = STATUS_PRIORITY[previous.status] ?? 0;
    const nextPriority = STATUS_PRIORITY[check.status] ?? 0;
    if (nextPriority > previousPriority) output[index] = check;
  }
  return output;
}
