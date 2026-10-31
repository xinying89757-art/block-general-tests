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
  assert.deepEqual(summary, { targetBlockId: '47498', targetFound: false,
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
