import test from 'node:test';
import assert from 'node:assert/strict';
import { matchControl, withOccurrences } from '../src/baseline-identity.mjs';
import { siteDataFor } from './helpers/profile.mjs';

test('legacy select-all label matches its current dynamic label', () => {
  const controls = [{ type: 'checkbox', label: '全选 新字段', value: 'on' }];
  assert.equal(matchControl(controls, { type: 'checkbox', label: '全选 旧字段' }), controls[0]);
});
import { diffAgainstBaseline } from '../src/baseline-guard.mjs';

const serialize = (control) => ({ label: control.label, type: control.type, value: control.value, to: control.checked });
const repeated = (to0, to1) => [{ title: '设置产品列表', type: 'gallery', wrapIndex: 0, want: [
  { label: 'Brand', type: 'checkbox', value: '-3', occurrence: 0, to: to0 },
  { label: 'Brand', type: 'checkbox', value: '-3', occurrence: 1, to: to1 },
] }];

test('capture assigns DOM-order occurrence only to repeated identities', () => {
  const items = withOccurrences([
    { label: 'Brand', type: 'checkbox', value: '-3', checked: true },
    { label: 'Brand', type: 'checkbox', value: '-3', checked: false },
    { label: 'Other', type: 'checkbox', value: 'x', checked: true },
  ], serialize);
  assert.deepEqual(items.map(({ occurrence }) => occurrence), [0, 1, undefined]);
});

test('select-all identity ignores concatenated field labels but still compares its value by occurrence', () => {
  const captured = withOccurrences([
    { label: '全选 Category Rated Current', type: 'checkbox', value: 'all', checked: false },
    { label: '全选 Brand Product Code', type: 'checkbox', value: 'all', checked: false },
  ], serialize);
  assert.deepEqual(captured.map(({ label, identity, occurrence }) => [label, identity, occurrence]), [
    ['全选', 'select-all', 0], ['全选', 'select-all', 1],
  ]);
  const baseline = [{ type: 'gallery', want: captured.map((item) => ({ ...item, to: false })) }];
  const current = [{ type: 'gallery', want: withOccurrences([
    { label: '全选 Category Rated Current Installation Method', type: 'checkbox', value: 'all', checked: false },
    { label: '全选 Brand Product Code Model Brief', type: 'checkbox', value: 'all', checked: true },
  ], serialize) }];
  assert.deepEqual(diffAgainstBaseline(baseline, current).map(({ label, occurrence, reason }) => [label, occurrence, reason]), [
    ['全选', 1, 'value-mismatch'],
  ]);
});

test('occurrence selects the matching nth control; legacy duplicate identity throws', () => {
  const controls = [{ label: 'Brand', type: 'checkbox', value: '-3', marker: 0 },
    { label: 'Brand', type: 'checkbox', value: '-3', marker: 1 }];
  assert.equal(matchControl(controls, { label: 'Brand', type: 'checkbox', value: '-3', occurrence: 1 }).marker, 1);
  assert.throws(() => matchControl(controls, { label: 'Brand', type: 'checkbox', value: '-3' }), /请补 occurrence/);
});

test('baseline diff compares repeated controls independently by occurrence', () => {
  assert.deepEqual(diffAgainstBaseline(repeated(true, false), repeated(true, false)), []);
  const diffs = diffAgainstBaseline(repeated(true, false), repeated(false, true));
  assert.deepEqual(diffs.map(({ occurrence, reason }) => [occurrence, reason]), [
    [0, 'value-mismatch'], [1, 'value-mismatch'],
  ]);
});

test('legacy baseline is rejected when current DOM has duplicate candidates', () => {
  const baseline = [{ type: 'gallery', want: [{ label: 'Brand', type: 'checkbox', value: '-3', to: true }] }];
  const current = [{ type: 'gallery', want: [
    { label: 'Brand', type: 'checkbox', value: '-3', occurrence: 0, to: true },
    { label: 'Brand', type: 'checkbox', value: '-3', occurrence: 1, to: false },
  ] }];
  assert.throws(() => diffAgainstBaseline(baseline, current), /请补 occurrence/);
});

test('40838 product list baseline distinguishes its two display-control groups', () => {
  const step = siteDataFor('40838').steps.find((item) => item.title === '设置产品列表');
  assert.equal(step.fixtureSelection.otherItemsPolicy, 'ignored');
  assert.ok(step.fixtureSelection.items.some((item) => item.label === 'AUTOTEST-单选按钮A'));
  assert.ok(step.fixtureSelection.items.some((item) => item.label === 'AUTOTEST-下拉列表'));
  assert.equal(step.want.some((item) => ['Brand', 'Product Code', 'Category', 'Rated Current'].includes(item.label)), false);
});
