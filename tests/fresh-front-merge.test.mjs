import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeFreshFrontReports, summarizeFreshFrontMerge } from '../src/fresh-front-merge.mjs';

const box = JSON.parse(readFileSync(new URL('./fixtures/fresh-box-report.json', import.meta.url), 'utf8'));
const front = JSON.parse(readFileSync(new URL('./fixtures/fresh-front-report.json', import.meta.url), 'utf8'));

test('fresh/front merge overrides only deferred and retains both source rows', () => {
  const merged = mergeFreshFrontReports(box, front);
  const rows = new Map(merged.checks.map((row) => [row.id, row]));
  assert.equal(rows.get('style-color').status, 'pass');
  assert.equal(rows.get('style-color').selectedSource, 'front');
  assert.equal(rows.get('style-color').sources.box.status, 'deferred');
  assert.equal(rows.get('style-color').sources.front.status, 'pass');
  assert.equal(rows.get('persist-width').status, 'pass');
  assert.equal(rows.get('persist-width').sources.front.status, 'fail');
  assert.equal(rows.get('persist-width').selectedSource, 'box');
  assert.equal(rows.get('front-only').selectedSource, 'front');
  assert.deepEqual(merged.merge.frontOverrides, ['style-color']);
  assert.match(summarizeFreshFrontMerge(merged), /deferred/);
});

test('fresh/front merge fails closed on block mismatch or duplicate check ids', () => {
  assert.throws(() => mergeFreshFrontReports(box, { ...front, blockId: 'other' }), /same block/);
  assert.throws(() => mergeFreshFrontReports({ ...box, checks: [...box.checks, box.checks[0]] }, front), /duplicate/);
});
