import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { degradeInventoryRegion } from '../src/baseline.mjs';
import { runCapabilityLayer } from '../src/run.mjs';

test('inventory degradation retains the original error with a default code', () => {
  const region = { type: 'widget', kind: 'widget-dialog', controls: [] };
  const error = new Error('Timeout 10000ms exceeded while waiting for dialog');
  const result = degradeInventoryRegion(region, error);

  assert.equal(result.inventoryError.message, error.message);
  assert.equal(result.inventoryError.code, 'SETTINGS_INVENTORY_ERROR');
  assert.equal(result.inventoryError.regionType, region.type);
  assert.ok(result.skipped);
  assert.equal(region.inventoryError, undefined);
});

test('inventory degradation preserves a custom error code and diagnostics', () => {
  const error = Object.assign(new Error('读不到 dialog 标题'), {
    code: 'DIALOG_TITLE_UNREADABLE',
    inventoryDiagnostics: { title: '' },
  });
  const result = degradeInventoryRegion({ type: 'widget' }, error, 'dialog.png');

  assert.equal(result.inventoryError.message, error.message);
  assert.equal(result.inventoryError.code, error.code);
  assert.deepEqual(result.inventoryError.diagnostics, error.inventoryDiagnostics);
  assert.equal(result.inventoryError.screenshot, 'dialog.png');
});

test('an unadapted capability reports an explicit na check', async () => {
  const checks = await runCapabilityLayer([{ id: 'no-such-cap' }], 'settings', { config: {}, profile: {} }, {});

  assert.equal(checks.length, 1);
  assert.equal(checks[0].id, 'no-such-cap-settings-not-adapted');
  assert.equal(checks[0].status, 'na');
  assert.equal(checks[0].suite, 'capability:no-such-cap');
  assert.match(checks[0].detail, /runSettingsLayer/);
});

test('final baseline verification is not gated by batchSaveUsed', async () => {
  const source = await readFile(new URL('../src/run.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /config\.batchSaveUsed\s*&&/);
  assert.match(source, /if \(typeof config\.verifyBatchBaseline === 'function'\) \{/);
});
