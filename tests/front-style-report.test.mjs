import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { finalizeFrontStyleReport } from '../src/front-style-report.mjs';

test('final front report assembly collapses repeated check ids and recounts verdicts conservatively', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/front-style-repeated-checks.json', import.meta.url), 'utf8'));
  const report = finalizeFrontStyleReport({ ...fixture, summary: { pass: 12, fail: 0 } });
  assert.equal(report.checks.length, 4);
  assert.deepEqual(report.checks.map((check) => [check.id, check.status]), [
    ['bss-button-text', 'fail'], ['bss-filter-title', 'pass'],
    ['bss-product-name', 'pass'], ['bss-pagination-other', 'pass'],
  ]);
  assert.deepEqual(report.summary, { pass: 3, fail: 1, na: 0, other: 0 });
});
