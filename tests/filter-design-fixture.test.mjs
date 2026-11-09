import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilterSupportedTypes, buildDefaultFilterFixture, applyFilterFixtureFromDesignSpec, aggregateFilterDesignRequirement } from '../src/filter-design-fixture.mjs';
import { validateFixture } from '../src/fixture.mjs';
import { fixturePlan } from '../src/fixture-data.mjs';
import { buildFixtureTruthTable } from '../src/capabilities/custom-filter-fields.mjs';

const sourceText = '支持类型：下拉、单选按钮、多选、文本字段';
const types = ['下拉列表', '单选按钮', '多选按钮', '文本字段'];
const requirement = { id: 'filter-field-supported-types', checkType: 'manual', sourceText, expected: {}, checkStage: 'editor' };
test('aliases are canonical, ordered, deduplicated and unknowns ignored', () => {
  assert.deepEqual(parseFilterSupportedTypes('下拉列表、下拉、单选、单选按钮、多选按钮、多选、文本、文本字段、未知'), types);
  assert.deepEqual(parseFilterSupportedTypes('未知'), []);
});
test('draft fixture is a valid N+1 truth table', () => {
  const fixture = buildDefaultFilterFixture(types, { blockId: 'test' });
  validateFixture(fixture, { displayFieldTypes: [] });
  assert.equal(fixturePlan({ fixture, requirements: { displayFieldTypes: [] } }).products.length, 5);
  const table = buildFixtureTruthTable(fixture);
  assert.equal(table.single.length, 4); assert.equal(table.intersection.length, 1);
});
test('design draft preserves display requirements and is idempotent', () => {
  const profile = { blockId: 'test', requirements: { displayFieldTypes: [] }, designSpec: { requirements: [structuredClone(requirement)] } };
  applyFilterFixtureFromDesignSpec(profile); const snapshot = structuredClone(profile);
  applyFilterFixtureFromDesignSpec(profile); assert.deepEqual(profile, snapshot);
  assert.deepEqual(profile.requirements.displayFieldTypes, []);
});
test('aggregation reports pass, fail and missing fixture evidence', () => {
  const fixture = buildDefaultFilterFixture(types);
  const profile = { fixture };
  const checks = fixture.fields.map((field, index) => ({ id: `cff-oracle-single-${index + 1}`, status: 'pass', evidence: { productSets: [{ actual: fixture.products.filter(p => p.values[field.name] === field.options[0]).map(p => p.name) }] } }));
  const pass = aggregateFilterDesignRequirement(requirement, profile, checks, { applied: true });
  assert.equal(pass.status, 'pass'); assert.deepEqual(pass.actual[0].expected, pass.actual[0].actual);
  checks[1].status = 'fail'; assert.equal(aggregateFilterDesignRequirement(requirement, profile, checks, { applied: true }).status, 'fail');
  assert.equal(aggregateFilterDesignRequirement(requirement, profile, [], { applied: false }).reason.code, 'filter-fixture-unavailable');
});

test('partial fixtures are drafted and display-only types remain separate', () => {
  const profile = { blockId: 'test', requirements: { displayFieldTypes: ['色卡'] }, fixture: { fields: [{ type: '文本字段' }] },
    designSpec: { requirements: [structuredClone(requirement)] } };
  applyFilterFixtureFromDesignSpec(profile);
  assert.deepEqual(profile.requirements.displayFieldTypes, ['色卡']);
  assert.equal(fixturePlan(profile).fields.length, 5);
  validateFixture(profile.fixture, profile.requirements);
});

test('single-field oracle permits absent controls without guessing incomplete radio groups', async () => {
  const { optionalOracleRadioPair } = await import('../src/capabilities/custom-filter-fields.mjs');
  const group = { name: '筛选逻辑', prefixes: ['交集', '并集'] };
  assert.equal(optionalOracleRadioPair([], group), null);
  assert.throws(() => optionalOracleRadioPair([{ type: 'radio', label: '交集', name: 'logic' }], group));
  assert.equal(optionalOracleRadioPair([{ type: 'radio', label: '交集', name: 'logic' }, { type: 'radio', label: '并集', name: 'logic' }], group).length, 2);
});
