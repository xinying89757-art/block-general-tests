import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/gen-decision-pack.mjs');

function run(args) {
  return execFileSync('node', [script, ...args], { cwd: root, encoding: 'utf8' });
}

test('gen-decision-pack --help 输出用法说明', () => {
  const out = run(['--help']);
  assert.match(out, /用法/);
  assert.match(out, /--out/);
});

test('gen-decision-pack 生成决策包文件', () => {
  const outPath = '/tmp/test-decision-pack-smoke.md';
  if (existsSync(outPath)) rmSync(outPath);
  const out = run(['--out', outPath]);
  assert.match(out, /决策包/);
  assert.ok(existsSync(outPath), '决策包文件应已生成');
  const content = readFileSync(outPath, 'utf8');
  // 应包含待审核画像（47498/47368 为 draft-unreviewed）
  assert.match(content, /47498|47368/);
  // 每项应有"决定"待填栏
  assert.match(content, /决定/);
  // 不应包含凭据原文
  assert.doesNotMatch(content, /PLAYWRIGHT_PASSWORD/);
  rmSync(outPath);
});
