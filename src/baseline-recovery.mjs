export async function retryClosedRestoreStep({ step, isClosed, recover, retry }) {
  if (!isClosed(step)) return { step, recovery: null };
  const recovery = await recover(step);
  if (!recovery?.page || !recovery?.canvas) throw new Error('浏览器恢复未返回新的编辑器页面和画布。');
  return { step: await retry(recovery), recovery };
}
