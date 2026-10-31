import test from 'node:test';
import assert from 'node:assert/strict';
import { retryClosedRestoreStep } from '../src/baseline-recovery.mjs';
import { baselineStepReadyTimeout } from '../src/baseline.mjs';

test('closed-browser restore retries the current dialog once, continues remaining dialogs, then saves', async () => {
  const events = [];
  const steps = ['设置自定义字段筛选', '设置与选取数据', '设置产品分类'];
  let recovered = false;
  for (const title of steps) {
    const result = await retryClosedRestoreStep({
      step: await apply(title, false),
      isClosed: (step) => step.closed,
      recover: async () => {
        recovered = true;
        events.push('relaunch');
        return { page: { id: 'fresh-page' }, canvas: { id: 'fresh-canvas' } };
      },
      retry: async (fresh) => {
        events.push(`${title}:retry:${fresh.page.id}`);
        return apply(title, true);
      },
    });
    events.push(`${title}:done`);
    assert.equal(result.step.ok, true);
  }
  if (recovered) events.push('save-page');
  assert.deepEqual(events, [
    '设置自定义字段筛选:first', '设置自定义字段筛选:done',
    '设置与选取数据:first', 'relaunch', '设置与选取数据:retry:fresh-page',
    '设置与选取数据:retried', '设置与选取数据:done',
    '设置产品分类:first', '设置产品分类:done', 'save-page',
  ]);

  async function apply(title, retried) {
    events.push(`${title}:${retried ? 'retried' : 'first'}`);
    return title === '设置与选取数据' && !retried
      ? { title, ok: false, closed: true }
      : { title, ok: true, closed: false };
  }
});

test('large product-category dialog gets a bounded 120-second settle window', () => {
  assert.equal(baselineStepReadyTimeout('设置产品分类', undefined), 120_000);
  assert.equal(baselineStepReadyTimeout('设置产品分类', '180000'), 180_000);
  assert.equal(baselineStepReadyTimeout('设置与选取数据', undefined), 30_000);
});
