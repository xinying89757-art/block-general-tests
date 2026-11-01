import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { checkDesignRequirementFront, validateDesignSpec } from '../src/design-spec-checklist.mjs';
import { inferSpecState } from '../src/spec-target-state.mjs';
import { importExtractedDesignSpec } from '../scripts/import-design-spec.mjs';

const requirement = (overrides = {}) => ({ id: 'named-button', checkType: 'color-scope', sourceText: '按钮悬停背景',
  expected: { value: '#123abc' }, checkStage: 'front', params: { selector: '.named', property: 'backgroundColor' },
  state: { kind: 'hover', target: 'scope' }, ...overrides });
const spec = (item) => ({ source: { fileKey: 'fixture', nodeId: '1:1' }, overrides: [], requirements: [item] });

test('checklist state schema rejects unknown/ambiguous declarations and importer maps spec words', () => {
  for (const [text, kind] of [['悬停颜色', 'hover'], ['鼠标经过按钮', 'hover'], ['聚焦', 'focus'], ['选中颜色', 'selected'], ['当前页', 'active'], ['展开节点', 'expanded']]) {
    assert.deepEqual(inferSpecState(text), { kind, target: 'scope' });
  }
  assert.equal(inferSpecState('普通按钮'), undefined);
  assert.equal(inferSpecState('悬停和选中'), undefined);
  assert.deepEqual(validateDesignSpec(spec(requirement())), []);
  for (const state of [{ kind: 'click-all', target: 'scope' }, { kind: 'hover' }, { kind: 'hover', target: 'scope', timeoutMs: 0 }, { kind: 'hover', target: 'scope', extra: 1 }]) {
    assert.ok(validateDesignSpec(spec(requirement({ state }))).length);
  }
  assert.ok(validateDesignSpec(spec(requirement({ checkType: 'image-ratio' }))).length);
  const profile = importExtractedDesignSpec({}, { file: 'fixture', colors: [{ name: '按钮', default: '#123abc', scopeText: ['鼠标经过按钮'], sourceNodeId: '1:1' }],
    typography: [{ element: '当前分页', fontSize: '14px', sourceNodeId: '1:1' }] });
  assert.equal(profile.designSpec.requirements[1].state.kind, 'hover');
  assert.equal(profile.designSpec.requirements[2].state.kind, 'active');
  assert.deepEqual(validateDesignSpec(profile.designSpec), []);
});

async function fixture(work) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
    await page.setContent(`<style>.named{background:#111;color:#222;font-size:12px}.named:hover{background:#123abc}.named:focus{font-size:18px}.named:active{background:#ff0000}
      .exp[aria-expanded=true]{background:#123abc}.selected[aria-pressed=true]{background:#123abc}</style>
      <input id="prior"><div id="instance"><button type="button" class="named">Named button</button><button type="button" class="other">Untouched</button>
      <button type="button" class="exp" aria-expanded="false" onclick="this.setAttribute('aria-expanded',this.getAttribute('aria-expanded')==='true'?'false':'true')">Expand</button>
      <button type="button" class="selected" aria-pressed="false" onclick="this.setAttribute('aria-pressed',this.getAttribute('aria-pressed')==='true'?'false':'true')">Select</button>
      <a class="unsafe" href="https://invalid.test" aria-expanded="false">Unsafe</a></div>
      <script>window.otherActions=0;document.querySelector('.other').onmouseover=()=>window.otherActions++;</script>`);
    await page.mouse.move(590, 490);
    await work(page);
  } finally { await browser.close(); }
}

