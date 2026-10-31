import test from 'node:test';
import assert from 'node:assert/strict';
import { addStyleFailureReasons, styleCheckDescriptors } from '../src/capabilities/block-style-spec.mjs';
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
