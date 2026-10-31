import test from 'node:test';
import assert from 'node:assert/strict';
import { probeTargetAcrossModes, searchTargetInMode, summarizeTargetSearch } from '../src/module-library-inventory.mjs';

test('module lookup queries one requested number, waits, scrolls, and returns only target status', async () => {
  const events = [];
  const result = await searchTargetInMode({ mode: 'review', targetBlockId: '47498',
    selectMode: async () => events.push('select'), submitTarget: async (id) => events.push(`query:${id}`),
    waitForLazyResults: async () => events.push('wait'), scrollResultsToEnd: async () => events.push('scroll'),
    targetPresent: async (id) => { events.push(`target-only:${id}`); return true; },
    captureMissing: async () => { throw new Error('must not screenshot found result'); } });
  assert.deepEqual(events, ['select', 'query:47498', 'wait', 'scroll', 'wait', 'target-only:47498']);
  assert.deepEqual(result, { mode: 'review', query: '47498', found: true,
    searched: true, waitedForLazyResults: true, scrolledToEnd: true });
});

test('target search reports missing mode with its own screenshot and never returns other IDs', async () => {
  const result = await searchTargetInMode({ mode: 'develop', targetBlockId: '47498',
    selectMode: async () => {}, submitTarget: async (id) => assert.equal(id, '47498'),
    waitForLazyResults: async () => {}, scrollResultsToEnd: async () => {}, targetPresent: async () => false,
    captureMissing: async (mode, id) => `logs/${id}-${mode}.png` });
  const summary = summarizeTargetSearch({ targetBlockId: '47498', modes: [result] });
  assert.deepEqual(summary, { targetBlockId: '47498', targetFound: false, searchComplete: true,
    modes: [{ mode: 'develop', query: '47498', found: false, searched: true, status: 'checked', screenshot: 'logs/47498-develop.png',
      error: null, waitedForLazyResults: true, scrolledToEnd: true }] });
  assert.equal(JSON.stringify(summary).includes('111'), false);
});

test('target-only library summary rejects a mode queried for a different number', () => {
  assert.throws(() => summarizeTargetSearch({ targetBlockId: '47498', modes: [{ mode: 'review', query: '111', found: false }] }),
    /only the requested block number/);
});

test('all configured modes are searched only for the target and absent modes capture evidence', async () => {
  const queried = [];
  const modes = await probeTargetAcrossModes({ targetBlockId: '47498',
    probeMode: async ({ mode, targetBlockId }) => { queried.push([mode, targetBlockId]); return { found: false,
      searched: true, waitedForLazyResults: true, scrolledToEnd: true }; },
    captureMissing: async (mode, target) => `${mode}-${target}.png` });
  assert.deepEqual(queried, [['review', '47498'], ['develop', '47498'], ['online', '47498']]);
  assert.deepEqual(modes.map(({ mode, query, found, screenshot }) => [mode, query, found, screenshot]), [
    ['review', '47498', false, 'review-47498.png'], ['develop', '47498', false, 'develop-47498.png'],
    ['online', '47498', false, 'online-47498.png'],
  ]);
});

test('unavailable mode does not capture a full-library screenshot before a target query', async () => {
  let screenshots = 0;
  const result = await probeTargetAcrossModes({ targetBlockId: '47498', modes: ['review'],
    probeMode: async () => ({ searched: false, found: false, status: 'error' }),
    captureMissing: async () => { screenshots += 1; return 'unexpected.png'; } });
  assert.equal(result[0].searched, false);
  assert.equal(result[0].screenshot, null);
  assert.equal(screenshots, 0);
});

test('mode or target-input failure before submit is not reported as a searched mode or screenshotted', async () => {
  for (const failureStage of ['mode', 'submit']) {
    let screenshots = 0;
    const modes = await probeTargetAcrossModes({ targetBlockId: '47498', modes: ['review'],
      probeMode: async ({ mode, targetBlockId }) => searchTargetInMode({ mode, targetBlockId,
        selectMode: async () => { if (failureStage === 'mode') throw new Error('tab is unavailable'); },
        submitTarget: async () => { if (failureStage === 'submit') throw new Error('input is not visible'); },
        waitForLazyResults: async () => {}, scrollResultsToEnd: async () => {}, targetPresent: async () => false }),
      captureMissing: async () => { screenshots += 1; return 'not-allowed.png'; } });
    assert.equal(modes[0].searched, false);
    assert.equal(modes[0].screenshot, null);
    assert.equal(screenshots, 0);
    assert.equal(summarizeTargetSearch({ targetBlockId: '47498', modes }).searchComplete, false);
  }
});

test('post-submit result timeout is incomplete evidence and does not create a not-found screenshot', async () => {
  let screenshots = 0;
  const modes = await probeTargetAcrossModes({ targetBlockId: '47498', modes: ['online'],
    probeMode: async ({ mode, targetBlockId }) => searchTargetInMode({ mode, targetBlockId,
      selectMode: async () => {}, submitTarget: async () => {},
      waitForLazyResults: async () => { throw new Error('results did not settle'); },
      scrollResultsToEnd: async () => {}, targetPresent: async () => false }),
    captureMissing: async () => { screenshots += 1; return 'not-allowed.png'; } });
  assert.equal(modes[0].searched, true);
  assert.equal(modes[0].status, 'error');
  assert.equal(modes[0].screenshot, null);
  assert.equal(summarizeTargetSearch({ targetBlockId: '47498', modes }).searchComplete, false);
  assert.equal(screenshots, 0);
});

test('mode searches reopen and close one scoped surface at a time and capture before closing', async () => {
  const events = [];
  const modes = await probeTargetAcrossModes({ targetBlockId: '47498', modes: ['online', 'develop', 'review'],
    openModeSurface: async ({ mode }) => { events.push(`open:${mode}`); return { mode }; },
    probeMode: async ({ mode, targetBlockId, surface }) => {
      assert.equal(surface.mode, mode);
      events.push(`query:${mode}:${targetBlockId}`);
      return { found: false, searched: true, status: 'checked' };
    },
    captureMissing: async (mode, target) => { events.push(`shot:${mode}:${target}`); return `${mode}.png`; },
    closeModeSurface: async ({ mode }) => events.push(`close:${mode}`),
  });
  assert.deepEqual(events, [
    'open:online', 'query:online:47498', 'shot:online:47498', 'close:online',
    'open:develop', 'query:develop:47498', 'shot:develop:47498', 'close:develop',
    'open:review', 'query:review:47498', 'shot:review:47498', 'close:review',
  ]);
  assert.equal(modes.every((item) => item.searched && item.status === 'checked'), true);
});
