import test from 'node:test';
import assert from 'node:assert/strict';
import { currentValuesFromInventory, projectPersistedFreshValues } from '../src/fresh-settings-adapter.mjs';

// Simulates a block with two buttons (e.g. 47368's "Back to Product Menu" and
// "Product Selector"). Each button region has wrapIndex 0 and 1 respectively,
// with identical region/type/controlIndex — only wrapIndex distinguishes them.
function dualButtonInventory() {
  const buttonControls = (label) => [
    { label: '按钮文本', type: 'text', value: label, index: 0 },
    { label: '链接网址', type: 'text', value: 'https://www.baidu.com', index: 1 },
    { label: '新窗口打开', type: 'checkbox', checked: false, index: 2 },
  ];
  return [
    { type: 'phoenix_blocks_button', wrapIndex: 0, title: null, kind: 'button-popover',
      controls: buttonControls('按钮A') },
    { type: 'phoenix_blocks_button', wrapIndex: 1, title: null, kind: 'button-popover',
      controls: buttonControls('按钮B') },
  ];
}

function dualButtonPersistedControls() {
  // Mirrors the refs produced by button-link.mjs createFreshDefinitions
  // (now carrying wrapIndex).
  const refs = [];
  for (const wrapIndex of [0, 1]) {
    refs.push(
      { region: 'button-popover', wrapIndex, controlIndex: 0, type: 'text' },
      { region: 'button-popover', wrapIndex, controlIndex: 1, type: 'text' },
      { region: 'button-popover', wrapIndex, controlIndex: 2, type: 'checkbox' },
    );
  }
  return refs;
}

test('currentValuesFromInventory carries wrapIndex on flattened values', () => {
  const values = currentValuesFromInventory(dualButtonInventory());
  assert.equal(values.length, 6);
  const byWrap = new Map();
  for (const value of values) {
    assert.ok(Number.isInteger(value.wrapIndex), 'wrapIndex must be present');
    const key = `${value.wrapIndex}/${value.controlIndex}`;
    assert.ok(!byWrap.has(key), `duplicate flattened value for ${key}`);
    byWrap.set(key, value);
  }
  // Button A's text vs button B's text must be distinguishable.
  assert.equal(byWrap.get('0/0').value, '按钮A');
  assert.equal(byWrap.get('1/0').value, '按钮B');
});

test('projectPersistedFreshValues resolves dual-button controls without ambiguity', () => {
  const values = currentValuesFromInventory(dualButtonInventory());
  const persistedControls = dualButtonPersistedControls();
  const projected = projectPersistedFreshValues(values, persistedControls);
  assert.equal(projected.length, 6);
  // Each projected value must come from the matching wrapIndex region.
  const texts = projected.filter((item) => item.controlIndex === 0 && item.type === 'text');
  assert.equal(texts.length, 2);
  const byWrap = new Map(texts.map((item) => [item.wrapIndex, item.value]));
  assert.equal(byWrap.get(0), '按钮A');
  assert.equal(byWrap.get(1), '按钮B');
});

test('projectPersistedFreshValues still works when wrapIndex is absent (backward compat)', () => {
  const inventory = [{
    type: 'phoenix_blocks_button', title: null, kind: 'button-popover',
    controls: [{ label: '按钮文本', type: 'text', value: '单个按钮', index: 0 }],
  }];
  const values = currentValuesFromInventory(inventory);
  assert.equal(values[0].wrapIndex, 0);
  const projected = projectPersistedFreshValues(values, [
    { region: 'button-popover', controlIndex: 0, type: 'text' },
  ]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].value, '单个按钮');
});

test('projectPersistedFreshValues rejects cross-wrapIndex mismatch', () => {
  const values = currentValuesFromInventory(dualButtonInventory());
  // Ask for wrapIndex 2 which does not exist — must fail closed, not silently
  // match the wrong button.
  assert.throws(() => projectPersistedFreshValues(values, [
    { region: 'button-popover', wrapIndex: 2, controlIndex: 0, type: 'text' },
  ]), /resolved 0 inventory controls/);
});
