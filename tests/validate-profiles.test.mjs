import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { validateProfile } from '../scripts/validate-profiles.mjs';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../profiles/${name}`, import.meta.url), 'utf8'));
const template = readJson('TEMPLATE.json');
const profiles = ['40838.json', '47748.json'].map(readJson);
const capabilities = new Set(readdirSync(new URL('../src/capabilities/', import.meta.url))
  .filter((name) => name.endsWith('.mjs') && !['TEMPLATE.mjs', 'shared.mjs'].includes(name))
  .map((name) => name.slice(0, -'.mjs'.length)));

test('existing profiles pass schema, baseline, capability, and fixture validation', () => {
  for (const profile of profiles) {
    assert.deepEqual(validateProfile(profile, template, { capabilities }), []);
  }
});

test('profile validation rejects missing required keys', () => {
  const profile = structuredClone(profiles[0]);
  delete profile.name;
  assert.ok(validateProfile(profile, template, { capabilities }).some((error) => /缺少必需顶层键 name/.test(error)));
});

test('profile validation rejects top-level type mismatches', () => {
  const profile = structuredClone(profiles[0]);
  profile.capabilities = {};
  assert.ok(validateProfile(profile, template, { capabilities }).some((error) => /顶层键 capabilities 类型错误/.test(error)));
});

test('profile validation rejects capabilities without a module', () => {
  const profile = structuredClone(profiles[0]);
  profile.capabilities.push({ id: 'not-a-real-capability' });
  assert.ok(validateProfile(profile, template, { capabilities }).some((error) => /未知能力 not-a-real-capability/.test(error)));
});
