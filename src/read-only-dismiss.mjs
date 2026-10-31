export async function dismissReadOnlyPopover({ isVisible, pressEscape, neutralClick }) {
  if (!await isVisible()) return;
  try { await pressEscape(); } catch {}
  if (await isVisible()) {
    try { await neutralClick(); } catch {}
  }
  if (await isVisible()) {
    throw new Error('只读检查无法在不保存的情况下关闭按钮编辑浮层；已停止读取，不会点击“保存”。');
  }
}
