import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedBlockInstance, waitForCanvasRender } from '../src/block-render.mjs';

function fakeTime() {
  let current = 0;
  return { now: () => current, delay: async (ms) => { current += ms; }, value: () => current };
}

test('canvas gate notices a target block that mounts after the initial frame snapshot', async () => {
  const time = fakeTime();
  const result = await waitForCanvasRender(async () => {
    const targetPresent = time.value() >= 4_000;
    return { ready: true, canvasReady: true, loading: false, blockCount: targetPresent ? 5 : 4,
      targets: targetPresent ? [{ index: 3, position: { y: 900 } }] : [],
      signature: ['nav', 'hero', 'list', ...(targetPresent ? ['47748'] : [])] };
  }, { timeoutMs: 20_000, stableMs: 8_000, pollMs: 1_000, now: time.now, delay: time.delay });

  assert.equal(result.targets.length, 1);
  assert.ok(time.value() >= 12_000, 'the settled state includes the delayed block and full quiet window');
});

test('canvas gate fails closed for an unready or empty frame', async () => {
  const time = fakeTime();
  await assert.rejects(waitForCanvasRender(async () => ({ ready: false, canvasReady: false,
    loading: true, blockCount: 0, targets: [], signature: [] }),
  { timeoutMs: 3_000, stableMs: 1_000, pollMs: 1_000, now: time.now, delay: time.delay }),
  (error) => error.code === 'CANVAS_RENDER_NOT_READY' && /拒绝.*插入区块/.test(error.message));
});

test('selected block instance records the same first DOM instance used by locator.first()', () => {
  const instances = [{ index: 2, position: { x: 10, y: 200 } }, { index: 7, position: { x: 10, y: 900 } }];
  assert.deepEqual(selectedBlockInstance(instances), { index: 0, order: 1, position: { x: 10, y: 200 }, total: 2 });
  assert.equal(selectedBlockInstance([]), null);
});
