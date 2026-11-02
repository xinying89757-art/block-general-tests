import test from 'node:test';
import assert from 'node:assert/strict';
import { openRailPanelWithRetry, resolveRailToggle } from '../src/capabilities/rail.mjs';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { readFreshWidthInventory, appendFreshSettingsInventory } from '../src/fresh-block-browser-adapter.mjs';

const capture = JSON.parse(fs.readFileSync(new URL('./fixtures/rail/rail-capture-sanitized.json', import.meta.url), 'utf8'));
const selectedRail = (label) => capture.instances.find((item) => item.label === label).phases.selected.rails[0].html;

async function withCapturedRail(html, callback) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body>${html}</body></html>`);
    await callback(page.locator('.siteblocks-setting-operateTools').first());
  } finally { await browser.close(); }
}

const widthFallback = '[class*="telescopic"], [data-action*="width"], [aria-label*="宽度"], [title*="宽度"]';

test('captured selected rails resolve width toggle for B and classify absent for A', async () => {
  await withCapturedRail(selectedRail('B'), async (rail) => {
    const toggle = await resolveRailToggle(rail, '.block_telescopic', widthFallback);
    assert.equal(toggle.absent, undefined);
    assert.equal(await toggle.isVisible(), true);
  });
  await withCapturedRail(selectedRail('A'), async (rail) => {
    const result = await resolveRailToggle(rail, '.block_telescopic', widthFallback);
    assert.equal(result.absent, true);
    assert.deepEqual(result.matchCounts.map((item) => item.count), [0, 0]);
    await assert.rejects(openRailPanelWithRetry({
      readPanelOpen: async () => false, resolveToolbar: async () => rail,
      resolveToggle: (toolbar, options) => resolveRailToggle(toolbar, '.block_telescopic', widthFallback, options),
      clickToggle: async () => assert.fail('absent control must not be clicked'), waitPanelOpen: async () => false,
    }), (error) => error.code === 'rail-toggle-absent');
  });
});

test('captured selected rail with hidden width control stays rail-toggle-not-visible', async () => {
  await withCapturedRail(selectedRail('B'), async (rail) => {
    await rail.locator('.block_telescopic').evaluate((node) => { node.style.display = 'none'; });
    const result = await resolveRailToggle(rail, '.block_telescopic', widthFallback);
    assert.equal(result, null);
    await assert.rejects(openRailPanelWithRetry({
      readPanelOpen: async () => false, resolveToolbar: async () => rail,
      resolveToggle: (toolbar, options) => resolveRailToggle(toolbar, '.block_telescopic', widthFallback, options),
      clickToggle: async () => assert.fail('hidden control must not be clicked'), waitPanelOpen: async () => false, attempts: 1,
    }), (error) => error.code === 'rail-toggle-not-visible');
  });
});

test('absent width inventory continues with control-absent and only cancels an opened panel', async () => {
  let inventoryCalls = 0;
  let cancels = 0;
  const width = await readFreshWidthInventory({
    open: async () => { const error = new Error('absent'); error.code = 'rail-toggle-absent'; throw error; },
    read: async () => assert.fail('absent control must not be read'), cancel: async () => { cancels += 1; },
  });
  const regions = await appendFreshSettingsInventory(null, width, async () => { inventoryCalls += 1; return [{ title: 'other-settings' }]; });
  const widthRegion = regions[1];
  assert.equal(widthRegion.status, 'control-absent');
  assert.deepEqual(widthRegion.controls, []);
  assert.match(widthRegion.notes[0], /not offered/);
  assert.equal(inventoryCalls, 1);
  assert.equal(regions.at(-1).title, 'other-settings');
  assert.equal(cancels, 0);
  await assert.rejects(readFreshWidthInventory({ open: async () => { throw Object.assign(new Error('hidden'), { code: 'rail-toggle-not-visible' }); },
    read: async () => ({}), cancel: async () => { cancels += 1; } }), (error) => error.code === 'rail-toggle-not-visible');
  assert.equal(cancels, 0);
  const opened = await readFreshWidthInventory({ open: async () => {}, read: async () => ({ radios: [] }),
    cancel: async () => { cancels += 1; } });
  assert.deepEqual(opened, { radios: [] });
  assert.equal(cancels, 1);
});

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
