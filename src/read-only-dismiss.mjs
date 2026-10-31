export async function reloadDiscardAndVerify({ reload, readBack, expected, finishReload = reload }) {
  await reload();
  const actual = await readBack();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('只读按钮值在重载后发生变化；停止检查，未保存。');
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
