const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the editor canvas is demonstrably rendered and its block tree has
 * stopped changing. A stable empty/partial frame is never sufficient evidence
 * to insert a block: callers must fail closed when the render gate times out.
 * `readSnapshot` and the clock/sleep hooks keep this state machine testable
 * without a browser or network.
 */
export async function waitForCanvasRender(readSnapshot, {
  timeoutMs = 45_000,
  stableMs = 8_000,
  pollMs = 500,
  allowEmptyCanvas = false,
  now = () => Date.now(),
  delay = sleep,
} = {}) {
  const deadline = now() + timeoutMs;
  let stableSignature;
  let stableSince;
  let lastSnapshot;

  while (now() < deadline) {
    lastSnapshot = await readSnapshot();
    const ready = lastSnapshot?.ready === true
      && lastSnapshot?.canvasReady === true
      && lastSnapshot?.loading !== true
      && (allowEmptyCanvas || Number(lastSnapshot?.blockCount) > 0);
    const signature = ready ? JSON.stringify(lastSnapshot.signature) : null;
    if (signature && signature === stableSignature) {
      if (now() - stableSince >= stableMs) return lastSnapshot;
    } else {
      stableSignature = signature;
      stableSince = now();
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await delay(Math.min(pollMs, remaining));
  }

  const error = new Error(`编辑器画布未能证明已完成渲染；拒绝根据不稳定或空画布插入区块（${JSON.stringify({
    ready: lastSnapshot?.ready ?? false,
    canvasReady: lastSnapshot?.canvasReady ?? false,
    loading: lastSnapshot?.loading ?? null,
    blockCount: lastSnapshot?.blockCount ?? null,
  })}）。`);
  error.code = 'CANVAS_RENDER_NOT_READY';
  throw error;
}

export function selectedBlockInstance(instances) {
  return instances.length ? {
    index: 0,
    order: 1,
    position: instances[0].position,
    total: instances.length,
  } : null;
}
