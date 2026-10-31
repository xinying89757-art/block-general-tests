export async function dismissReadOnlyPopover({ isVisible, pressEscape, neutralClick, toggleTrigger }) {
  if (!await isVisible()) return;
  try { await pressEscape(); } catch {}
  if (await isVisible()) {
    try { await neutralClick(); } catch {}
  }
  if (await isVisible() && toggleTrigger) {
    try { await toggleTrigger(); } catch {}
  }
  if (await isVisible()) {
    throw new Error('只读检查尝试 Escape、画布空白点击和工具按钮切换后仍无法关闭按钮编辑浮层；已停止读取，不会点击“保存”。');
  }
}
