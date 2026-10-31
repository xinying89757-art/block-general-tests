import test from 'node:test';
import assert from 'node:assert/strict';
import { createStableSnapshotDiagnostics, dismissReadOnlyPopover, readStableSnapshot, reloadDiscardAndVerify } from '../src/read-only-dismiss.mjs';

test('read-only popover dismissal uses Escape and neutral click without a save action', async () => {
  const events = [];
  let visible = true;
  await dismissReadOnlyPopover({
    isVisible: async () => visible,
    pressEscape: async () => { events.push('escape'); },
    neutralClick: async () => { events.push('neutral'); visible = false; },
  });
  assert.deepEqual(events, ['escape', 'neutral']);
  assert.equal(events.includes('save'), false);
});

test('read-only popover can be dismissed by toggling its toolbar trigger without saving', async () => {
  const events = [];
  let visible = true;
  await dismissReadOnlyPopover({
    isVisible: async () => visible,
    pressEscape: async () => { events.push('escape'); },
    neutralClick: async () => { events.push('neutral'); },
    toggleTrigger: async () => { events.push('toggle'); visible = false; },
  });
  assert.deepEqual(events, ['escape', 'neutral', 'toggle']);
});

test('read-only popover can be dismissed by opening and closing the page menu without saving', async () => {
  const events = [];
  let visible = true;
  await dismissReadOnlyPopover({
    isVisible: async () => visible,
    pressEscape: async () => { events.push('escape'); },
    neutralClick: async () => { events.push('neutral'); },
    toggleTrigger: async () => { events.push('toggle'); },
    focusAway: async () => { events.push('page-menu-open'); events.push('escape-menu'); visible = false; },
  });
  assert.deepEqual(events, ['escape', 'neutral', 'toggle', 'page-menu-open', 'escape-menu']);
  assert.equal(events.includes('save'), false);
});

test('read-only popover reload discards UI state and verifies values before final cleanup reload', async () => {
  const events = [];
  const expected = [{ label: '按钮文本', type: 'text', to: 'Contact us' }];
  const actual = await reloadDiscardAndVerify({
    reload: async () => { events.push('reload-discard'); },
    readBack: async () => { events.push('read-back'); return structuredClone(expected); },
    expected,
    finishReload: async () => { events.push('final-reload-discard'); },
  });
  assert.deepEqual(actual, expected);
  assert.deepEqual(events, ['reload-discard', 'read-back', 'read-back', 'final-reload-discard']);
  assert.equal(events.some((event) => /save/i.test(event)), false);
});

test('read-only popover reload mismatch fails without any save action', async () => {
  const events = [];
  await assert.rejects(reloadDiscardAndVerify({
    reload: async () => { events.push('reload-discard'); },
    readBack: async () => [{ label: '按钮文本', type: 'text', to: 'changed' }],
    expected: [{ label: '按钮文本', type: 'text', to: 'original' }],
    finishReload: async () => { events.push('final-reload-discard'); },
  }), /重载后发生变化.*未保存.*变化字段=.*to/);
  assert.deepEqual(events, ['reload-discard']);
  assert.equal(events.some((event) => /save/i.test(event)), false);
});

test('read-only button values wait for two consecutive stable post-reload reads', async () => {
  let now = 0;
  const observed = [{ value: 'loading' }, { value: 'saved' }, { value: 'saved' }];
  const value = await readStableSnapshot(async () => observed.shift(), {
    timeoutMs: 10, intervalMs: 1, now: () => now, wait: async (ms) => { now += ms; },
  });
  assert.deepEqual(value, { value: 'saved' });
});

test('read-only stable value timeout retains the last observation and does not weaken comparison', async () => {
  let now = 0, index = 0;
  await assert.rejects(readStableSnapshot(async () => ({ value: String(index++) }), {
    timeoutMs: 3, intervalMs: 1, now: () => now, wait: async (ms) => { now += ms; },
  }), (error) => error.code === 'READBACK_UNSTABLE' && error.lastValue.value === '3');
});

test('stable snapshot diagnostics report changed and unreadable field names without values', () => {
  const diagnostics = createStableSnapshotDiagnostics(['text', 'url', 'linkType']);
  diagnostics.observe({ text: 'private label', url: 'https://private.example', linkType: '域名' });
  diagnostics.observe({ text: 'private label', url: 'https://other.example', linkType: '域名' });
  diagnostics.observe({ text: undefined, url: 'https://other.example', linkType: '域名' });
  const summary = diagnostics.summary({ elapsedMs: 15000, loadingMaskVisible: true });
  assert.deepEqual(summary, { snapshotCount: 3, elapsedMs: 15000, changingFields: ['url'],
    unreadableFields: ['text'], loadingMaskVisible: true });
  assert.doesNotMatch(JSON.stringify(summary), /private|example|域名/);
});

test('read-only dismissal invokes reload discard only after ordinary no-save methods fail', async () => {
  const events = [];
  let visible = true;
  await dismissReadOnlyPopover({
    isVisible: async () => visible,
    pressEscape: async () => { events.push('escape'); },
    neutralClick: async () => { events.push('neutral'); },
    toggleTrigger: async () => { events.push('toggle'); },
    focusAway: async () => { events.push('focus'); },
    reloadDiscard: async () => { events.push('reload-discard'); visible = false; },
  });
  assert.deepEqual(events, ['escape', 'neutral', 'toggle', 'focus', 'reload-discard']);
  assert.equal(events.includes('save'), false);
});

test('read-only popover fails clearly when it cannot close without saving', async () => {
  let saves = 0;
  await assert.rejects(dismissReadOnlyPopover({
    isVisible: async () => true,
    pressEscape: async () => {},
    neutralClick: async () => {},
  }), /重载丢弃后仍无法关闭.*不会点击“保存”/);
  assert.equal(saves, 0);
});
