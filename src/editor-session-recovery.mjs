export function isStaleEditorError(error) {
  return /编辑器未显示“页面:”|无法确认当前编辑器对应的站点 host|无法确认当前站点身份/i
    .test(String(error?.message || error || ''));
}

async function close(session) {
  try { await session?.browser?.close(); } catch {}
}

export async function openWithLoginRecovery({ launch, open, forceLogin, isStale = isStaleEditorError }) {
  let session = await launch();
  try {
    return { session, value: await open(session), loginRefreshed: false };
  } catch (firstError) {
    await close(session);
    if (!isStale(firstError)) throw firstError;
    try { await forceLogin(); }
    catch { throw new Error(`编辑器打开失败（${firstError.message}）；force-login 刷新登录态也失败，已停止。`); }
    try {
      session = await launch();
      return { session, value: await open(session), loginRefreshed: true };
    } catch (retryError) {
      await close(session);
      throw new Error(`force-login 后重试编辑器仍失败：${retryError.message}`);
    }
  }
}
