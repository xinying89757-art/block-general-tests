import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryRestoreChanges } from '../src/capabilities/effect-checks.mjs';
import { categorySelectionChanges, selectedCheckGroupLayer } from '../src/capabilities/product-category-select.mjs';
import { planCheckboxBatch } from '../src/capabilities/shared.mjs';

const box = (index, label, checked) => ({ index, tag: 'INPUT', type: 'checkbox', name: 'leafProdGroup',
  label, context: label, value: 'on', checked, disabled: false, readOnly: false });

test('category backend selection group selects exactly the named item across the full list', () => {
  const controls = Array.from({ length: 109 }, (_, index) => box(index, `分类-${index}`, true));
  controls.push({ index: 109, tag: 'INPUT', type: 'radio', name: 'selectGroupWay', label: '选择所有产品分类',
    context: '', value: 'all', checked: true, disabled: false });
  const changes = categorySelectionChanges(controls, '分类-73');
  assert.equal(changes.length, 109);
  assert.equal(changes.filter(({ value }) => value).length, 1);
  assert.equal(changes.find(({ target }) => target.label === '分类-73').value, true);
});

test('category group restore plan replays each original checkbox value by control identity', () => {
  const original = [box(0, '分类甲', true), box(1, '分类乙', false), box(2, '分类丙', true)];
  const current = original.map((item) => ({ ...item, checked: false }));
  const restores = categoryRestoreChanges(current, original);
  assert.deepEqual(restores.map(({ target, value }) => [target.label, value]), [
    ['分类甲', true], ['分类乙', false], ['分类丙', true],
  ]);
  assert.throws(() => categoryRestoreChanges(current.slice(0, 2), original), /身份变化/);
});

test('batch rejects an uneditable change but permits an already-correct disabled checkbox', () => {
  const locked = { ...box(0, '锁定分类', true), disabled: true };
  assert.deepEqual(planCheckboxBatch([locked], [{ target: locked, value: true }]), []);
  assert.throws(() => planCheckboxBatch([locked], [{ target: locked, value: false }]), /锁定分类.*不可编辑/);
  assert.throws(() => planCheckboxBatch([], [{ target: locked, value: false }]), /身份变化或缺失/);
});

test('product category groups isolate persistence from category backend effects', () => {
  assert.deepEqual(selectedCheckGroupLayer('pcs-persistence'), ['settings']);
  assert.deepEqual(selectedCheckGroupLayer('pcs-categories-backend'), ['backend']);
  assert.equal(selectedCheckGroupLayer('unknown'), null);
});
