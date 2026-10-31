import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSelectionDiff, normalizeSiteHost, siteBaselinePath, validateSiteBaseline } from '../src/site-baseline.mjs';

test('site baseline host identity is normalized and retains a port', () => {
  assert.equal(normalizeSiteHost('HTTPS://Example.COM:8443/path'), 'example.com:8443');
  assert.match(siteBaselinePath('/repo', 'https://Example.com', '47748'), /sites\/example\.com\/47748\.baseline\.json$/);
  assert.throws(() => siteBaselinePath('/repo', 'example.com', '../40838'), /Invalid block ID/);
});

test('site baseline rejects cross-host and cross-block reuse', () => {
  const baseline = { version: 1, siteHost: 'shop.example.com', blockId: '47748', steps: [] };
  assert.throws(() => validateSiteBaseline(baseline, { siteHost: 'other.example.com', blockId: '47748' }), /host mismatch/);
  assert.throws(() => validateSiteBaseline(baseline, { siteHost: 'shop.example.com', blockId: '40838' }), /block mismatch/);
});

test('dynamic CMS list rules compare AUTOTEST selections and ignore unrelated site items', () => {
  const rule = { kind: 'fixture-selection', otherItemsPolicy: 'ignored', items: [
    { label: 'AUTOTEST-字段A', type: 'checkbox', selected: true },
    { label: 'AUTOTEST-字段B', type: 'checkbox', selected: false },
  ] };
  const controls = [
    { label: 'AUTOTEST-字段A', type: 'checkbox', checked: true },
    { label: 'AUTOTEST-字段B', type: 'checkbox', checked: false },
    { label: '后来新增的普通字段', type: 'checkbox', checked: true },
  ];
  assert.deepEqual(fixtureSelectionDiff(rule, controls), []);
  controls[0].checked = false;
  assert.equal(fixtureSelectionDiff(rule, controls)[0].reason, 'fixture-selection-mismatch');
  controls[0].checked = true;
  controls.push({ label: 'AUTOTEST-新字段', type: 'checkbox', checked: false });
  assert.equal(fixtureSelectionDiff(rule, controls).at(-1).reason, 'unexpected-fixture-item');
});
