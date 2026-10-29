import test from 'node:test';
import assert from 'node:assert/strict';
import { matchControl, withOccurrences } from '../src/baseline-identity.mjs';
import { diffAgainstBaseline } from '../src/baseline-guard.mjs';
import profile40838 from '../profiles/40838.json' with { type: 'json' };

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
  const step = profile40838.baseline.find((item) => item.title === '设置产品列表');
  for (const label of ['Brand', 'Product Code', 'Model', 'Brief', '图纸', 'Category', 'Rated Current',
    'Installation Method', 'Spacing', 'Rated voltage', '测试多选', '正式版测试多选']) {
    const items = step.want.filter((item) => item.label === label);
    assert.deepEqual(items.map((item) => item.occurrence), [0, 1]);
    assert.deepEqual(items.map((item) => item.to), [
      ['测试多选', '正式版测试多选'].includes(label) ? false : true, false,
    ]);
  }
});
