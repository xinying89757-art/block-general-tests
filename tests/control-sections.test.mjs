import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateControlsWithSections, matchUniqueControlSection } from '../src/control-sections.mjs';

test('section metadata is added only where an accessible group name was read', () => {
  const controls = [{ index: 0, type: 'text' }, { index: 1, type: 'color' }];
  assert.deepEqual(annotateControlsWithSections(controls, ['区块配色', '']), [
    { index: 0, type: 'text', section: '区块配色' }, { index: 1, type: 'color' },
  ]);
});

test('settings section activation resolves exactly one visible named section', () => {
  assert.deepEqual(matchUniqueControlSection([
    { name: '内容', visible: true }, { name: '区块配色', visible: false },
    { name: '区块配色', visible: true },
  ], '区块配色'), { count: 1, match: { name: '区块配色', visible: true } });
  assert.deepEqual(matchUniqueControlSection([{ name: '区块配色', visible: true },
    { name: '区块配色', visible: true }], '区块配色'), { count: 2, match: null });
});
