import test from 'node:test';
import assert from 'node:assert/strict';
import { effectCheck } from '../src/capabilities/effect-checks.mjs';

const result = (id, status, detail, evidence) => ({ id, status, detail, evidence });
const session = { open: async () => {}, read: async () => [], cancel: async () => {} };

test('effectCheck preserves phase evidence when its outer timeout fires', async () => {
  const check = await effectCheck({
    id: 'timeout-phases', layer: 'backend', result, session, page: {}, canvas: {},
    config: { checkTimeoutMs: 60 },
    run: async (tx) => {
      tx.phase('phase-a');
      await new Promise((resolve) => setTimeout(resolve, 300));
      tx.phase('phase-b');
    },
  });
  assert.equal(check.status, 'env-timeout');
  assert.ok(check.evidence.phases.some((phase) => phase.name === 'phase-a'));
  for (const phase of check.evidence.phases) assert.equal(new Date(phase.at).toISOString(), phase.at);
});

test('effectCheck records phases in order and signals watchdog progress', async () => {
  let progress = 0;
  const check = await effectCheck({
    id: 'pass-phases', layer: 'backend', result, session, page: {}, canvas: {},
    config: { watchdogProgress: () => { progress += 1; } },
    run: async (tx) => { tx.phase('one'); tx.phase('two'); },
  });
  assert.equal(check.status, 'pass');
  assert.deepEqual(check.evidence.phases.map((phase) => phase.name), ['one', 'two']);
  for (const phase of check.evidence.phases) assert.equal(new Date(phase.at).toISOString(), phase.at);
  assert.equal(progress, 3);
});
