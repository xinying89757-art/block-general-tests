import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { readInstanceStructure } from '../src/front-structure.mjs';
import { checkDesignRequirementFront } from '../src/design-spec-checklist.mjs';

const rootSelector = '[data-capture-node="0"]';
async function captured(block, viewport, run) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: viewport === 'pc' ? 1440 : 375, height: viewport === 'pc' ? 900 : 667 } });
    await page.goto(new URL(`./fixtures/captures/${block}/${viewport}.html`, import.meta.url).href);
    await run(page, async () => page.evaluate(readInstanceStructure, { rootSelector, imageMode: 'content' }));
  } finally { await browser.close(); }
}
const req = (checkType, expected) => ({ id: checkType, checkType, expected, params: {}, sourceText: checkType, checkStage: 'front' });

for (const block of ['47498', '47748']) for (const viewport of ['pc', 'mobile']) {
  test(`real capture ${block}/${viewport}: content images, native labels and absence of category depth`, async () => captured(block, viewport, async (page, read) => {
    const result = await read();
    assert.equal(result.rootCount, 1);
    assert.equal(result.images.length, block === '47748' ? 20 : 0);
    assert.ok(result.images.every((entry) => entry.kind === 'img' && entry.content));
    assert.equal(result.options.length, block === '47498' ? 22 : 0);
    assert.equal(result.hierarchy.length, 0, 'capture has no nested/leveled category DOM; the lone category arrow must not invent child levels');
    assert.equal(result.absenceReasons.hierarchy, block === '47748' ? 'navigation-child-levels-not-in-instance-dom' : 'no-hierarchy-dom-in-instance');
    for (const kind of ['nav-parent', 'nav-leaf']) assert.equal(result.finderDebug.finders[kind].acceptedCount, 0);
    assert.equal(result.finderDebug.finders.interaction, undefined);
    for (const type of ['default-expand', 'nav-hierarchy-levels']) {
      const check = await checkDesignRequirementFront(req(type, { level: 1, levels: [1, 2] }), { page, rootSelector });
      assert.equal(check.status, 'human-review'); assert.equal(typeof check.reason.code, 'string');
    }
    if (block === '47498') {
      const check = await checkDesignRequirementFront(req('image-ratio', { ratio: '1:1' }), { page, rootSelector });
      assert.equal(check.status, 'na'); assert.equal(check.reason.code, 'image-ratio-elements-unresolved');
    } else {
      assert.ok(result.finderDebug.finders.image.reasonCounts['gradient-not-content-image'] > 0);
      assert.ok(result.finderDebug.finders.hierarchy.reasonCounts['pagination-not-hierarchy'] > 0);
      assert.ok(result.finderDebug.finders.image.decisions.filter((row) => row.decision === 'accepted').every((row) => row.tag === 'img'));
    }
  }));
}

test('real category markup with nested captured children resolves parent/leaf, excluding pagination and filter groups', async () => captured('47748', 'pc', async (page, read) => {
  await page.evaluate(() => {
    const list = document.querySelector('[data-capture-node="13"]');
    const childList = list.cloneNode(true);
    list.firstElementChild.append(childList);
  });
  const result = await read();
  assert.deepEqual(result.allLevels, [1, 2]);
  assert.equal(result.hierarchy.length, 2);
  assert.equal(result.finderDebug.finders['nav-parent'].acceptedCount, 1);
  assert.equal(result.finderDebug.finders['nav-leaf'].acceptedCount, 1);
  assert.equal(result.hierarchy.filter((row) => row.hasChildren && row.level === 1).length, 1);
  assert.equal(result.hierarchy.filter((row) => !row.hasChildren && row.level === 2).length, 1);
  assert.equal(result.images.length, 20);
}));

test('captured category siblings resolve attribute, class and indentation depth without a nested ul', async () => captured('47748', 'mobile', async (page, read) => {
  await page.evaluate(() => {
    const list = document.querySelector('[data-capture-node="13"]');
    list.append(list.firstElementChild.cloneNode(true), list.firstElementChild.cloneNode(true));
    [...list.children].forEach((node) => {
      node.style.setProperty('position', 'relative', 'important');
      node.style.setProperty('top', 'auto', 'important'); node.style.setProperty('left', 'auto', 'important');
    });
    [...list.children].forEach((node, index) => node.setAttribute('data-level', String(index)));
  });
  assert.deepEqual((await read()).allLevels, [1, 2, 3]);
  await page.evaluate(() => {
    [...document.querySelector('[data-capture-node="13"]').children].forEach((node, index) => {
      node.removeAttribute('data-level'); node.classList.add(`level-${index + 1}`);
    });
  });
  assert.deepEqual((await read()).allLevels, [1, 2, 3]);
  await page.evaluate(() => {
    [...document.querySelector('[data-capture-node="13"]').children].forEach((node, index) => {
      node.classList.remove(`level-${index + 1}`); node.style.setProperty('padding-inline-start', `${index * 20}px`, 'important');
    });
  });
  assert.deepEqual((await read()).allLevels, [1, 2, 3]);
}));