test('named hover scope compares live colors (pass and fail), restores, and ignores stale observations', async () => fixture(async (page) => {
  const options = { page, rootSelector: '#instance', profile: {}, frontChecks: [{ id: 'bss-stale', status: 'fail', actual: [{ backgroundColor: '#000000' }] }] };
  const pass = await checkDesignRequirementFront(requirement(), options);
  assert.equal(pass.status, 'pass', JSON.stringify(pass));
  assert.equal(pass.actual.backgroundColor, 'rgb(18, 58, 188)');
  assert.equal(pass.reason.state.restored, true);
  const fail = await checkDesignRequirementFront(requirement({ expected: { value: '#ffffff' } }), options);
  assert.equal(fail.status, 'fail');
  assert.equal(fail.reason.code, 'spec-state-color-mismatch');
  assert.equal(await page.locator('.named').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(17, 17, 17)');
  assert.equal(await page.evaluate(() => window.otherActions), 0);
  const written = await checkDesignRequirementFront(requirement({ params: { selector: '.named', property: 'backgroundColor', styleCheckId: 'button' } }), {
    ...options, settingsReport: { checks: [{ id: 'bss-button', status: 'pass', setting: 'palette', value: '#123abc', expected: '#ffffff' }], block: {
      currentValues: [{ section: '区块配色', value: '#123abc' }] } } });
  assert.equal(written.status, 'pass');
}));

test('no state field performs no interaction, even when the expected scope would respond to hover', async () => {
  const page = new Proxy({}, { get: () => { throw new Error('no interaction or live observation needed'); } });
  const item = requirement(); delete item.state;
  const row = await checkDesignRequirementFront(item, { page, rootSelector: '#instance', profile: {}, frontChecks: [] });
  assert.equal(row.status, 'na');
  assert.equal(row.reason.code, 'scope-unmapped');
});

test('focus/selected/expanded/active act on one target and restore; ambiguous/unsafe targets fail closed', async () => fixture(async (page) => {
  await page.locator('#prior').focus();
  const focus = await checkDesignRequirementFront(requirement({ checkType: 'typography', expected: { fontSize: '18px' }, state: { kind: 'focus', target: 'scope' } }), {
    page, rootSelector: '#instance', profile: {} });
  assert.equal(focus.status, 'pass', JSON.stringify(focus));
  assert.equal(await page.locator('#prior').evaluate((node) => node === document.activeElement), true);
  for (const [kind, selector] of [['selected', '.selected'], ['expanded', '.exp']]) {
    const row = await checkDesignRequirementFront(requirement({ params: { selector, property: 'backgroundColor' }, state: { kind, target: 'scope' } }), {
      page, rootSelector: '#instance', profile: {} });
    assert.equal(row.status, 'pass', JSON.stringify(row));
    assert.equal(row.reason.state.restored, true);
  }
  const active = await checkDesignRequirementFront(requirement({ expected: { value: '#ff0000' }, state: { kind: 'active', target: 'scope' } }), {
    page, rootSelector: '#instance', profile: {} });
  assert.equal(active.status, 'pass', JSON.stringify(active));
  for (const [selector, code] of [['button', 'spec-state-target-ambiguous'], ['.unsafe', 'spec-state-unsafe-activation'], ['.missing', 'spec-state-target-unresolved']]) {
    const row = await checkDesignRequirementFront(requirement({ params: { selector, property: 'backgroundColor' }, state: { kind: 'expanded', target: 'scope', timeoutMs: 100 } }), { page, rootSelector: '#instance' });
    assert.equal(row.status, 'fail'); assert.equal(row.reason.code, code, JSON.stringify(row));
  }
}));

test('a targeted action timeout is bounded, restores in finally, and returns a string reason', async () => {
  let restored = false;
  const handle = { evaluate: async () => false, dispose: async () => {} };
  const target = { count: async () => 1, isVisible: async () => true, scrollIntoViewIfNeeded: async () => {}, hover: () => new Promise(() => {}) };
  const page = { locator: () => ({ count: async () => 1, locator: () => target }), evaluateHandle: async () => handle,
    evaluate: async () => ({ x: 0, y: 0 }), mouse: { move: async () => { restored = true; } } };
  const row = await checkDesignRequirementFront(requirement({ state: { kind: 'hover', target: 'scope', timeoutMs: 100 } }), { page, rootSelector: '#instance' });
  assert.equal(row.status, 'fail'); assert.equal(row.reason.code, 'spec-state-timeout'); assert.equal(restored, true);
  assert.equal(row.reason.state.restored, true);
});

test('state targets reuse profile-owned scope mappings and report failed restoration', async () => fixture(async (page) => {
  const profile = { capabilities: [{ id: 'block-style-spec', styleSpec: { items: [
    { id: 'named-function', selectorCandidates: ['.absent', '.named'], props: { backgroundColor: '#123abc', fontSize: 12 } },
  ] } }] };
  const row = await checkDesignRequirementFront(requirement({ params: { styleCheckId: 'named-function' } }), { page, rootSelector: '#instance', profile });
  assert.equal(row.status, 'pass', JSON.stringify(row));
  await page.locator('.exp').evaluate((node) => { node.onclick = () => node.setAttribute('aria-expanded', 'true'); });
  const failedRestore = await checkDesignRequirementFront(requirement({ params: { selector: '.exp', property: 'backgroundColor' },
    state: { kind: 'expanded', target: 'scope' } }), { page, rootSelector: '#instance' });
  assert.equal(failedRestore.status, 'fail');
  assert.equal(failedRestore.reason.code, 'spec-state-restore-failed');
  assert.equal(failedRestore.reason.state.restored, false);
}));
