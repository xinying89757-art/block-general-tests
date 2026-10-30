import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineControlsReady, baselineRestoreTarget, diffAgainstBaseline } from '../src/baseline-guard.mjs';

const step = (want) => [{ title: '设置', type: 'widget', wrapIndex: 0, want }];
const item = (label, to, type = 'text') => ({ label, type, to });

test('baseline diff is empty when values match', () => {
  const baseline = step([item('标题', '默认')]);
  assert.deepEqual(diffAgainstBaseline(baseline, step([item('标题', '默认')])), []);
});

test('baseline readiness waits for every recorded control identity', () => {
  const wants = [item('标题', '默认'), { label: '启用', type: 'checkbox', value: 'on', to: true }];
  assert.equal(baselineControlsReady([{ label: '标题', type: 'text', value: '默认' }], wants), false);
  assert.equal(baselineControlsReady([
    { label: '标题', type: 'text', value: '默认' },
    { label: '启用', type: 'checkbox', value: 'on', checked: true },
  ], wants), true);
});

test('baseline diff reports changed values', () => {
  const diffs = diffAgainstBaseline(step([item('标题', '默认')]), step([item('标题', '更改')]));
  assert.deepEqual(diffs.map(({ label, expected, actual, reason }) => ({ label, expected, actual, reason })), [
    { label: '标题', expected: '默认', actual: '更改', reason: 'value-mismatch' },
  ]);
});

test('AUTOTEST prefix is residue, including a control absent from baseline', () => {
  const current = step([item('标题', '默认'), item('额外控件', 'autotest-leftover')]);
  const diffs = diffAgainstBaseline(step([item('标题', '默认')]), current);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].reason, 'autotest-prefix');
  assert.equal(diffs[0].label, '额外控件');
});

test('AUTOTEST value in baseline is a profile error', () => {
  assert.throws(() => diffAgainstBaseline(step([item('标题', 'AUTOTEST-BTN')]), step([])), /画像基线错误/);
});

test('button-popover values are diffed by semantic labels', () => {
  const baseline = [{ title: null, type: 'phoenix_blocks_button', wrapIndex: 0, kind: 'button-popover', want: [
    item('按钮文本', '正常'), item('链接网址', 'javascript:void(0)'), item('新窗口打开', false, 'checkbox'),
  ] }];
  const current = structuredClone(baseline);
  current[0].want[0].to = 'AUTOTEST-BTN';
  const diffs = diffAgainstBaseline(baseline, current);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].reason, 'autotest-prefix');
  assert.equal(diffs[0].type, 'phoenix_blocks_button');
});

test('restore target prefers baseline, then snapshot, and replaces AUTOTEST snapshot with default', () => {
  assert.deepEqual(baselineRestoreTarget({ snapshot: 'old', baselineValue: 'profile' }), { value: 'profile', source: 'baseline' });
  assert.deepEqual(baselineRestoreTarget({ snapshot: 'old' }), { value: 'old', source: 'snapshot' });
  assert.deepEqual(baselineRestoreTarget({ snapshot: 'AUTOTEST-BTN', defaultValue: 'default' }), { value: 'default', source: 'default-after-autotest-snapshot' });
});
