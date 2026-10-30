import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { effectCheck } from '../src/capabilities/effect-checks.mjs';
import { frontRunPhases, replaceDeferredChecks, shouldRunLayer } from '../src/front-results.mjs';
import { renderReport } from '../scripts/report-html.mjs';
import { runCapabilityLayer } from '../src/run.mjs';

test('DEFER_FRONT suppresses front effects before any mutation and reports deferred status', async () => {
  let ran = false;
  const check = await effectCheck({ id: 'sample-front', layer: 'front', config: { deferFront: true },
    result: (id, status, detail, evidence) => ({ id, status, detail, evidence }),
    run: async () => { ran = true; } });
  assert.equal(ran, false);
  assert.deepEqual({ status: check.status, detail: check.detail }, { status: 'deferred', detail: 'deferred-to-front-runner' });
});

test('FRONT_ONLY retains front-effect setup and front checks, but skips canvas backend checks', () => {
  const config = { frontOnly: true };
  assert.equal(shouldRunLayer('settings', config), true);
  assert.equal(shouldRunLayer('backend', config), false);
  assert.equal(shouldRunLayer('front', config), true);
});

test('FRONT_ONLY still guards/applies baseline and prepares a selected CFF fixture', () => {
  const profile = { baseline: [{ want: [] }], fixture: { fields: [] },
    capabilities: [{ id: 'custom-filter-fields' }] };
  assert.deepEqual(frontRunPhases({ frontOnly: true }, profile, true), {
    baselineGuard: true, applyBaseline: true, prepareFixture: true,
    settings: true, backend: false, front: true, capabilities: ['custom-filter-fields'],
  });
});

test('fixture preparation covers category and product list filters, but skips unrelated capabilities', () => {
  const profile = { baseline: [], fixture: {}, capabilities: [{ id: 'custom-filter-fields' }] };
  assert.equal(frontRunPhases({ frontOnly: true, capabilityFilter: ['product-list-display'] }, profile).prepareFixture, true);
  assert.equal(frontRunPhases({ frontOnly: true, capabilityFilter: ['product-category-select'] }, profile).prepareFixture, true);
  assert.equal(frontRunPhases({ frontOnly: true, capabilityFilter: ['button-link'] }, profile).prepareFixture, false);
});

test('FRONT_ONLY dispatches only a capability’s transactional front effects from settings layer', async () => {
  const calls = [];
  const result = await runCapabilityLayer([{ id: 'sample' }], 'settings', {
    config: { frontOnly: true }, profile: {}, report: { artifactErrors: [] },
  }, { sample: {
    runSettingsLayer() { calls.push('settings'); return []; },
    runFrontEffectsLayer() { calls.push('front-effects'); return [{ id: 'front-effect', status: 'pass' }]; },
  } });
  assert.deepEqual(calls, ['front-effects']);
  assert.equal(result[0].id, 'front-effect');
});

test('front result replaces only matching deferred checks and recalculates counts', () => {
  const base = { checks: [
    { id: 'common-front', status: 'deferred' }, { id: 'effect-front', status: 'deferred' },
    { id: 'setting', status: 'pass' },
  ], summary: { pass: 1, fail: 0, deferred: 2 }, failure: null, artifactErrors: [] };
  const front = { checks: [{ id: 'common-front', status: 'pass' }, { id: 'effect-front', status: 'fail' }] };
  const merged = replaceDeferredChecks(base, front);
  assert.deepEqual(merged.checks.map(({ status }) => status), ['pass', 'fail', 'pass']);
  assert.deepEqual(merged.summary, { pass: 2, fail: 1, skip: 0, na: 0, record: 0, deferred: 0 });
  assert.equal(merged.status, 'failed');
});

test('HTML report exposes deferred count, filter and cards', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'front-report-'));
  const json = path.join(temp, 'input.json'), html = path.join(temp, 'output.html');
  try {
    const report = { runId: 'offline-front', startedAt: '', finishedAt: '', config: { blockId: 'test' },
      checks: [{ id: 'front-deferred', name: '前台检查', status: 'deferred', detail: 'deferred-to-front-runner' }],
      summary: { deferred: 1, pass: 0, fail: 0, skip: 0, na: 0, record: 0 } };
    await import('node:fs/promises').then(({ writeFile }) => writeFile(json, JSON.stringify(report)));
    await renderReport(json, html);
    const output = await readFile(html, 'utf8');
    assert.match(output, /延后运行/);
    assert.match(output, /deferred-to-front-runner/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
