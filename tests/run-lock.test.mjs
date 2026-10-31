import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
