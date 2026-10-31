import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentTimeoutRetries, retryEnvironmentTimeout } from '../src/ui-waits.mjs';

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
