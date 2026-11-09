import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplayFieldsCoverageChecks } from '../src/capabilities/product-list-display.mjs';
import { accountDesignRequirementCoverage, listUnsupportedDesignRequirements, validateDesignSpec } from '../src/design-spec-model.mjs';
import { readFileSync } from 'node:fs';

function makeResult(id, status, detail, evidence, textFields = {}) {
  return { id, status, detail, evidence, ...textFields };
}

test('display fields inventory records even when displayFieldTypes are undeclared', () => {
  const fields = [
    { type: 'checkbox', label: 'Brand', value: 'brand', checked: true },
    { type: 'checkbox', label: 'Model', value: 'model', checked: false },
  ];
  const checks = buildDisplayFieldsCoverageChecks(fields, { requirements: { displayFieldTypes: [] } }, makeResult);
  assert.equal(checks.length, 2);
  assert.equal(checks[0].id, 'pld-fields');
  assert.equal(checks[0].status, 'record');
  assert.match(checks[0].detail, /展示字段 2 个/);
  assert.match(checks[0].detail, /不得把筛选支持类型或卡片布局分带/);
  assert.equal(checks[1].id, 'pld-display-field-types-requirement');
  assert.equal(checks[1].status, 'human-review');
  assert.equal(checks[1].reason.code, 'display-field-types-undeclared');
  assert.equal(checks[1].reason.humanReviewRequired, true);
  assert.doesNotMatch(checks[0].detail, /下拉|单选|多选|文本字段/);
});

test('declared displayFieldTypes stay on the inventory record without fabricating layout bands', () => {
  const fields = [{ type: 'checkbox', label: 'AUTOTEST-单选', value: 'x', checked: true }];
  const checks = buildDisplayFieldsCoverageChecks(fields, {
    requirements: { displayFieldTypes: ['单选'] },
  }, makeResult);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, 'record');
  assert.match(checks[0].detail, /需求类型：单选/);
  assert.doesNotMatch(checks[0].detail, /1-4|5-10|11/);
});

test('design requirement coverage lists unsupported and unexecuted items explicitly', () => {
  const profile = {
    designSpec: {
      source: { fileKey: 'Abcdefghijklmnopqrstu', nodeId: '1:2' },
      requirements: [
        { id: 'layout-bands', checkType: 'manual', sourceText: '1-4 then 5-10', expected: {}, checkStage: 'front', params: {} },
        { id: 'truncation', checkType: 'text-truncation', sourceText: '一行展示', expected: { maxLines: 1 }, checkStage: 'front', params: {} },
      ],
      overrides: [],
      unsupportedRequirements: [
        { id: 'ratio-conflict', sourceText: '4:3 vs 3:4', reason: 'conflict remains human-review' },
      ],
    },
  };
  assert.deepEqual(validateDesignSpec(profile.designSpec, 'sample'), []);
  const coverage = accountDesignRequirementCoverage(profile, [
    { id: 'design-truncation', status: 'deferred', detail: 'front unreachable' },
  ]);
  const byId = Object.fromEntries(coverage.map((row) => [row.id, row]));
  assert.equal(byId['layout-bands'].status, 'human-review');
  assert.equal(byId['layout-bands'].evidence, 'unsupported-or-manual');
  assert.equal(byId.truncation.status, 'deferred');
  assert.equal(byId.truncation.evidence, 'check');
  assert.equal(byId['ratio-conflict'].status, 'human-review');
  assert.ok(listUnsupportedDesignRequirements(profile).some((item) => item.id === 'layout-bands'));
});

test('47948 draft designSpec validates and keeps displayFieldTypes empty', () => {
  const profile = JSON.parse(readFileSync(new URL('../profiles/47948.json', import.meta.url), 'utf8'));
  assert.equal(profile.onboarding.status, 'draft-unreviewed');
  assert.deepEqual(profile.requirements.displayFieldTypes, []);
  assert.deepEqual(validateDesignSpec(profile.designSpec, '47948'), []);
  const coverage = accountDesignRequirementCoverage(profile, []);
  assert.ok(coverage.some((row) => row.id === 'custom-field-layout-bands' && row.status === 'human-review'));
  assert.ok(coverage.some((row) => row.id === 'image-ratio-conflict' && row.status === 'human-review'));
  assert.ok(coverage.some((row) => row.id === 'filter-field-supported-types'));
  assert.ok(!coverage.some((row) => /displayFieldTypes/.test(JSON.stringify(row)) && row.id === 'filter-field-supported-types' && row.status === 'pass'));
});
