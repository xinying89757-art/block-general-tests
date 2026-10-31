export async function dismissReadOnlyPopover({ isVisible, pressEscape, neutralClick, toggleTrigger, focusAway }) {
  if (!await isVisible()) return;
  try { await pressEscape(); } catch {}
  if (await isVisible()) {
    try { await neutralClick(); } catch {}
  }
  if (await isVisible() && toggleTrigger) {
    try { await toggleTrigger(); } catch {}
  }
  if (await isVisible() && focusAway) {
    try { await focusAway(); } catch {}
  }
  if (await isVisible()) {
    throw new Error('只读检查尝试 Escape、画布空白点击、工具按钮切换和页面菜单失焦后仍无法关闭按钮编辑浮层；已停止读取，不会点击“保存”。');
  }
}
