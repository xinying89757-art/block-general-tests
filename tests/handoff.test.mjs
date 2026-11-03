import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/handoff.mjs');
const reportsDir = path.join(root, 'reports');

function run(args) {
  return execFileSync('node', [script, ...args], { cwd: root, encoding: 'utf8' });
}

function cleanHandoffs() {
  for (const f of readdirSync(reportsDir)) {
    if (f.startsWith('handoff-') && f.endsWith('.md')) {
      try { rmSync(path.join(reportsDir, f)); } catch { /* ignore */ }
    }
  }
}

test('handoff --help 输出用法说明', () => {
  const out = run(['--help']);
  assert.match(out, /用法/);
  assert.match(out, /--from/);
  assert.match(out, /--to/);
});

test('handoff 缺少 --from/--to 时报错', () => {
  assert.throws(() => run(['--from', 'VM']), /--to/);
});

test('handoff 生成交接卡', () => {
  cleanHandoffs();
  const out = run(['--from', 'VM', '--to', 'Mac', '--block', '47498']);
  assert.match(out, /交接卡/);
  const files = readdirSync(reportsDir).filter((f) => f.startsWith('handoff-'));
  assert.ok(files.length > 0, '应生成交接卡文件');
  const content = readFileSync(path.join(reportsDir, files[0]), 'utf8');
  assert.match(content, /VM/);
  assert.match(content, /Mac/);
  assert.match(content, /47498/);
  // 交接卡应有双方确认栏
  assert.match(content, /确认/);
  cleanHandoffs();
});
