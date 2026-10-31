export async function readStableSnapshot(read, { timeoutMs = 10_000, intervalMs = 100, stableReads = 2,
  now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (typeof read !== 'function' || !Number.isInteger(stableReads) || stableReads < 2) {
    throw new Error('Stable readback requires a reader and at least two identical observations.');
  }
  const deadline = now() + timeoutMs;
  let previous;
  let repeats = 0;
  let last;
  do {
    last = await read();
    if (previous !== undefined && JSON.stringify(last) === JSON.stringify(previous)) repeats++;
    else repeats = 1;
    if (repeats >= stableReads) return last;
    previous = structuredClone(last);
    if (now() >= deadline) break;
    await wait(Math.min(intervalMs, Math.max(1, deadline - now())));
  } while (now() <= deadline);
  const error = new Error(`只读回读值在 ${timeoutMs}ms 内未稳定。`);
  error.name = 'TimeoutError';
  error.code = 'READBACK_UNSTABLE';
  error.lastValue = last;
  throw error;
}

function changedPaths(expected, actual, prefix = '') {
  if (Object.is(expected, actual)) return [];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [prefix || 'value'];
    const paths = [];
    for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
      paths.push(...changedPaths(expected[index], actual[index], `${prefix}[${index}]`));
    }
    return paths;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const paths = [];
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      paths.push(...changedPaths(expected[key], actual[key], prefix ? `${prefix}.${key}` : key));
    }
    return paths;
  }
  return [prefix || 'value'];
}

export async function reloadDiscardAndVerify({ reload, readBack, expected, finishReload = reload, stableReadOptions }) {
  await reload();
  const actual = await readStableSnapshot(readBack, stableReadOptions);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`只读按钮值在重载后发生变化；停止检查，未保存。变化字段=${changedPaths(expected, actual).join(', ') || 'value'}`);
  }
  await finishReload();
  return actual;
}

export async function dismissReadOnlyPopover({ isVisible, pressEscape, neutralClick, toggleTrigger, focusAway, reloadDiscard }) {
  if (!await isVisible()) return 'already-hidden';
  try { await pressEscape(); } catch {}
  if (!await isVisible()) return 'escape';
  if (await isVisible()) {
    try { await neutralClick(); } catch {}
  }
  if (!await isVisible()) return 'neutral-click';
  if (await isVisible() && toggleTrigger) {
    try { await toggleTrigger(); } catch {}
  }
  if (!await isVisible()) return 'toolbar-toggle';
  if (await isVisible() && focusAway) {
    try { await focusAway(); } catch {}
  }
  if (!await isVisible()) return 'focus-away';
  if (await isVisible() && reloadDiscard) {
    await reloadDiscard();
    return 'reload-discard';
  }
  if (await isVisible()) {
    throw new Error('只读检查尝试 Escape、画布空白点击、工具按钮切换、页面菜单失焦和重载丢弃后仍无法关闭按钮编辑浮层；已停止读取，不会点击“保存”。');
  }
}
