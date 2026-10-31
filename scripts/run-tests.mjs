import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNoCancelledTests, parseTapSummary } from '../src/test-summary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/*.test.mjs'], {
  cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

try {
  const summary = parseTapSummary(result.stdout);
  assertNoCancelledTests(summary);
  console.log(`CI test summary: ${summary.pass} pass / ${summary.fail} fail / ${summary.cancelled} cancelled / ${summary.skipped} skipped`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
