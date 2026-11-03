import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNoCancelledTests, parseTapSummary } from '../src/test-summary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// Async spawn with real-time output forwarding (no more spawnSync full-buffer
// "hang"), a total timeout, and child cleanup on timeout/failure.
const TOTAL_TIMEOUT_MS = Number(process.env.TEST_TOTAL_TIMEOUT_MS || 10 * 60 * 1000);
const MAX_BUFFER = 16 * 1024 * 1024;

const child = spawn(process.execPath, ['--test', '--test-reporter=tap', 'tests/*.test.mjs'], {
  cwd: root, env: process.env,
});

let stdout = '';
let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  console.error(`\n[run-tests] TIMEOUT after ${TOTAL_TIMEOUT_MS}ms — killing child`);
  child.kill('SIGTERM');
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
}, TOTAL_TIMEOUT_MS);
timer.unref();

child.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  process.stdout.write(text);
  if (stdout.length < MAX_BUFFER) stdout += text;
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

const exitCode = await new Promise((resolve) => {
  child.on('error', (err) => {
    console.error('[run-tests] spawn error:', err.message);
    resolve(1);
  });
  child.on('close', (code, signal) => {
    if (signal) console.error(`[run-tests] child killed by ${signal}`);
    resolve(code ?? 1);
  });
});

clearTimeout(timer);

if (timedOut) process.exit(124);
if (exitCode !== 0) process.exit(exitCode);

try {
  const summary = parseTapSummary(stdout);
  assertNoCancelledTests(summary);
  console.log(`CI test summary: ${summary.pass} pass / ${summary.fail} fail / ${summary.cancelled} cancelled / ${summary.skipped} skipped`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
