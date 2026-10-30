import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checksToResume, createPauseDetector, RunTimeoutError, withTimeout, writeCheckpoint } from '../src/run-safety.mjs';

test('pause detector flags wall-clock jumps beyond its threshold once', () => {
  let wall = 1_000, monotonic = 500, pauseCount = 0;
  const detector = createPauseDetector({ wallNow: () => wall, monotonicNow: () => monotonic,
    pauseThresholdMs: 30_000, onPause: () => pauseCount++ });
  wall += 10_000; monotonic += 10_000;
  assert.equal(detector.sample().paused, false);
  wall += 41_000; monotonic += 10_000;
  assert.equal(detector.sample().paused, true);
  detector.sample();
  assert.equal(pauseCount, 1);
  detector.stop();
});

test('checkpoints persist completed checks and resume only pending checks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fixture-checkpoint-'));
  try {
    const file = path.join(directory, 'state.json');
    const state = { runId: 'offline', currentCheckId: 'check-b', completedChecks: [{ id: 'check-a', status: 'pass' }] };
    await writeCheckpoint(file, state);
    const loaded = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(checksToResume([{ id: 'check-a' }, { id: 'check-b' }], loaded.completedChecks.map(({ id }) => id)), [{ id: 'check-b' }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('withTimeout rejects with a distinct environment timeout', async () => {
  await assert.rejects(withTimeout(() => new Promise(() => {}), 5, 'unit check'),
    (error) => error instanceof RunTimeoutError && error.envStatus === 'env-timeout');
});
