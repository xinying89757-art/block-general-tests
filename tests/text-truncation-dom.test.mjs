import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { testBrowserConfig } from './test-browser-config.mjs';
import { checkDesignRequirementFront } from '../src/design-spec-checklist.mjs';

test('truncation resolves repeated card titles only inside the target instance', async () => {
  const browser = await chromium.launch(testBrowserConfig());
  try {
    const page = await browser.newPage();
    await page.setContent(`<div class="outside"><a href="/other">Outside title that must not be measured</a></div>
      <div class="instance"><div class="cards">
        <article class="card"><a href="/a"><img width="10" height="10"><span class="item-name">A fairly long product title</span></a></article>
        <article class="card"><a href="/b"><img width="10" height="10"><span class="item-name">Another long product title</span></a></article>
      </div></div><style>.item-name { display:block; width:60px; white-space:nowrap; overflow:hidden; text-overflow:clip }</style>`);
    const item = { id: 'title', checkType: 'text-truncation', sourceText: 'One line', expected: { maxLines: 1 }, checkStage: 'front', params: {} };
    const profile = { designSpec: { requirements: [item], overrides: [] } };
    const check = () => checkDesignRequirementFront(item, { profile, page, rootSelector: '.instance' });
    let result = await check();
    assert.equal(result.status, 'pass');
    assert.equal(result.actual.elements.length, 2);
    assert.equal(result.actual.overflowExercised, true);
    await page.locator('.item-name').evaluateAll((nodes) => nodes.forEach((node) => { node.style.whiteSpace = 'normal'; node.style.overflow = 'visible'; }));
    result = await check();
    assert.equal(result.status, 'fail');
    assert.equal(result.reason.code, 'text-truncation-mismatch');
    await page.locator('.cards').evaluate((node) => node.remove());
    result = await check();
    assert.equal(result.status, 'human-review');
    assert.equal(result.reason.code, 'text-truncation-elements-unresolved');
  } finally { await browser.close(); }
});
