import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrontRunId, deriveFrontReportId } from '../src/front-report-identity.mjs';

test('front-only run identity derives from source report basename and timestamp', () => {
  const timestamp = '2026-11-02T04:10:00.000Z';
  assert.equal(createFrontRunId('/private/reports/settings-run.json', timestamp),
    `settings-run.json:${timestamp}`);
  assert.equal(deriveFrontReportId('/private/reports/settings-run.json', timestamp),
    `settings-run.json:${timestamp}`);
});

test('front-only run identity remains available without a source report', () => {
  assert.equal(createFrontRunId(null, '2026-11-02T04:10:00.000Z'),
    'front-style-only:2026-11-02T04:10:00.000Z');
  assert.equal(deriveFrontReportId(null, '2026-11-02T04:10:00.000Z'), null);
});
