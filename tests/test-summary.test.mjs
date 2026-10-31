import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoCancelledTests, parseTapSummary } from '../src/test-summary.mjs';

const tap = (cancelled) => `1..4\n# tests 4\n# pass 3\n# fail 0\n# cancelled ${cancelled}\n# skipped 1\n# todo 0\n`;

test('test runner parses TAP counts and accepts zero cancellations', () => {
  const summary = parseTapSummary(tap(0));
  assert.deepEqual(summary, { tests: 4, pass: 3, fail: 0, cancelled: 0, skipped: 1 });
  assert.doesNotThrow(() => assertNoCancelledTests(summary));
});

test('test runner rejects any TAP cancellation even if Node exits successfully', () => {
  const summary = parseTapSummary(tap(1));
  assert.throws(() => assertNoCancelledTests(summary), /1 cancelled/);
});

test('test runner rejects an incomplete TAP summary', () => {
  assert.throws(() => parseTapSummary('# tests 1\n# pass 1\n'), /incomplete/);
});
