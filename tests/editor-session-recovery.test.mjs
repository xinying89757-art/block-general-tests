import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleEditorError, openWithLoginRecovery } from '../src/editor-session-recovery.mjs';

test('stale editor readiness and unreadable identity trigger one login refresh and relaunch', async () => {
  assert.equal(isStaleEditorError(new Error('编辑器未显示“页面:”')), true);
  assert.equal(isStaleEditorError(new Error('无法确认当前编辑器对应的站点 host')), true);
  let launched = 0, opened = 0, refreshes = 0, closes = 0;
  const result = await openWithLoginRecovery({
    launch: async () => ({ browser: { close: async () => { closes++; } }, id: ++launched }),
    open: async (session) => {
      opened++;
      if (session.id === 1) throw new Error('编辑器未显示“页面:”');
      return 'target-ready';
    },
    forceLogin: async () => { refreshes++; },
  });
  assert.equal(result.value, 'target-ready');
  assert.equal(result.loginRefreshed, true);
  assert.deepEqual({ launched, opened, refreshes, closes }, { launched: 2, opened: 2, refreshes: 1, closes: 1 });
});

test('readable site-host mismatch does not trigger login retry', async () => {
  let refreshes = 0;
  await assert.rejects(openWithLoginRecovery({
    launch: async () => ({ browser: { close: async () => {} } }),
    open: async () => { throw new Error('编辑器站点身份不匹配'); },
    forceLogin: async () => { refreshes++; },
  }), /身份不匹配/);
  assert.equal(refreshes, 0);
});

test('failed editor retry after force-login reports the refresh attempt', async () => {
  let calls = 0;
  await assert.rejects(openWithLoginRecovery({
    launch: async () => ({ browser: { close: async () => {} } }),
    open: async () => { calls++; throw new Error('编辑器未显示“页面:”'); },
    forceLogin: async () => {},
  }), /force-login 后重试编辑器仍失败/);
  assert.equal(calls, 2);
});
