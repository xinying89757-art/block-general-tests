import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissReadOnlyPopover } from '../src/read-only-dismiss.mjs';

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

test('read-only popover fails clearly when it cannot close without saving', async () => {
  let saves = 0;
  await assert.rejects(dismissReadOnlyPopover({
    isVisible: async () => true,
    pressEscape: async () => {},
    neutralClick: async () => {},
  }), /不会点击“保存”/);
  assert.equal(saves, 0);
});
