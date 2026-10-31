import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentTimeoutRetries, retryEnvironmentTimeout, retryWithFreshControl,
  waitForNoLoadingOverlay } from '../src/ui-waits.mjs';

test('environment waits retry a bounded timeout and return the successful attempt', async () => {
  let calls = 0;
  const value = await retryEnvironmentTimeout(async () => {
    calls += 1;
    if (calls === 1) { const error = new Error('navigation timeout'); error.name = 'TimeoutError'; throw error; }
    return 'ready';
  }, { stage: 'navigation', retries: 1 });
  assert.equal(value, 'ready');
  assert.equal(calls, 2);
});

test('environment wait retries respect the configured bound and do not retry assertion errors', async () => {
  let calls = 0;
  await assert.rejects(retryEnvironmentTimeout(async () => {
    calls += 1; const error = new Error('timed out'); error.name = 'TimeoutError'; throw error;
  }, { stage: 'library-load', retries: 2 }), /timed out/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(retryEnvironmentTimeout(async () => {
    calls += 1; throw new Error('assertion mismatch');
  }, { stage: 'editor-load', retries: 2 }), /assertion mismatch/);
  assert.equal(calls, 1);
});

test('environment retry rejects assertion stages and invalid configuration', async () => {
  await assert.rejects(retryEnvironmentTimeout(async () => true, { stage: 'assertion' }), /not allowed/);
  assert.throws(() => environmentTimeoutRetries('4'), /0 to 2/);
});

test('loading overlay wait polls until all masks disappear and fails at its bound', async () => {
  let reads = 0;
  const overlays = await waitForNoLoadingOverlay(async () => (++reads < 3 ? ['loadingMask'] : []), {
    timeoutMs: 100, intervalMs: 1, wait: async () => {},
  });
  assert.deepEqual(overlays, []);
  assert.equal(reads, 3);
  await assert.rejects(waitForNoLoadingOverlay(async () => ['loadingMask2'], {
    timeoutMs: 0, wait: async () => {},
  }), /loadingMask2/);
});

test('transient loading interception re-resolves a detached rail control within a bound', async () => {
  let resolutions = 0, actions = 0, readiness = 0;
  const result = await retryWithFreshControl({
    attempts: 3,
    ready: async () => { readiness += 1; },
    resolve: async () => ({ generation: ++resolutions }),
    act: async (control) => {
      actions += 1;
      if (actions === 1) { const error = new Error('loadingMask intercepts pointer events'); error.name = 'TimeoutError'; throw error; }
      return control.generation;
    },
  });
  assert.equal(result, 2);
  assert.equal(resolutions, 2);
  assert.equal(actions, 2);
  assert.equal(readiness, 2);
});

test('fresh-control retry does not repeat non-transient failures', async () => {
  let resolutions = 0;
  await assert.rejects(retryWithFreshControl({
    attempts: 3,
    resolve: async () => { resolutions += 1; return {}; },
    act: async () => { throw new Error('assertion mismatch'); },
  }), /assertion mismatch/);
  assert.equal(resolutions, 1);
});
