import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrontMode } from '../src/front-provider.mjs';
import { runFinalFrontChecks } from '../src/fresh-front-final.mjs';
import { acquireFreshRunLease } from '../src/fresh-run-lease.mjs';
import { buildFreshReport } from '../src/fresh-block-flow.mjs';

test('auto detection maps available preview and unavailable published with detection reason', () => {
  assert.deepEqual(resolveFrontMode({ FRONT_PROVIDER: 'auto' }, { available: true, reason: 'preview found' }),
    { frontMode: 'preview', frontModeReason: 'preview found', detect: true });
  assert.deepEqual(resolveFrontMode({}, { available: false, reason: 'preview timed out' }),
    { frontMode: 'published', frontModeReason: 'preview timed out', detect: true });
});

test('explicit provider overrides detection and records its environment source', () => {
  assert.deepEqual(resolveFrontMode({ FRONT_PROVIDER: 'published' }, { available: true, reason: 'ignored' }),
    { frontMode: 'published', frontModeReason: 'env:FRONT_PROVIDER=published', detect: false });
  assert.deepEqual(resolveFrontMode({ FRONT_PROVIDER: 'preview' }, { available: false, reason: 'ignored' }),
    { frontMode: 'preview', frontModeReason: 'env:FRONT_PROVIDER=preview', detect: false });
});

test('fresh report always records front mode and reason', () => {
  const report = buildFreshReport({ runId: 'run', siteHost: 'example.test', blockId: 'block', page: { kind: 'custom' },
    instance: {}, batch: { results: [], batches: [], timing: {} }, frontMode: 'published',
    frontModeReason: 'preview unavailable' });
  assert.equal(report.frontMode, 'published');
  assert.equal(report.frontModeReason, 'preview unavailable');
});

test('preview mode runs shared front checks on cache-busted URL; unreachable front is deferred', async () => {
  const report = { checks: [] };
  let checked = false;
  const page = { goto: async (url) => { assert.match(url, /\?t=123$/); } };
  const complete = await runFinalFrontChecks({ report, mode: 'preview', frontLink: 'http://site.test/page', page,
    timestamp: 123, runChecks: async () => { checked = true; return [{ id: 'front-check', status: 'pass' }]; } });
  assert.equal(checked, true);
  assert.equal(complete.status, 'complete');
  assert.equal(report.checks[0].id, 'front-check');

  const unreachableReport = { checks: [] };
  const deferred = await runFinalFrontChecks({ report: unreachableReport, mode: 'preview', frontLink: 'http://site.test/page',
    page: { goto: async () => { throw new Error('network'); } }, runChecks: async () => assert.fail('must not run') });
  assert.equal(deferred.status, 'deferred');
  assert.equal(unreachableReport.checks[0].status, 'deferred');
  assert.match(unreachableReport.frontCheckReason, /无法加载/);
});

test('published mode defers final front checks without opening a page', async () => {
  const existing = { id: 'preview-check', status: 'deferred', reason: { code: 'preview-unavailable' } };
  const report = { checks: [existing] };
  const result = await runFinalFrontChecks({ report, mode: 'published', frontLink: 'http://site.test/page',
    page: { goto: async () => assert.fail('published mode must not navigate') }, runChecks: async () => assert.fail('must not run') });
  assert.equal(result.status, 'deferred');
  assert.equal(report.frontCheckStatus, 'deferred');
  assert.deepEqual(report.checks, [existing]);
  assert.match(report.frontCheckReason, /merge:fresh-front/);
});

test('site lease is acquired and released in both selected front modes', () => {
  const acquired = [];
  const released = [];
  for (const mode of ['preview', 'published']) {
    const lease = acquireFreshRunLease({ siteHost: `site-${mode}.test`, runId: `run-${mode}`,
      acquire: (resource, options) => { acquired.push([resource, options.runId]); return { acquired: true,
        lease: { resourceKey: resource, runId: options.runId } }; },
      renew: (current) => current,
      releaseLeaseFn: (current) => { released.push(current.runId); return { released: true }; } });
    lease.assertValid();
    lease.release();
  }
  assert.deepEqual(acquired, [['site:site-preview.test', 'run-preview'], ['site:site-published.test', 'run-published']]);
  assert.deepEqual(released, ['run-preview', 'run-published']);
});
