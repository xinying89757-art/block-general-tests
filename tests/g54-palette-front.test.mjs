import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteWriteReadback } from '../src/capabilities/rail.mjs';
import { countCssColorMatches, runWrittenColorStylesheetSearch } from '../src/design-spec-checklist.mjs';

test('palette write readback compares the actual input value with the value set', () => {
  assert.deepEqual(paletteWriteReadback('#d0b647', 'rgb(208, 182, 71)'), {
    setValue: '#d0b647', readBackValue: 'rgb(208, 182, 71)', matched: true,
  });
  assert.deepEqual(paletteWriteReadback('#d0b647', 'rgb(13, 13, 10)'), {
    setValue: '#d0b647', readBackValue: 'rgb(13, 13, 10)', matched: false,
    reason: 'palette-write-readback-mismatch',
  });
});

test('CSS color scanner recognizes rgb/rgba, hex alpha, and hsl while accepting alpha at most one', () => {
  assert.equal(countCssColorMatches('x{color:rgba(208,182,71,.4)}', '#d0b647'), 1);
  assert.equal(countCssColorMatches('x{color:#0d0d0a80}', 'rgb(13,13,10)'), 1);
  assert.equal(countCssColorMatches('x{color:hsla(0,100%,50%,1)}', '#ff0000'), 1);
  assert.equal(countCssColorMatches('x{color:rgba(13,13,10,1.2)}', '#0d0d0a'), 0);
});

test('optional stylesheet matches are reported as record evidence and never replace element failures', async () => {
  const settingsReport = { blockId: 'generic', block: { currentValues: [
    { region: 'right-rail-color', type: 'color', value: 'rgb(208, 182, 71)' },
  ] } };
  const page = { evaluate: async () => ({ links: ['https://assets.test/style.css?secret=never-log'],
    inline: ['.x{--palette: #d0b647}'] }) };
  const rows = await runWrittenColorStylesheetSearch({ page, settingsReport,
    elementChecks: [{ id: 'written-color-1', status: 'fail' }],
    fetchStylesheet: async () => '.x{background: rgba(208, 182, 71, .5)}',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'record');
  assert.equal(rows[0].reason.code, 'written-color-stylesheet-only-match');
  assert.equal(rows[0].actual.stylesheetMatchCount, 2);
  assert.doesNotMatch(JSON.stringify(rows), /assets\.test|secret/);
  assert.deepEqual(await runWrittenColorStylesheetSearch({ page, settingsReport,
    elementChecks: [{ id: 'written-color-1', status: 'pass' }], fetchStylesheet: async () => '#d0b647',
  }), []);
});
