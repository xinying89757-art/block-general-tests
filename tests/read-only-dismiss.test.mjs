import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissReadOnlyPopover, reloadDiscardAndVerify } from '../src/read-only-dismiss.mjs';

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
  assert.deepEqual(events, ['reload-discard', 'read-back', 'final-reload-discard']);
  assert.equal(events.some((event) => /save/i.test(event)), false);
});

test('read-only popover reload mismatch fails without any save action', async () => {
  const events = [];
  await assert.rejects(reloadDiscardAndVerify({
    reload: async () => { events.push('reload-discard'); },
    readBack: async () => [{ label: '按钮文本', type: 'text', to: 'changed' }],
    expected: [{ label: '按钮文本', type: 'text', to: 'original' }],
    finishReload: async () => { events.push('final-reload-discard'); },
  }), /重载后发生变化.*未保存/);
  assert.deepEqual(events, ['reload-discard']);
  assert.equal(events.some((event) => /save/i.test(event)), false);
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
