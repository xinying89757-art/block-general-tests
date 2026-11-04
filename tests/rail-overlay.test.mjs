import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { describeInterceptingElement, isStaleBackdropInterceptor, probeClickInterceptor } from '../src/capabilities/rail.mjs';
import { blockingEditorOverlays, waitForEditorOverlaysBeforeAction } from '../src/editor.mjs';

test('describeInterceptingElement extracts the opening tag from Playwright interception logs', () => {
  const cases = [
    ['  - <DIV class="toast show" id="t1">...</DIV> intercepts pointer events', 'div#t1.toast.show'],
    ['<div class="toast show"><span>加载中</span></div> intercepts pointer events', 'div.toast.show'],
    ['<div>...</div> intercepts pointer events', 'div'],
    ["<div id='t1' class='toast show'>...</div> intercepts pointer events", 'div#t1.toast.show'],
    ['<div id="t1">...</div> intercepts pointer events', 'div#t1'],
    ['<div data-id="other" title="id=wrong" class="toast">...</div> intercepts pointer events', 'div.toast'],
    ['<div class="toast">...</div> is not visible', null],
    ['</div> intercepts pointer events', null],
  ];
  for (const [message, expected] of cases) assert.equal(describeInterceptingElement(message), expected);
});

for (const [detail, expected] of [
  ['div.backstage-dialog-overlay.hide', true],
  ['div.backstage-dialog-overlay', false],
  ['div.foo.hide', false],
  ['div.layui-layer-shade.hidden', true],
  ['div.panel.hideable', false],
  ['div#shade.invisible.layui-layer-shade', true],
  ['div.backstage-dialog-overlay.hideable', false],
  ['div.backstage-dialog-overlay.hidden-panel.invisible-mask', false],
  ['div.backstage-dialog-overlay-extra.hide', false],
  ['div#backstage-dialog-overlay.hide', false],
  ['div#hide.backstage-dialog-overlay', false],
  ['div.backstage-dialog-overlay.hide (pointer-events:auto, z-index:9999)', true],
  ['hit-test:div.backstage-dialog-overlay.hide (div.backstage-dialog-overlay.hide < body < html)', true],
  ['hit-test:div.foo.hide (div.foo.hide < div.backstage-dialog-overlay < body)', false],
  ['hit-test:div.backstage-dialog-overlay (div.backstage-dialog-overlay < div.foo.hide)', false],
  [null, false],
  [undefined, false],
  ['', false],
]) {
  test(`isStaleBackdropInterceptor(${JSON.stringify(detail)}) is ${expected}`, () => {
    assert.equal(isStaleBackdropInterceptor(detail), expected);
  });
}

test('a hidden backdrop intercepting a button is identified by the error and hit-test pipelines', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button style="position:fixed;left:100px;top:100px;width:100px;height:40px">toggle</button>
      <div class="backstage-dialog-overlay hide" style="position:fixed;inset:0;z-index:9999;opacity:0;pointer-events:auto"></div>`);
    const toggle = page.locator('button');
    assert.deepEqual(await waitForEditorOverlaysBeforeAction(page), []);
    await assert.rejects(toggle.click({ timeout: 200 }), (error) => {
      assert.match(error.message, /intercepts pointer events/);
      const detail = describeInterceptingElement(error.message);
      assert.equal(detail, 'div.backstage-dialog-overlay.hide');
      assert.equal(isStaleBackdropInterceptor(detail), true);
      return true;
    });
    const interceptor = await probeClickInterceptor(toggle);
    assert.equal(interceptor.hit, 'div.backstage-dialog-overlay.hide');
    assert.equal(isStaleBackdropInterceptor(`hit-test:${interceptor.hit} (${interceptor.chain})`), true);
  } finally { await browser.close(); }
});

test('overlay detection distinguishes known backdrops, generic overlays and edge toolbars', async (t) => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const scope = { locator: (selector) => page.locator(selector) };
    await t.test('known backdrops retain their marker and include their id', async () => {
      await page.setContent('<div id="shade" class="layui-layer-shade" style="position:fixed;inset:0;z-index:9999"></div>');
      assert.deepEqual(await waitForEditorOverlaysBeforeAction(scope, { timeoutMs: 100 }), [
        'div#shade.layui-layer-shade (pointer-events:auto, z-index:9999)',
      ]);
    });
    await t.test('unknown full-screen fixed overlays include id and classes', async () => {
      await page.setContent('<div id="unknown" class="toast show" style="position:fixed;inset:0;z-index:9999"></div>');
      assert.deepEqual(await waitForEditorOverlaysBeforeAction(scope, { timeoutMs: 100 }), [
        'div#unknown.toast.show (generic-fixed-overlay, pointer-events:auto, z-index:9999)',
      ]);
    });
    await t.test('a narrow edge toolbar is not a blocking overlay', async () => {
      await page.setContent('<div id="toolbar" style="position:fixed;left:0;top:0;bottom:0;width:60px;z-index:2000"></div>');
      assert.deepEqual(await waitForEditorOverlaysBeforeAction(scope, { timeoutMs: 100 }), []);
    });
    await t.test('center coverage and quarter-viewport coverage each qualify', async () => {
      await page.setContent(`
        <div id="center" style="position:fixed;left:390px;top:290px;width:20px;height:20px;z-index:1000"></div>
        <div id="quarter" style="position:fixed;left:0;top:0;bottom:0;width:200px;z-index:1000"></div>`);
      const blockers = await blockingEditorOverlays(scope);
      assert.equal(blockers.length, 2);
      assert.match(blockers[0], /^div#center \(generic-fixed-overlay,/);
      assert.match(blockers[1], /^div#quarter \(generic-fixed-overlay,/);
    });
    await t.test('nonblocking and invisible fixed elements are excluded', async () => {
      await page.setContent(['pointer-events:none', 'display:none', 'visibility:hidden', 'z-index:999', 'z-index:auto', 'position:absolute']
        .map((override) => `<div style="position:fixed;inset:0;z-index:9999;${override}"></div>`).join(''));
      assert.deepEqual(await blockingEditorOverlays(scope), []);
    });
  } finally { await browser.close(); }
});

test('probeClickInterceptor describes the hit and its ancestors, ignoring the toggle and its children', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button style="position:fixed;left:100px;top:100px;width:100px;height:40px"><span>toggle</span></button>
      <div id="overlay" class="toast show" style="position:fixed;inset:0;z-index:9999"></div>`);
    const toggle = page.locator('button');
    assert.deepEqual(await probeClickInterceptor(toggle), {
      hit: 'div#overlay.toast.show', chain: 'div#overlay.toast.show < body < html',
    });
    await page.locator('#overlay').evaluate((node) => node.remove());
    assert.equal(await probeClickInterceptor(toggle), null);
    await toggle.evaluate((node) => { node.style.left = '-200px'; });
    assert.equal(await probeClickInterceptor(toggle), null);
  } finally { await browser.close(); }
});
