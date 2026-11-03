import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/defect-retest.mjs');
const statusFile = path.join(root, 'reports/defect-retest-status.json');

function run(args) {
  return execFileSync('node', [script, ...args], { cwd: root, encoding: 'utf8' });
}

test('defect-retest --help 输出用法说明', () => {
  const out = run(['--help']);
  assert.match(out, /list/);
  assert.match(out, /update/);
  assert.match(out, /show/);
});

test('defect-retest list 初始化并列出 #14-#23', () => {
  if (existsSync(statusFile)) rmSync(statusFile);
  const out = run(['list']);
  assert.match(out, /#14/);
  assert.match(out, /#23/);
  assert.match(out, /待复测/);
  assert.ok(existsSync(statusFile), '状态文件应已创建');
});

test('defect-retest update 更新状态', () => {
  run(['update', '14', '--status', '复测通过', '--note', '冒烟测试']);
  const out = run(['show', '14']);
  assert.match(out, /复测通过/);
  assert.match(out, /冒烟测试/);
  // 恢复为待复测，保持测试幂等
  run(['update', '14', '--status', '待复测', '--note', '']);
});

test('defect-retest 非法状态报错', () => {
  assert.throws(() => run(['update', '15', '--status', '不存在的状态']), /状态/);
});
