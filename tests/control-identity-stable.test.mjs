import test from 'node:test';
import assert from 'node:assert/strict';
import { currentValuesFromInventory } from '../src/fresh-settings-adapter.mjs';

const makeInventory = (value) => [{
  type: 'test-region',
  wrapIndex: 0,
  title: '测试区',
  controls: [{ type: 'text', label: '标题', value, index: 0 }],
}];

test('controlIdentity is stable when value changes', () => {
  const before = currentValuesFromInventory(makeInventory('旧文字'));
  const after = currentValuesFromInventory(makeInventory('新文字'));
  assert.equal(before[0].controlIdentity, after[0].controlIdentity,
    'same control with different value must keep the same identity');
  assert.equal(before[0].value, '旧文字');
  assert.equal(after[0].value, '新文字');
});

test('controlIdentity does not embed the value', () => {
  const values = currentValuesFromInventory(makeInventory('SECRET-VALUE-123'));
  assert.ok(!values[0].controlIdentity.includes('SECRET-VALUE-123'),
    'identity must not contain the mutable value');
});
