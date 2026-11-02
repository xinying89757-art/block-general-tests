import test from 'node:test';
import assert from 'node:assert/strict';
import { openRailPanelWithRetry } from '../src/capabilities/rail.mjs';

test('rail opener resolves a fresh target toolbar after the old positional index becomes stale', async () => {
  let generation = 0;
  let open = false;
  const clicked = [];
  const result = await openRailPanelWithRetry({
    readPanelOpen: async () => open,
    resolveToolbar: async () => ({ generation: ++generation, settingId: 'fresh-target' }),
    resolveToggle: async (toolbar) => toolbar,
    clickToggle: async (toolbar) => {
      clicked.push(toolbar.generation);
      if (clicked.length === 1) throw new Error('stale positional control detached');
      open = true;
    },
    waitPanelOpen: async () => open,
  });
  assert.deepEqual(clicked, [1, 2]);
  assert.equal(generation, 2);
  assert.equal(result.attempt, 2);
});

test('rail opener leaves an already-open target panel untouched', async () => {
  let resolutions = 0;
  const result = await openRailPanelWithRetry({
    readPanelOpen: async () => true,
    resolveToolbar: async () => { resolutions += 1; return {}; },
    resolveToggle: async () => ({}),
    clickToggle: async () => assert.fail('must not toggle an open panel'),
    waitPanelOpen: async () => true,
  });
  assert.equal(result.alreadyOpen, true);
  assert.equal(resolutions, 0);
});

test('rail opener uses the fallback toggle selector when the preferred control is absent', async () => {
  let open = false;
  const strategies = [];
  const result = await openRailPanelWithRetry({
    readPanelOpen: async () => open,
    resolveToolbar: async () => ({}),
    resolveToggle: async (_toolbar, { preferred }) => preferred ? null : { selector: 'fallback' },
    clickToggle: async (toggle) => { strategies.push(toggle.selector); open = true; },
    waitPanelOpen: async () => open,
  });
  assert.deepEqual(strategies, ['fallback']);
  assert.ok(result.strategies.includes('fallback-toggle'));
});

test('rail opener reports a classified failure with attempted strategies when retries are exhausted', async () => {
  let resolutions = 0;
  await assert.rejects(openRailPanelWithRetry({
    attempts: 2,
    readPanelOpen: async () => false,
    resolveToolbar: async () => { resolutions += 1; return { generation: resolutions }; },
    resolveToggle: async (_toolbar, { preferred }) => preferred ? {} : null,
    clickToggle: async () => {},
    waitPanelOpen: async () => false,
  }), (error) => {
    assert.equal(error.code, 'panel-not-opened');
    assert.match(error.message, /panel-not-opened/);
    assert.match(error.message, /target-instance-toolbar/);
    assert.match(error.message, /panel-not-opened-after-attempt-2/);
    assert.equal(resolutions, 2);
    return true;
  });
});
