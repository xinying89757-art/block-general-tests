import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFixtureTruthTable, customGroupTitles, runSettingsLayer } from '../src/capabilities/custom-filter-fields.mjs';
import { prepareFixture, validateFixture } from '../src/fixture.mjs';
import { FIELD_TYPE_CODES } from '../src/cms.mjs';
import { isFieldCheckbox } from '../src/capabilities/shared.mjs';
import { runCapabilityLayer } from '../src/run.mjs';

const profile = JSON.parse(readFileSync(new URL('../profiles/40838.json', import.meta.url)));
const fresh = () => structuredClone(profile.fixture);

test('40838 built-in Category is excluded without dropping the same-named custom field', () => {
  assert.deepEqual(customGroupTitles(['Series', 'Category'], '40838'), []);
  assert.deepEqual(customGroupTitles(['Series', 'Category', 'Category', 'Rated Current'], '40838'),
    ['Category', 'Rated Current']);
  assert.deepEqual(customGroupTitles(['Category', 'Category'], 'other'), ['Category', 'Category']);
});

test('40838 declared values produce all eight independent expected sets', () => {
  const table = buildFixtureTruthTable(profile.fixture);
  assert.deepEqual(table.single.map((entry) => entry.products), [
    ['测试产品A', '测试产品小何1', 'AUTOTEST-产品4'],
    ['测试产品A', '测试产品小何2', 'AUTOTEST-产品4'],
    ['测试产品A', '测试产品小何1', '测试产品小何2'],
  ]);
  assert.deepEqual(table.pairs, [
    { i: 1, j: 2, products: ['测试产品A', 'AUTOTEST-产品4'] },
    { i: 1, j: 3, products: ['测试产品A', '测试产品小何1'] },
    { i: 2, j: 3, products: ['测试产品A', '测试产品小何2'] },
  ]);
  assert.deepEqual(table.intersection, ['测试产品A']);
  assert.deepEqual(table.union, ['测试产品A', '测试产品小何1', '测试产品小何2', 'AUTOTEST-产品4']);
});

test('truth table accepts reordered flips without mutating the profile', () => {
  const fixture = fresh(), before = structuredClone(fixture);
  fixture.products = [fixture.products[0], ...fixture.products.slice(1).reverse()];
  const original = buildFixtureTruthTable(before), reordered = buildFixtureTruthTable(fixture);
  for (let i = 0; i < original.single.length; i++) assert.deepEqual(new Set(reordered.single[i].products), new Set(original.single[i].products));
  assert.deepEqual(profile.fixture, before);
});

test('two-field template is a valid independent truth table', () => {
  const fixture = JSON.parse(readFileSync(new URL('../profiles/TEMPLATE.json', import.meta.url))).fixture;
  validateFixture(fixture);
  const table = buildFixtureTruthTable(fixture);
  assert.deepEqual(table.single.map((entry) => entry.products.length), [2, 2]);
  assert.equal(table.pairs.length, 1);
  assert.deepEqual(table.pairs[0].products, table.intersection);
  assert.equal(table.union.length, 3);
});

test('duplicate flips and products that flip multiple fields are rejected', () => {
  const duplicate = fresh();
  duplicate.products[3].values = { ...duplicate.products[2].values };
  assert.throws(() => buildFixtureTruthTable(duplicate), /每个字段须恰好/);
  const multi = fresh();
  multi.products[1].values['测试单选按钮A'] = '单选6-10';
  assert.throws(() => buildFixtureTruthTable(multi), /单字段翻转/);
});

test('fixture validation rejects malformed inputs before opening any CMS page', async () => {
  const variants = [
    (f) => { f.supportedTypes = []; },
    (f) => { f.fields[0].options = ['only-one']; },
    (f) => { f.products.pop(); },
    (f) => { delete f.products[0].values['测试下拉列表']; },
    (f) => { f.products[0].values['AUTOTEST-多选'] = ['多选4-10', '多选8-10']; },
    (f) => { f.fields[0].typeCode = 3; },
  ];
  for (const mutate of variants) {
    const fixture = fresh(); mutate(fixture);
    await assert.rejects(prepareFixture({ profile: { fixture }, context: { newPage() { assert.fail('CMS must not open'); } } }), /fixture 画像无效/);
  }
});

test('no fixture returns skipped without a browser', async () => {
  assert.deepEqual(await prepareFixture({ profile: {} }), { skipped: true });
});

test('shared field classification excludes select-all and nested value controls', () => {
  assert.equal(isFieldCheckbox({ type: 'checkbox', value: '123', label: 'field' }), true);
  for (const control of [
    { type: 'checkbox', value: '123_1', label: 'option' },
    { type: 'checkbox', value: '123', label: '全选' },
    { type: 'radio', value: '123', label: 'field' },
    { type: 'checkbox', value: '', label: 'field' },
  ]) assert.equal(isFieldCheckbox(control), false);
  assert.deepEqual(FIELD_TYPE_CODES, { 文本字段: 0, 单选按钮: 1, 下拉列表: 2, 多选按钮: 3, 色卡: 4, 下载文件: 5, 文本域: 8 });
});

test('capability dispatch receives the full profile and still isolates layer errors', async () => {
  const capability = { id: 'fixture-consumer' }, report = { artifactErrors: [] };
  const checks = await runCapabilityLayer([{ id: 'broken' }, capability], 'settings', { profile, report }, {
    broken: { runSettingsLayer() { throw new Error('isolated'); } },
    'fixture-consumer': { runSettingsLayer(args) {
      assert.equal(args.profile, profile);
      assert.equal(args.capability, capability);
      return [{ id: 'after-error', status: 'pass' }];
    } },
  });
  assert.deepEqual(checks.map(({ id, status }) => ({ id, status })), [
    { id: 'broken-settings-error', status: 'fail' }, { id: 'after-error', status: 'pass' },
  ]);
});


test('unavailable settings produce explicit legacy and nine oracle skips with textual expectations', async () => {
  const locator = { filter() { return this; }, first() { return this; }, async isVisible() { return false; } };
  const page = { locator() { return locator; } };
  const canvas = { locator() { throw new Error('offline: settings unavailable'); } };
  const checks = await runSettingsLayer({ page, canvas, config: { blockId: profile.blockId }, profile,
    report: { fixture: { applied: false } } });
  const oracles = checks.filter((check) => check.id.startsWith('cff-oracle-'));
  assert.equal(oracles.length, 9);
  assert.ok(oracles.every((check) => check.status === 'skip'));
  for (const check of oracles) {
    for (const key of ['description', 'expected', 'actual']) assert.equal(typeof check[key], 'string');
    assert.ok(check.evidenceText.every((text) => typeof text === 'string'));
  }
  const union = oracles.find((check) => check.id === 'cff-oracle-union-all');
  assert.match(union.detail, /仍按正确预期断言/);
  for (const name of profile.fixture.products.map((product) => product.name)) assert.ok(union.expected.includes(name));
  assert.match(oracles.find((check) => check.id === 'cff-oracle-multivalue').detail, /尚未实现/);
  for (const kind of ['logic', 'trigger', 'scope', 'jump']) assert.match(checks.find((check) => check.id === `cff-${kind}-front`).detail, /已被 N 字段 fixture oracle 取代/);
  const withoutFixture = await runSettingsLayer({ page, canvas, config: { blockId: profile.blockId } });
  assert.equal(withoutFixture.length, 7);
  assert.ok(withoutFixture.every((check) => !check.id.startsWith('cff-oracle-')));
});
