import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { captureFrontInstance, sanitizeCaptureAttribute, sanitizeCaptureText } from '../src/instance-capture.mjs';
import { fixtureFromCapture } from '../src/capture-fixture.mjs';
import { readInstanceStructure } from '../src/front-structure.mjs';

const execute = promisify(execFile);
const minimal = () => ({ version: 1, sanitized: true, rootIndex: 0, viewport: { label: 'pc', width: 1440, height: 900 },
  outerHTML: '<script>UNTRUSTED</script>', elements: [{ nodeIndex: 0, tag: 'div', parentIndex: null,
    attributes: { 'data-appid': '90002', onclick: 'UNTRUSTED', 'data-token': 'UNTRUSTED', 'data-setting-base64': 'EDITOR-PAYLOAD', 'data-storage': 'EDITOR-PAYLOAD' }, children: ['Safe label', 1] },
  { nodeIndex: 1, tag: 'script', parentIndex: 0, attributes: {}, children: ['UNTRUSTED'] }], cssRules: [] });

test('capture sanitization removes sensitive names, inline code, URL credentials and oversized attribute values', () => {
  assert.equal(sanitizeCaptureAttribute('data-access-token', 'SENSITIVE'), null);
  assert.equal(sanitizeCaptureAttribute('onclick', 'SENSITIVE'), null);
  assert.equal(sanitizeCaptureAttribute('data-long', 'x'.repeat(201)), '[omitted:attribute-over-200-chars]');
  assert.equal(sanitizeCaptureText('https://username:password@assets.invalid/style.css?token=SENSITIVE#secret'), 'https://assets.invalid/style.css');
  assert.doesNotMatch(sanitizeCaptureText('password="SENSITIVE" token=SENSITIVE Bearer SENSITIVE'), /SENSITIVE/);
});

test('fixture generation reconstructs the sanitized tree, excludes code and network requests, and fails closed on malformed input', () => {
  const result = fixtureFromCapture(minimal());
  assert.doesNotMatch(result.html, /UNTRUSTED|EDITOR-PAYLOAD|onclick|data-token|data-setting-base64|data-storage|<script/);
  assert.match(result.html, /Safe label/);
  assert.match(result.html, /script-src 'none'/);
  assert.throws(() => fixtureFromCapture({ ...minimal(), sanitized: false }), /unsanitized/);
  const cyclic = minimal(); cyclic.elements[0].children = [0];
  assert.throws(() => fixtureFromCapture(cyclic), /cycle/);
});

