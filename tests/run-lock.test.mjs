import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { otherRunnerProcesses } from '../src/run-lock.mjs';

test('detects another live runner process even without a lock file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'proc-'));
  const add = (pid, argv) => { mkdirSync(path.join(root, String(pid))); writeFileSync(path.join(root, String(pid), 'cmdline'), argv.join('\0') + '\0'); };
  add(10, ['node', 'src/run.mjs']);
  add(11, ['/usr/bin/node', '/workspace/x/scripts/check-baseline.mjs', '40838']);
  add(12, ['node', 'scripts/validate-profiles.mjs']);
  add(13, ['bash', 'src/run.mjs']);
  add(99, ['node', 'src/run.mjs']);
  assert.deepEqual(otherRunnerProcesses(root, 99, 1).map(p => p.pid).sort(), [10, 11]);
});

test('detects fresh and onboarding runners by relative and absolute script paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'proc-fresh-'));
  try {
    const scripts = ['scripts/fresh-block.mjs', '/workspace/x/scripts/fresh-block.mjs',
      'scripts/onboard-block.mjs', '/workspace/x/scripts/onboard-block.mjs'];
    for (const [index, script] of scripts.entries()) {
      mkdirSync(path.join(root, String(index + 10)));
      writeFileSync(path.join(root, String(index + 10), 'cmdline'), ['node', script, '--page-kind', 'custom'].join('\0') + '\0');
    }
    assert.deepEqual(otherRunnerProcesses(root, 99, 1).map(({ script }) => script).sort(), scripts.sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
