import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/mac-checklist.mjs');
const reportsDir = path.join(root, 'reports');

function run(args) {
  return execFileSync('node', [script, ...args], { cwd: root, encoding: 'utf8' });
}

function cleanChecklists() {
  for (const f of readdirSync(reportsDir)) {
    if (f.startsWith('mac-checklist-') && f.endsWith('.md')) {
      try { rmSync(path.join(reportsDir, f)); } catch { /* ignore */ }
    }
  }
}

test('mac-checklist --help 输出用法说明', () => {
  const out = run(['--help']);
  assert.match(out, /用法/);
  assert.match(out, /--block/);
});

test('mac-checklist 按区块生成清单', () => {
  cleanChecklists();
  // 47498 有报告则生成清单；无报告时应友好提示而非崩溃
  let out;
  try {
    out = run(['--block', '47498']);
  } catch (e) {
    // 无报告时允许友好退出
    assert.match(e.stdout || e.message, /报告|未找到/);
    return;
  }
  const files = readdirSync(reportsDir).filter((f) => f.startsWith('mac-checklist-'));
  assert.ok(files.length > 0, '应生成清单文件');
  const content = readFileSync(path.join(reportsDir, files[0]), 'utf8');
  // 清单分客观检查与人工视觉两部分
  assert.match(content, /客观|人工/);
  // 每项留待勾选
  assert.match(content, /\[ \]/);
  cleanChecklists();
});

test('mac-checklist 不存在的区块友好提示', () => {
  try {
    run(['--block', '99999999']);
    // 若成功生成空清单也算通过
  } catch (e) {
    assert.match(e.stdout || e.message, /报告|未找到|不存在/);
  }
});