test('real browser capture sanitizes DOM/CDP/CSS and the fixture CLI reconstructs both viewports without external access', async () => {
  const css = '@media (min-width:1px) { #sample .content-card { display:block; width:90px; height:90px; color:#123456; } }\n'
    + '#sample .content-card:hover::before { content:"arrow"; color:#654321; --api-key:CSS-SECRET; } #outside {color:#abcdef}';
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/css' }); response.end(css); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'instance-capture-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.setContent(`<link rel="stylesheet" href="http://127.0.0.1:${server.address().port}/sheet.css?token=SHEET-SECRET">
      <div id="sample" data-appid="90002" data-id="siteblocks-setting-wrap-fixture-instance" data-token="ATTRIBUTE-SECRET" data-long="${'x'.repeat(250)}">
      <!-- COMMENT-SECRET --><script>window.privateCaptureSecret='INLINE-SCRIPT-SECRET'; document.cookie='COOKIE-SECRET';</script>
      <svg><script>SVG-SCRIPT-SECRET</script><path d="M0 0L1 1"/></svg>
      <input type="password" value="PASSWORD-SECRET"><input type="hidden" value="INPUT-SECRET"><textarea>TEXTAREA-SECRET</textarea>
      <a href="https://USER-SECRET:PASS-SECRET@assets.invalid/item?token=URL-SECRET">Item</a>
      <span class="icon" onclick="window.privateCaptureSecret='HANDLER-SECRET'" style="cursor:pointer">Open</span>
      <ul><li><span>Parent</span><ul style="display:none"><li>Child</li></ul></li></ul>
      <article class="content-card"><img data-src="/image.png?token=IMAGE-SECRET" style="width:90px;height:90px"><span>Card</span></article>
      <label><input type="checkbox">Choice</label><p>password=TEXT-SECRET</p>
      </div><div id="outside">Outside</div>`, { waitUntil: 'load' });
    await page.locator('.icon').evaluate((node) => node.addEventListener('mouseover', () => {}));
    const captureDir = path.join(temp, 'capture');
    for (const viewport of [{ label: 'pc', width: 1440, height: 900 }, { label: 'mobile', width: 375, height: 667 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const written = await captureFrontInstance({ page, rootSelector: '#sample', directory: captureDir, viewport });
      const captured = JSON.parse(await fs.readFile(written.jsonPath, 'utf8'));
      const serialized = JSON.stringify(captured);
      assert.doesNotMatch(serialized, /ATTRIBUTE-SECRET|INLINE-SCRIPT-SECRET|SVG-SCRIPT-SECRET|CSS-SECRET|COOKIE-SECRET|PASSWORD-SECRET|INPUT-SECRET|TEXTAREA-SECRET|USER-SECRET|PASS-SECRET|URL-SECRET|IMAGE-SECRET|TEXT-SECRET|HANDLER-SECRET|SHEET-SECRET|COMMENT-SECRET/);
      assert.doesNotMatch(captured.outerHTML, /<script|onclick=|type="password"/);
      assert.ok(captured.elements.every((row) => Object.values(row.attributes).every((value) => value.length <= 200)));
      assert.equal(captured.listeners.status, 'available');
      const icon = captured.elements.find((row) => row.classes.includes('icon'));
      assert.ok(icon.listeners.some((listener) => listener.type === 'mouseover'));
      assert.ok(icon.handlerTypes.includes('click'));
      assert.ok(captured.cssRules.some((rule) => rule.selector.includes('.content-card') && rule.conditions.some((condition) => /@media.*min-width:\s*1px/.test(condition))));
      assert.ok(captured.cssRules.some((rule) => rule.matchedNodes.some((node) => node.suffix.includes('::before'))));
      assert.ok(!captured.cssRules.some((rule) => rule.selector === '#outside'));
      assert.equal(captured.stylesheetEvidence.fetchFailureCount, 0);
      assert.equal(await page.locator('#sample').getAttribute('data-capture-node'), null, 'capture never marks the live instance');
    }
    const partialDir = path.join(temp, 'partial-capture');
    const partial = await captureFrontInstance({ page: { evaluate: (fn, args) => fn.name === 'readCaptureDom'
      ? page.evaluate(fn, args) : Promise.reject(new Error('stylesheet inventory is unavailable')) },
      rootSelector: '#sample', directory: partialDir, viewport: { label: 'pc', width: 1440, height: 900 } });
    assert.equal(partial.status, 'partial');
    assert.ok((await fs.readFile(partial.htmlPath, 'utf8')).includes('content-card'), 'DOM survives a stylesheet capture error');
    assert.equal(JSON.parse(await fs.readFile(partial.jsonPath, 'utf8')).captureErrors[0].code, 'capture-stylesheets-unavailable');
    const fixtureDir = path.join(temp, 'fixture');
    await execute(process.execPath, ['scripts/fixture-from-capture.mjs', captureDir, fixtureDir], { cwd: new URL('../', import.meta.url).pathname });
    assert.deepEqual((await fs.readdir(fixtureDir)).sort(), ['manifest.json', 'mobile.css', 'mobile.html', 'pc.css', 'pc.html']);
    let networkRequests = 0;
    const replay = await browser.newPage();
    await replay.route(/^https?:/, (route) => { networkRequests += 1; return route.abort(); });
    await replay.goto(pathToFileURL(path.join(fixtureDir, 'pc.html')).href);
    const structure = await replay.evaluate(readInstanceStructure, { rootSelector: '[data-appid="90002"]', imageMode: 'content', debugLimit: 3 });
    assert.equal(structure.rootCount, 1);
    assert.ok(structure.hierarchy.length > 0);
    assert.equal(await replay.locator('.content-card').evaluate((node) => getComputedStyle(node).color), 'rgb(18, 52, 86)');
    assert.equal(networkRequests, 0, 'generated fixture never requests original resources');
    assert.equal(await replay.evaluate(() => window.privateCaptureSecret), undefined, 'captured scripts never execute');
    for (const bucket of Object.values(structure.finderDebug.finders)) {
      assert.ok(bucket.decisions.length <= 3);
      assert.equal(bucket.consideredCount, bucket.acceptedCount + bucket.rejectedCount);
      assert.equal(bucket.omittedCount, bucket.consideredCount - bucket.decisions.length);
      assert.ok(bucket.decisions.every((row) => typeof row.reason === 'string' && row.path && row.tag));
    }
    assert.equal(structure.finderDebug.finders.interaction, undefined);
    assert.ok(structure.finderDebug.finders.image.reasonCounts['primary-image-not-loaded-no-intrinsic-or-attribute-size'] > 0);
    assert.equal(structure.images[0].measurementStatus, 'unavailable', 'a lazy data-src is not a loaded image');
    assert.ok(structure.finderDebug.finders['nav-leaf'].reasonCounts['hierarchy-item-not-visible'] > 0);
    assert.ok(structure.finderDebug.finders['filter-option'].reasonCounts['no-native-or-aria-option-semantics'] > 0);
    await assert.rejects(execute(process.execPath, ['scripts/fixture-from-capture.mjs', captureDir, captureDir], { cwd: new URL('../', import.meta.url).pathname }), /must not overwrite/);
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true }); }
});
