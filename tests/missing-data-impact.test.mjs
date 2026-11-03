import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySkips, main } from '../scripts/missing-data-impact.mjs';

test('四类缺数据按固定顺序分组，计数和建议动作准确', () => {
  const checks = [
    { id: 'fixture', status: 'skip', detail: '夹具准备失败。' },
    { id: 'table', status: 'skip', detail: '夹具真值表须包含完整字段值。' },
    { id: 'products', status: 'na', detail: '缺少已准备的至少两个 AUTOTEST 产品。' },
    { id: 'fields-a', status: 'skip', detail: '没有可切换的自定义字段。' },
    { id: 'fields-b', status: 'skip', detail: '当前没有可以改写的 AUTOTEST 字段。' },
  ];
  const original = structuredClone(checks);
  const groups = classifySkips(checks);
  assert.deepEqual(groups.map(({ label, count, action }) => ({ label, count, action })), [
    { label: '缺：AUTOTEST 自定义字段', count: 2, action: '建 1 个 AUTOTEST 自定义字段' },
    { label: '缺：AUTOTEST 产品（至少 2 个）', count: 1, action: '建 2 个 AUTOTEST 产品' },
    { label: '缺：夹具真值表数据', count: 1, action: '补夹具真值表数据' },
    { label: '缺：夹具准备（需排查）', count: 1, action: '排查夹具准备失败原因（先修再补数据）' },
  ]);
  assert.deepEqual(groups[0].checks, [
    { id: 'fields-a', detail: '没有可切换的自定义字段。' },
    { id: 'fields-b', detail: '当前没有可以改写的 AUTOTEST 字段。' },
  ]);
  assert.deepEqual(checks, original, '分组不能修改原始报告');
});

test('明确不存在的功能优先排除，skip 和 na 均不计数', () => {
  const details = ['本区块没有背景颜色设置项。', '该区块没有此选项组。', '无此设置项。',
    '没有此选项组。', '没有该选项组。', '不支持此功能，夹具准备失败。'];
  assert.deepEqual(classifySkips(details.flatMap((detail) => [
    { status: 'na', detail }, { status: 'skip', detail },
  ])), []);
});

test('其他 skip/na 归入末尾兜底组，只计数且无建议动作', () => {
  const groups = classifySkips([
    { id: 'other-a', status: 'skip', detail: '需求未提供。' },
    { id: 'other-b', status: 'na', detail: '能力尚未适配。' },
    { id: 'field', status: 'skip', detail: '没有可切换的自定义字段。' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].label, '其他 skip（非数据原因）');
  assert.equal(groups[1].count, 2);
  assert.equal(groups[1].action, undefined);
  assert.deepEqual(groups[1].checks.map(({ id }) => id), ['other-a', 'other-b']);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 3);
});

test('detail 为空时回退 description，非空时只匹配 detail', () => {
  const groups = classifySkips([
    { id: 'empty', status: 'skip', detail: '', description: '没有可切换的自定义字段。' },
    { id: 'missing', status: 'na', description: '夹具真值表不完整。' },
    { id: 'blank', status: 'skip', detail: '  ', description: '夹具准备失败。' },
    { id: 'detail-first', status: 'skip', detail: '需求未提供。', description: '夹具准备失败。' },
  ]);
  assert.deepEqual(groups.map(({ checks }) => checks[0].id), ['empty', 'missing', 'blank', 'detail-first']);
  assert.equal(groups[0].checks[0].detail, '没有可切换的自定义字段。');
});

test('多种原因只归入第一命中的组', () => {
  const groups = classifySkips([
    { id: 'first', status: 'skip', detail: '夹具准备失败；夹具真值表不全；没有可切换的自定义字段。' },
    { id: 'second', status: 'skip', detail: '夹具真值表缺少已准备的至少两个 AUTOTEST 产品。' },
    { id: 'third', status: 'skip', detail: '夹具准备失败：夹具真值表不完整。' },
  ]);
  assert.deepEqual(groups.map(({ count }) => count), [1, 1, 1]);
  assert.deepEqual(groups.map(({ checks }) => checks[0].id), ['first', 'second', 'third']);
});

test('不分析 pass/fail/record，无待分析项时返回空数组', () => {
  assert.deepEqual(classifySkips([]), []);
  assert.deepEqual(classifySkips(['pass', 'fail', 'record', 'deferred'].map((status) => ({
    id: status, status, detail: '夹具准备失败。',
  }))), []);
});

test('missing-data-impact --help 输出用法，不依赖真实报告', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  await main(['--help']);
  assert.equal(log.mock.callCount(), 1);
  const output = log.mock.calls[0].arguments[0];
  assert.match(output, /用法/);
  for (const option of ['--help', '--report', '--block', '--out']) assert.ok(output.includes(option));
});
