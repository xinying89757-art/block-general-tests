import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLibraryEntries, summarizeLibraryInventory } from '../src/module-library-inventory.mjs';

test('library inventory normalizes entries and collapses exact duplicate add controls', () => {
  assert.deepEqual(normalizeLibraryEntries([
    { appid: '47498', displayText: ' Product Grid ', visible: true },
    { blockId: '47498', name: 'Product Grid', visible: true },
    { appid: '', name: 'no identity' },
  ]), [{ blockId: '47498', name: 'Product Grid', visible: true }]);
});

test('library summary locates target by block number and lists other visible block numbers by mode', () => {
  const summary = summarizeLibraryInventory({ targetBlockId: '47498', modes: [
    { mode: 'review', entries: [{ blockId: '111', name: 'A' }, { blockId: '47498', name: 'Grid' }] },
    { mode: 'develop', entries: [{ blockId: '222', name: 'B' }] },
    { mode: 'online', source: 'target-search', query: '47498', entries: [{ blockId: '47498', name: 'Grid online' }], complete: false },
  ] });
  assert.equal(summary.targetFound, true);
  assert.deepEqual(summary.targetMatches.map(({ mode, name }) => ({ mode, name })), [
    { mode: 'review', name: 'Grid' }, { mode: 'online', name: 'Grid online' },
  ]);
  assert.deepEqual(summary.allBlockNumbers, ['111', '222', '47498']);
  assert.equal(summary.modes[2].complete, false);
});

test('library summary fails closed when target identity is absent', () => {
  assert.throws(() => summarizeLibraryInventory({ modes: [], targetBlockId: '' }), /target block number/);
});
