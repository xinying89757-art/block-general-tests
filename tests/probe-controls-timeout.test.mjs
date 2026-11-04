import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { probeControls } from '../src/capabilities/shared.mjs';
import { uiWaitConfig } from '../src/ui-waits.mjs';

test('控件探查限制整体等待时间并保留原有读取行为', async (t) => {
  const previousTimeout = process.env.PROBE_TIMEOUT_MS;
  t.after(() => {
    if (previousTimeout === undefined) delete process.env.PROBE_TIMEOUT_MS;
    else process.env.PROBE_TIMEOUT_MS = previousTimeout;
  });
  process.env.PROBE_TIMEOUT_MS = '400';
  const controls = [{ type: 'text', label: '标题', value: '测试' }];

  for (const phase of ['open', 'read']) {
    await t.test(`${phase} 永不返回时及时给出超时原因`, async () => {
      const session = {
        open: async () => {},
        read: async () => controls,
        [phase]: () => new Promise(() => {}),
      };
      const started = performance.now();
      const result = await probeControls(session);
      const elapsed = performance.now() - started;
      t.diagnostic(`${phase} 卡死时 ${Math.round(elapsed)}ms 返回`);
      assert.ok(elapsed < 10_000, `探查耗时 ${elapsed}ms，应小于 10000ms`);
      assert.deepEqual(result, {
        reason: '控件探查超时（0s），可能设置面板未打开或控件未加载',
      });
    });
  }

  await t.test('正常打开和读取时返回控件', async () => {
    assert.deepEqual(await probeControls({ open: async () => {}, read: async () => controls }), { controls });
  });

  await t.test('打开直接报错时保留原有不可用原因', async () => {
    assert.deepEqual(await probeControls({ open: async () => { throw new Error('面板打开失败'); } }), {
      reason: '控件探查不可用：面板打开失败',
    });
  });

  await t.test('读取直接报错时保留原有不可用原因', async () => {
    assert.deepEqual(await probeControls({
      open: async () => {}, read: async () => { throw new Error('控件读取失败'); },
    }), { reason: '控件探查不可用：控件读取失败' });
  });

  await t.test('accepts 接受首次读取时直接返回控件', async () => {
    assert.deepEqual(await probeControls({
      open: async () => {}, read: async () => controls,
      cancel: async () => assert.fail('首次读取满足条件时不应重新打开'),
    }, (value) => value === controls), { controls });
  });

  await t.test('accepts 不接受首次读取时取消、重开并重读', async () => {
    const calls = [];
    let reads = 0;
    const result = await probeControls({
      open: async () => { calls.push('open'); },
      read: async () => { calls.push('read'); return reads++ === 0 ? [] : controls; },
      cancel: async () => { calls.push('cancel'); },
    }, (value) => value.length > 0);
    assert.deepEqual(result, { controls });
    assert.deepEqual(calls, ['open', 'read', 'cancel', 'open', 'read']);
  });

  await t.test('探查超时配置在调用时读取，缺省及无效值回退 60 秒', () => {
    delete process.env.PROBE_TIMEOUT_MS;
    assert.equal(uiWaitConfig().probeTimeoutMs, 60_000);
    for (const value of ['0', '-1', 'invalid']) {
      process.env.PROBE_TIMEOUT_MS = value;
      assert.equal(uiWaitConfig().probeTimeoutMs, 60_000);
    }
    process.env.PROBE_TIMEOUT_MS = '1500';
    assert.equal(uiWaitConfig().probeTimeoutMs, 1500);
  });
});
