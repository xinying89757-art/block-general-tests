import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addStyleFailureReasons, resolveFrontStyleCapability, styleCheckDescriptors } from '../src/capabilities/block-style-spec.mjs';
import { buildFrontStyleExecutionErrors, sanitizeFrontStyleError, sanitizeFrontStyleUrl } from '../src/front-style-report.mjs';

const capability = { id: 'block-style-spec', styleSpec: { viewports: { pc: 1440, pad: 768, mobile: 375 }, items: [
  { id: 'button-bg', kind: 'first', selector: 'a.action', props: { backgroundColor: '#1c4587', borderRadius: 3 } },
  { id: 'details-link', kind: 'presence', selector: 'a.details', text: 'Details' },
  { id: 'product-name', kind: 'sample', selector: '.name', props: { color: '#222222' }, clamp: 2 },
] } };

test('failed style comparisons include generic locator, match count, normalized expected/actual and viewport', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-button-bg', status: 'fail', detail: 'background differs',
    evidence: { matchedCount: 1, elements: [{ backgroundColor: 'rgb(0, 0, 0)', borderRadius: 4 }] } }],
  { capability, blockId: '777', viewports: capability.styleSpec.viewports });
  assert.equal(check.status, 'fail');
  assert.deepEqual(check.reason, {
    stage: 'compare', locator: '.siteblocks-setting-wrap[data-appid="777"] → a.action',
    matchedElementCount: 1, property: ['backgroundColor', 'borderRadius'],
    expected: { backgroundColor: '#1c4587', borderRadius: 3 },
    actual: [{ backgroundColor: '#000000', borderRadius: 4 }],
    viewport: { label: 'pc', width: 1440, height: 900 },
  });
});

test('skip/na reasons identify non-applicability or missing locator without changing status', () => {
  const [missing, na] = addStyleFailureReasons([
    { id: 'bss-nav-leaf', status: 'skip', detail: 'No matching visible elements.', evidence: { matchedCount: 0 } },
    { id: 'bss-details-link', status: 'na', detail: 'This profile has no details-link requirement.' },
  ], { capability, blockId: '777' });
  assert.equal(missing.status, 'skip');
  assert.equal(missing.reason.stage, 'locate');
  assert.equal(missing.reason.matchedElementCount, 0);
  assert.equal(missing.reason.applicability, 'No matching visible elements.');
  assert.equal(na.status, 'na');
  assert.equal(na.reason.applicability, 'This profile has no details-link requirement.');
});

test('breakage checks report the root locator, viewport, and count-valued expected/actual properties', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-breakage-mobile', status: 'fail', detail: 'overflow',
    evidence: { viewportWidth: 375, docScrollWidth: 390, rootMatchedCount: 1, horizontalOverflow: true,
      stickingOut: [], overlaps: [], textClipped: [], imgDistorted: [] } }], { capability, blockId: '777' });
  assert.equal(check.reason.stage, 'compare');
  assert.match(check.reason.locator, /block subtree layout invariants/);
  assert.equal(check.reason.matchedElementCount, 1);
  assert.deepEqual(check.reason.viewport, { label: 'mobile', width: 375, height: 667 });
  assert.deepEqual(check.reason.expected, { horizontalOverflow: false, stickingOut: 0, overlaps: 0, textClipped: 0, imgDistorted: 0 });
  assert.equal(check.reason.actual.documentWidth, 390);
});

test('navigation diagnostic locators are CSS selectors with explicit hierarchy filters', () => {
  const navCapability = { styleSpec: { items: [
    { id: 'nav-parent', kind: 'nav-parent', selector: '.categories a', props: { fontWeight: 700 } },
    { id: 'nav-leaf', kind: 'nav-leaf', selector: '.categories a', props: { fontWeight: 400 } },
  ] } };
  const [parent, leaf] = addStyleFailureReasons([
    { id: 'bss-nav-parent', status: 'skip', detail: 'No visible match', evidence: { matchedCount: 0 } },
    { id: 'bss-nav-leaf', status: 'fail', detail: 'weight mismatch', evidence: { matchedCount: 1, elements: [{ fontWeight: 700 }] } },
  ], { capability: navCapability, blockId: '777' });
  assert.match(parent.reason.locator, /\.categories a \(top-level items with child list\)/);
  assert.match(leaf.reason.locator, /\.categories a \(nested list items without child list\)/);
  assert.equal(leaf.status, 'fail');
});

test('mobile overflow reason includes selectors for the offending elements', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-breakage-mobile', status: 'fail', detail: 'overflow',
    evidence: { viewportWidth: 375, docScrollWidth: 505, rootMatchedCount: 1, horizontalOverflow: true,
      stickingOut: [{ selector: '.card:nth-of-type(2) > img' }], overlaps: [], textClipped: [], imgDistorted: [] } }], { capability, blockId: '777' });
  assert.equal(check.status, 'fail');
  assert.deepEqual(check.reason.actual.offendingElementSelectors, ['.card:nth-of-type(2) > img']);
});

