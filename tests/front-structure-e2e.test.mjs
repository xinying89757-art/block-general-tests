import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readInstanceStructure } from '../src/front-structure.mjs';
import { checkDesignRequirementFront } from '../src/design-spec-checklist.mjs';

test('shared instance finder covers lazy/content/background images, linkless ul/div levels and options', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div class="target" style="width:360px">
      <ul><li><span>Parent list</span><ul style="display:none"><li>Child list</li></ul></li></ul>
      <div><div><span>Parent div</span><div hidden><div><span>Child div</span></div></div></div></div>
      <label><input type="checkbox"><span>Option</span></label><div role="listbox"><div role="option">Choice</div></div>
      <section><div><img width="80" height="80" data-src="/lazy-one.png" style="display:block;width:80px;height:80px;object-position:50% 50%"><span>Card one</span>
        <div style="width:40px;height:40px;background-image:url('/lazy-bg.png');background-position:50% 50%"></div></div>
      <div><img width="80" height="80" data-lazy-src="/lazy-two.png" style="display:block;width:80px;height:80px;object-position:50% 50%"><span>Card two</span></div></section>
      <section><div><div style="width:80px;height:80px;background-image:url('/background-one.png');background-position:center"></div><span>Background card one</span></div>
      <div><div style="width:80px;height:80px;background-image:url('/background-two.png');background-position:center"></div><span>Background card two</span></div></section>
      <img data-src="/banner.png" style="width:360px;height:40px"><div style="width:360px;height:40px;background-image:url('/banner-bg.png')"></div>
      </div><div class="other-instance"><img data-src="/outside.png"><ul><li>Outside</li></ul></div>`);
    const structure = await page.evaluate(readInstanceStructure, { rootSelector: '.target' });
    assert.equal(structure.rootCount, 1);
    assert.ok(structure.hierarchy.some((item) => item.level === 2 && !item.visible));
    assert.equal(structure.maxVisibleLevel, 1);
    assert.equal(structure.options.length, 2);
    assert.equal(structure.images.filter((item) => item.content).length, 4);
    assert.ok(structure.images.some((item) => item.kind === 'background-image' && item.content));
    assert.ok(structure.images.filter((item) => item.content && item.kind === 'img').every((item) => item.hasLazySource));
    const requirement = (id, checkType, expected) => ({ id, checkType, expected, sourceText: id, checkStage: 'front', params: {} });
    const check = (item) => checkDesignRequirementFront(item, { page, rootSelector: '.target', profile: { designSpec: { overrides: [] } } });
    assert.equal((await check(requirement('images', 'image-ratio', { ratio: '1:1', centered: true }))).status, 'pass');
    assert.equal((await check(requirement('expanded', 'default-expand', { level: 1, collapsedLevel: 2 }))).status, 'pass');
    assert.equal((await check(requirement('hierarchy', 'nav-hierarchy-levels', { levels: [1, 2] }))).status, 'pass');
  } finally { await browser.close(); }
});