test('captured product images support lazy attributes and declared sizes; navigation backgrounds/icons/banners are excluded', async () => captured('47748', 'pc', async (page, read) => {
  await page.evaluate(() => {
    const image = document.querySelector('[data-capture-node="56"]');
    const source = image.src;
    image.removeAttribute('src'); image.setAttribute('data-original', source);
    image.setAttribute('width', '90'); image.setAttribute('height', '45');
    const icon = image.cloneNode(); icon.setAttribute('role', 'presentation');
    const smallIcon = image.cloneNode(); smallIcon.removeAttribute('alt'); smallIcon.removeAttribute('data-original');
    smallIcon.setAttribute('src', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/%3E');
    smallIcon.style.cssText = 'width:16px;height:16px'; smallIcon.width = 16; smallIcon.height = 16;
    image.parentElement.append(smallIcon);
    document.querySelector('[data-capture-node="55"]').append(icon);
    const banner = image.cloneNode(); document.querySelector('[data-capture-node="0"]').append(banner);
    const nav = document.querySelector('[data-capture-node="16"]');
    nav.style.backgroundImage = `url("${source}")`;
  });
  const result = await read();
  assert.equal(result.images.length, 20);
  assert.equal(result.images.filter((row) => row.kind === 'background-image').length, 0);
  const first = result.images[0];
  assert.equal(first.width, 90); assert.equal(first.height, 45);
  assert.deepEqual(first.dimensionSource, { width: 'attribute', height: 'attribute' });
  for (const code of ['decorative-image-semantics', 'ancillary-card-icon', 'no-content-container', 'link-or-container-background-decoration']) {
    assert.ok(result.finderDebug.finders.image.reasonCounts[code] > 0, code);
  }
}));

test('real card structure admits a dedicated content background image', async () => captured('47748', 'pc', async (page, read) => {
  await page.evaluate(() => {
    const image = document.querySelector('[data-capture-node="56"]');
    const media = image.parentElement.parentElement.cloneNode(false);
    media.style.cssText = `width:90px;height:45px;background-image:url("${image.src}")`;
    image.parentElement.replaceWith(media);
  });
  const result = await read();
  assert.equal(result.images.length, 20);
  assert.equal(result.images.filter((entry) => entry.kind === 'background-image' && entry.content).length, 1);
}));

test('capture-derived option links/labels with JS bindings need neither ARIA nor native inputs; no handlers run', async () => captured('47748', 'pc', async (page, read) => {
  await page.evaluate(() => {
    const original = document.querySelector('[data-capture-node="16"]');
    const body = document.querySelector('[data-capture-node="27"]');
    window.optionActions = 0;
    for (let index = 0; index < 2; index++) {
      const link = original.cloneNode(true); link.removeAttribute('groupid'); link.href = '#';
      link.onclick = () => { window.optionActions++; }; body.append(link);
    }
  });
  assert.equal((await read()).options.length, 2);
  assert.equal(await page.evaluate(() => window.optionActions), 0);
}));

test('all committed capture-derived HTML/CSS/manifest fixtures are inert and credential-free', async () => {
  for (const block of ['47498', '47748']) {
    const directory = new URL(`./fixtures/captures/${block}/`, import.meta.url);
    for (const file of await fs.readdir(directory)) {
      const content = await fs.readFile(new URL(file, directory), 'utf8');
      if (file === 'manifest.json') for (const row of JSON.parse(content).outputs) {
        assert.match(row.sourceSha256, /^[a-f0-9]{64}$/);
        assert.match(row.sourceCapture, /^(pc|mobile)\.json$/);
      }
      assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9]|(?:password|authorization|cookie|access[-_]?token|session[-_]?id)\s*[=:]|<script\b|\son(?:click|load|error)=/i, file);
    }
  }
});
