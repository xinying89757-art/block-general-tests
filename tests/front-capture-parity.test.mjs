import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { testBrowserConfig } from './test-browser-config.mjs';
import { readInstanceStructure } from '../src/front-structure.mjs';
import { checkDesignRequirementFront } from '../src/design-spec-checklist.mjs';
import { runFrontLayer } from '../src/capabilities/block-style-spec.mjs';

const rootSelector = '[data-capture-node="0"]';
const requirement = { id: 'image-ratio', checkType: 'image-ratio', sourceText: 'Image ratio',
  checkStage: 'front', expected: { ratio: '1:1', centered: true }, params: {} };
async function fixture(block, viewport, work) {
  const browser = await chromium.launch(testBrowserConfig());
  try {
    const page = await browser.newPage({ viewport: { width: viewport === 'pc' ? 1440 : 375, height: viewport === 'pc' ? 900 : 667 } });
    await page.goto(new URL(`./fixtures/captures/${block}/${viewport}.html`, import.meta.url).href);
    await work(page, () => page.evaluate(readInstanceStructure, { rootSelector, imageMode: 'content' }));
  } finally { await browser.close(); }
}
for (const block of ['47498', '47748']) for (const viewport of ['pc', 'mobile']) {
  test(`G71 capture/live measurement parity ${block}/${viewport}`, async () => fixture(block, viewport, async (page, read) => {
    const manifest = JSON.parse(await fs.readFile(new URL(`./fixtures/captures/${block}/manifest.json`, import.meta.url), 'utf8'));
    assert.match(manifest.source, /1793539494$/);
    assert.ok(manifest.outputs.every((output) => output.replayObservations === true));
    const structure = await read();
    assert.equal(structure.rootCount, 1);
    assert.equal(structure.hierarchy.length, 0);
    assert.equal(structure.options.length, block === '47498' ? 22 : 0, 'must equal LIVE report, not G70 replay count');
    const result = await checkDesignRequirementFront(requirement, { page, rootSelector, imageLoadTimeoutMs: 2400 });
    assert.equal(result.status, 'na');
    if (block === '47748') {
      const raw = await page.locator('img').evaluateAll((images) => images.map((image) => ({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })));
      assert.equal(raw.length, 20); assert.ok(raw.every((image) => image.naturalWidth === 0 && image.naturalHeight === 0), 'do not turn failed sources into loaded SVGs');
      assert.equal(structure.images.length, 20);
      assert.equal(structure.imageSelection.cardCount, 20);
      assert.ok(structure.images.every((image) => image.ratio === null && image.measurementStatus === 'unavailable'));
      assert.ok(structure.images.every((image) => image.renderedDimensions.height >= 18 && image.renderedDimensions.height <= 34));
      const first = structure.images[0];
      assert.ok(Math.abs(first.renderedDimensions.width - 174.23) < .03);
      assert.equal(first.mediaSlot.height, viewport === 'pc' ? 234 : 220.4375);
      assert.equal(result.reason.code, 'primary-image-dimensions-unavailable');
      assert.equal(structure.absenceReasons.hierarchy, 'navigation-child-levels-not-in-instance-dom');
      assert.equal(structure.absenceReasons.options, 'text-filter-without-option-nodes');
      assert.equal(structure.optionEvidence.textFilterInputCount, 1);
      assert.equal(structure.hierarchyEvidence.flatNavigationItemCount, 1);
    } else {
      assert.equal(structure.images.length, 0);
      assert.equal(result.reason.code, 'image-ratio-elements-unresolved');
    }
  }));
}

test('capture-based main-image ranking chooses largest primary-slot media, not first broken img/banner/badge', async () => fixture('47748', 'pc', async (page, read) => {
  await page.evaluate(() => {
    const original = document.querySelector('[data-capture-node="56"]');
    const parent = original.parentElement;
    const image = original.cloneNode(false);
    image.id = 'main-image'; image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'/%3E";
    image.style.cssText = 'display:block;width:200px;height:200px';
    // Keep the original 174x22 failed image first, exactly as captured.
    parent.append(image);
    const badge = image.cloneNode(false); badge.id = 'badge'; badge.style.cssText = 'display:block;width:18px;height:18px';
    parent.prepend(badge);
    const banner = image.cloneNode(false); banner.id = 'banner'; banner.style.cssText = 'display:block;width:200px;height:20px';
    parent.prepend(banner);
  });
  await page.waitForFunction(() => document.querySelector('#main-image').naturalWidth > 0, undefined, { timeout: 3000 });
  const structure = await read();
  assert.equal(structure.images.length, 20);
  const first = structure.images[0];
  assert.equal(await page.locator(rootSelector).locator(first.path).getAttribute('id'), 'main-image');
  assert.equal(first.ratio, 1);
  assert.equal(first.measurementStatus, 'measured');
  assert.ok(structure.finderDebug.finders.image.reasonCounts['secondary-card-media'] >= 2);
  const pending = await checkDesignRequirementFront(requirement, { page, rootSelector, imageLoadTimeoutMs: 2400 });
  assert.equal(pending.status, 'na', 'one loaded square must not hide the 19 unknown main images');
  await page.locator('#main-image').evaluate((image) => { image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='100'/%3E"; });
  await page.waitForFunction(() => document.querySelector('#main-image').naturalHeight === 100, undefined, { timeout: 3000 });
  const failure = await checkDesignRequirementFront(requirement, { page, rootSelector, imageLoadTimeoutMs: 2400 });
  assert.equal(failure.status, 'fail', 'a real measurable mismatch still fails even with unavailable peers');
  assert.equal(failure.reason.code, 'image-ratio-mismatch');
}));

test('equal main-image evidence is not resolved by DOM order or counted as a pass', async () => fixture('47748', 'pc', async (page) => {
  await page.evaluate(() => {
    const original = document.querySelector('[data-capture-node="56"]');
    original.parentElement.append(original.cloneNode());
  });
  const result = await checkDesignRequirementFront(requirement, { page, rootSelector, imageLoadTimeoutMs: 2400 });
  assert.equal(result.status, 'na'); assert.equal(result.reason.code, 'primary-media-choice-ambiguous');
  assert.equal(result.actual.imageSelection.ambiguousCards.length, 1);
}));

test('real absent nav/filter checks report human review with original machine reasons through the production style runner', async () => fixture('47748', 'pc', async (page) => {
  const rows = await runFrontLayer({ frame: page, previewPage: page, config: { blockId: '47748', rootSelector, actionTimeoutMs: 3000 },
    capability: { id: 'block-style-spec', styleSpec: { items: [
      { id: 'nav-parent', kind: 'nav-parent', props: { fontWeight: 700 } },
      { id: 'nav-leaf', kind: 'nav-leaf', props: { fontWeight: 400 } },
      { id: 'filter-option', kind: 'sample', props: { fontSize: 14 } },
    ] } } });
  for (const id of ['nav-parent', 'nav-leaf', 'filter-option']) {
    const row = rows.find((item) => item.id === `bss-${id}`);
    assert.equal(row.status, 'human-review', JSON.stringify(row));
    assert.equal(row.reason.code, id === 'filter-option' ? 'text-filter-without-option-nodes' : 'navigation-child-levels-not-in-instance-dom');
  }
}));
