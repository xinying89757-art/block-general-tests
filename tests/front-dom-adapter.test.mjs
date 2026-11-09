import test from 'node:test';
import assert from 'node:assert/strict';
import { productSnapshot, DEFAULT_FRONT_SELECTORS } from '../src/capabilities/effect-checks.mjs';
// Note: custom-filter-fields.mjs cannot be imported in isolation right now
// (pre-existing broken re-export chain via fresh-settings-adapter.mjs ->
// design-spec-checklist.mjs). Its FILTER_FRONT_SELECTORS /
// resolveFilterFrontSelectors are verified by code review; the runtime
// behavior is covered by productSnapshot tests below.

// Mock getComputedStyle globally (productSnapshot uses the bare global).
const origGetComputedStyle = globalThis.getComputedStyle;
globalThis.getComputedStyle = () => ({ visibility: 'visible' });
test.after(() => { globalThis.getComputedStyle = origGetComputedStyle; });

const visibleNode = (innerText = '') => ({
  innerText,
  getClientRects: () => [{ width: 10, height: 10 }],
});
const makeRoot = ({ names = [], hasList = false } = {}) => {
  const nameNodes = names.map(visibleNode);
  return {
    querySelectorAll: (sel) => {
      if (sel === '.prodlist-pro-name' || sel === '.prodlist-pro-name, .pf-name-text' || sel === '.custom-name') return nameNodes;
      return [];
    },
    querySelector: (sel) => {
      if (sel.includes('.prodlist-pro-name')) return nameNodes[0] || null;
      if (sel.includes('one-pruduct-list') && hasList) return visibleNode();
      if (sel === '.custom-name' && nameNodes.length) return nameNodes[0];
      return null;
    },
  };
};

test('productSnapshot finds names with default selector', () => {
  const snap = productSnapshot(makeRoot({ names: ['产品A', '产品B'], hasList: true }));
  assert.deepEqual(snap.names, ['产品A', '产品B']);
  assert.equal(snap.hasList, true);
  assert.equal(snap.adapted, true);
});

test('productSnapshot reports unadapted when structure unknown', () => {
  // Root has no matching names and no list container → unknown structure.
  const snap = productSnapshot(makeRoot({ names: [], hasList: false }));
  assert.deepEqual(snap.names, []);
  assert.equal(snap.adapted, false);
});

test('productSnapshot accepts custom selectors (profile override)', () => {
  const snap = productSnapshot(makeRoot({ names: ['X'] }), { productName: '.custom-name' });
  assert.deepEqual(snap.names, ['X']);
  assert.equal(snap.selectorUsed, '.custom-name');
  assert.equal(snap.adapted, true);
});

test('productSnapshot reads pf-name-text when prodlist-pro-name is absent', () => {
  const nameNodes = [visibleNode('AUTOTEST-A'), visibleNode('AUTOTEST-B')];
  const root = {
    querySelectorAll: (sel) => (String(sel).includes('.pf-name-text') ? nameNodes : []),
    querySelector: (sel) => (String(sel).includes('.pf-list-wrap') ? visibleNode() : null),
  };
  const snap = productSnapshot(root);
  assert.deepEqual(snap.names, ['AUTOTEST-A', 'AUTOTEST-B']);
  assert.equal(snap.adapted, true);
});

test('DEFAULT_FRONT_SELECTORS documents the known variants', () => {
  assert.equal(DEFAULT_FRONT_SELECTORS.productName, '.prodlist-pro-name, .pf-name-text');
  assert.ok(DEFAULT_FRONT_SELECTORS.list.includes('.pf-list-wrap'));
});