test('run-written style values override profile defaults and diagnostics identify the source', () => {
  const sourceCapability = { id: 'block-style-spec', styleSpec: { items: [
    { id: 'button-bg', kind: 'first', selector: 'a.action', props: { backgroundColor: '#000000' } },
    { id: 'pagination-other', kind: 'sample', selector: '.pagination a', props: { color: '#111111' } },
  ], expectedValueSources: {
    'button-bg.backgroundColor': { control: { region: 'right-rail-color', label: 'scheme' }, profileDefault: '#000000' },
    'pagination-other.color': { profileDefault: '#898989' },
  } } };
  const resolved = resolveFrontStyleCapability(sourceCapability, { block: { currentValues: [
    { region: 'right-rail-color', label: 'scheme', type: 'text', value: 'rgb(242, 242, 245)' },
  ] } });
  assert.equal(resolved.styleSpec.items[0].props.backgroundColor, '#f2f2f5');
  assert.equal(resolved.styleSpec.items[1].props.color, '#898989');
  const [dynamic, fallback] = addStyleFailureReasons([
    { id: 'bss-button-bg', status: 'fail', evidence: { matchedCount: 1, elements: [{ backgroundColor: '#fff' }] } },
    { id: 'bss-pagination-other', status: 'fail', evidence: { matchedCount: 1, elements: [{ color: '#000' }] } },
  ], { capability: resolved, blockId: '777' });
  assert.equal(dynamic.reason.expected.backgroundColor, '#f2f2f5');
  assert.match(dynamic.reason.expectedSource.backgroundColor, /^run-report:block\.currentValues\[/);
  assert.equal(fallback.reason.expected.color, '#898989');
  assert.equal(fallback.reason.expectedSource.color, 'profile-default:pagination-other.color');
});

test('ambiguous setting values fail closed to the explicit profile default', () => {
  const capability = { styleSpec: { items: [{ id: 'button-bg', props: { backgroundColor: '#111111' } }],
    expectedValueSources: { 'button-bg.backgroundColor': {
      control: { region: 'rail', label: 'color' }, profileDefault: '#222222',
    } } } };
  const resolved = resolveFrontStyleCapability(capability, { block: { currentValues: [
    { region: 'rail', label: 'color', value: '#333333' },
    { region: 'rail', label: 'color', value: '#444444' },
  ] } });
  assert.equal(resolved.styleSpec.items[0].props.backgroundColor, '#222222');
  assert.match(resolved.styleSpec.items[0].resolvedExpectedSources.backgroundColor, /ambiguous run values: 2/);
});

test('thrown style errors retain a bounded class/message while keeping the locator stage', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-button-bg', name: 'background', status: 'fail',
    detail: 'style runner stopped', errorDiagnostic: { stage: 'read', class: 'TimeoutError', message: 'selector wait failed' } }],
  { capability, blockId: '777' });
  assert.equal(check.reason.stage, 'read');
  assert.deepEqual(check.reason.error, { class: 'TimeoutError', message: 'selector wait failed' });
});

test('style check descriptors preserve profile checks and add breakage viewports without inventing checks', () => {
  assert.deepEqual(styleCheckDescriptors(capability).map(({ id }) => id), [
    'bss-button-bg', 'bss-details-link', 'bss-product-name', 'bss-product-name-clamp',
    'bss-breakage-pc', 'bss-breakage-pad', 'bss-breakage-mobile',
  ]);
});

test('inventory-derived uncertain style items are exposed as record-only checks', () => {
  const inventoryCapability = { styleSpec: { items: [], recordOnly: [
    { id: 'inventory-module-width', name: 'Module width inventory', inventoryCapability: 'module-width' },
  ] } };
  assert.deepEqual(styleCheckDescriptors(inventoryCapability).map(({ id }) => id), [
    'bss-inventory-module-width', 'bss-breakage-pc', 'bss-breakage-pad', 'bss-breakage-mobile',
  ]);
});

test('the onboarding profile exposes every discovered setting group as record-only style inventory', () => {
  const profile = JSON.parse(fs.readFileSync(new URL('../profiles/47498.json', import.meta.url), 'utf8'));
  const style = profile.capabilities.find((entry) => entry.id === 'block-style-spec')?.styleSpec;
  assert.ok(style);
  assert.deepEqual(style.recordOnly.map((entry) => entry.inventoryCapability), profile.onboarding.matched.map((entry) => entry.capability));
  assert.ok(style.recordOnly.every((entry) => /No front-end selector/.test(entry.note)));
});

test('profile button style shares the CSS target without requiring stale button copy', () => {
  const profile = JSON.parse(fs.readFileSync(new URL('../profiles/47748.json', import.meta.url), 'utf8'));
  const items = profile.capabilities.find((entry) => entry.id === 'block-style-spec').styleSpec.items;
  const text = items.find((entry) => entry.id === 'button-text');
  const background = items.find((entry) => entry.id === 'button-bg');
  assert.equal(text.kind, 'first');
  assert.equal(text.selector, background.selector);
  assert.equal(text.text, undefined);
  assert.deepEqual(text.props, { color: '#ffffff', fontSize: 18, fontWeight: 700 });
});

test('front-style setup errors create per-check error reasons without changing assertion verdicts or leaking secrets', () => {
  const error = Object.assign(new Error('request failed https://user:pass@example.test/p?q=secret token=abc'), { name: 'TimeoutError' });
  const [check] = buildFrontStyleExecutionErrors({ capability, blockId: '777', stage: 'locate-block', error });
  assert.equal(check.status, 'error');
  assert.equal(check.reason.stage, 'locate');
  assert.equal(check.reason.matchedElementCount, null);
  assert.equal(check.reason.error.class, 'TimeoutError');
  assert.doesNotMatch(JSON.stringify(check.reason), /user|pass|secret|abc|https?:/);
  assert.equal(sanitizeFrontStyleUrl('https://u:p@example.test/a?t=4&token=x#hash'), 'https://example.test/a?t=4');
  assert.equal(sanitizeFrontStyleError(error).message.includes('token=[redacted]'), true);
});
