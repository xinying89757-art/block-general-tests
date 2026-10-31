import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFromEnv } from '../src/config.mjs';

test('account name safely defaults to empty when a storage state is supplied without credentials', () => {
  assert.equal(accountFromEnv({}), '');
  assert.equal(accountFromEnv({ PLAYWRIGHT_USERNAME: ' test-account ' }), 'test-account');
});
