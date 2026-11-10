import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadFixtureSpec, loadFilterChecklistDraft, fixtureStateFromSpec, validateFixtureState,
  listFilterExpectations, assertEmptyExpectedSupported, extractRecordOnlyItems,
  expandSpecFields,
} from '../src/fixture-state.mjs';
import { createFixtureDataOps, createMemoryFixtureAdapter, leftoverAutotestFields, diffFixtureState } from '../src/fixture-data-ops.mjs';
import { evaluateFilterRequirement, filterRequirementFlags } from '../src/filter-evidence.mjs';
import { fixtureScenarioPolicy } from '../src/capabilities/custom-filter-fields.mjs';
import { parseCustomFieldLimitText } from '../src/cms.mjs';
import { DESIGN_CHECK_TYPES } from '../src/design-spec-model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const localSpec = path.join(here, 'fixtures/dodo/fixture-spec-draft.json');
const localChecklist = path.join(here, 'fixtures/dodo/filter-checklist-draft.json');
const liveDir = '/workspace/47948/checklist';

function draftPath(name, fallback) {
  const live = path.join(liveDir, name);
  return fs.existsSync(live) ? live : fallback;
}

function sampleState(spec, extra = {}) {
  return fixtureStateFromSpec(spec, {
    records: {},
    site: { domain: 'example.test', siteId: 'site-1', credentialConfig: { kind: 'env-file', path: '.run.env' } },
    blocks: { 'block-1': { blockId: 'block-1', settingId: 'setting-1', page: { id: 'page-1', url: '/products.html', kind: 'system' } }, ...extra.blocks },
    fieldLimit: extra.fieldLimit,
  });
}

test('loaders consume both Dodo drafts as-is', () => {
  const specPath = draftPath('fixture-spec-draft.json', localSpec);
  const checklistPath = draftPath('filter-checklist-draft.json', localChecklist);
  const spec = loadFixtureSpec(specPath);
  const checklist = loadFilterChecklistDraft(checklistPath);
  assert.equal(spec.kind, 'fixture-spec');
  assert.ok(spec.products.every((product) => product.flags == null || Array.isArray(product.flags)));
  const empty = assertEmptyExpectedSupported(listFilterExpectations(spec));
  assert.ok(empty.some((item) => item.key.includes('下拉=B') && item.key.includes('多选=B')));
  assert.ok(spec.deferred.includes('筛选范围=当前分类产品'));
  assert.equal(spec.expectedBySetting.filter['任意筛选'].status, '暂缓');
  const text = listFilterExpectations(spec).find((item) => item.key === '文本=A');
  assert.equal(Boolean(text.pending), false);
  assert.match(String(text.rule || text.expected?.rule || ''), /完全一致/);
  assert.equal(expandSpecFields(spec.fields).filter((field) => field.role === 'display').length, 7);
  assert.ok((spec.decisions || []).some((item) => /文本字段匹配/.test(item.topic) && /已确认/.test(item.decision)));

  assert.equal(checklist.requirements.length, 14);
  assert.deepEqual(checklist.requirements.find((item) => item.id === 'filter-combine-logic').cases['下拉=B 且 多选=B'], []);
  assert.equal(checklist.requirements.find((item) => item.id === 'filter-column-sync').status, '暂缓');
  assert.equal(checklist.requirements.find((item) => item.id === 'filter-scope-current-category').status, '暂缓');
  assert.equal(checklist.requirements.find((item) => item.id === 'filter-type-text').status, '已确认');
  const mobile = checklist.requirements.find((item) => item.id === 'filter-mobile-layout');
  for (const key of ['filtersToggleButton', 'filterGroupsSingleColumn', 'productCountShown', 'pagination', 'cardsSingleColumn']) {
    assert.equal(mobile.expected[key], true);
  }
  assert.ok(DESIGN_CHECK_TYPES.includes('filter-oracle'));
  assert.ok(DESIGN_CHECK_TYPES.includes('filter-interaction'));
  assert.ok(DESIGN_CHECK_TYPES.includes('filter-layout'));
  for (const item of checklist.requirements) {
    assert.ok(DESIGN_CHECK_TYPES.includes(item.checkType), item.checkType);
  }
});

test('fixture-state carries flags, empty expected sets, and a credential pointer only', () => {
  const spec = loadFixtureSpec(localSpec);
  const state = sampleState(spec);
  assert.equal(validateFixtureState(state).length, 0);
  assert.equal(state.site.credentialConfig.kind, 'env-file');
  assert.ok(!JSON.stringify(state).includes('password'));
  assert.ok(state.products.every((product) => Array.isArray(product.flags)));
  const empty = listFilterExpectations(state).find((item) => item.key.includes('下拉=B') && item.key.includes('多选=B'));
  assert.deepEqual(empty.expected, []);
  assert.equal(state.textMatch.mode, 'exact');
  assert.equal(state.textMatch.status, 'confirmed');
  assert.ok(state.categories.length >= 2);
  assert.equal(state.partialProducts.length, 3);
  assert.ok(state.fields.some((field) => field.kind === 'multi' && field.options.some((option) => option.value.endsWith('-C'))));
});

test('checkFixtureData reports a structured diff and never auto-repairs', async () => {
  const spec = loadFixtureSpec(localSpec);
  const state = sampleState(spec);
  state.fields[0].id = 'field-dropdown';
  const observed = {
    fields: { 'field-dropdown': { id: 'field-dropdown', name: 'AUTOTEST-other', type: state.fields[0].type, options: state.fields[0].options.map((option) => option.value) } },
    products: {},
    categories: {},
  };
  const ops = createFixtureDataOps(createMemoryFixtureAdapter({ observed, inventory: [{ id: 'x', name: 'AUTOTEST-单选按钮A' }] }));
  await assert.rejects(() => ops.checkFixtureData(state), (error) => {
    assert.equal(error.code, 'FIXTURE_DRIFT');
    assert.ok(Array.isArray(error.diff) && error.diff.length > 0);
    assert.equal(error.result.repaired, false);
    return /never auto-repair|Auto-repair is disabled/i.test(error.message);
  });
  const leftovers = leftoverAutotestFields([{ id: 'x', name: 'AUTOTEST-单选按钮A' }], state);
  assert.equal(leftovers[0].likelyDuplicateOf, 'AUTOTEST-单选按钮');
  const clean = diffFixtureState({ fields: [], categories: [], products: [] }, { fields: {}, categories: {}, products: {} });
  assert.deepEqual(clean, []);
});

test('offline baseline command writes fixture-state from a spec and existing records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-baseline-'));
  const out = path.join(dir, 'fixture-state.json');
  const inventory = path.join(dir, 'inventory.json');
  fs.writeFileSync(inventory, JSON.stringify([{ id: 'dup', name: 'AUTOTEST-多选' }, { id: 'ok', name: 'AUTOTEST-下拉列表' }]));
  const report = path.join(dir, 'existing.json');
  fs.writeFileSync(report, JSON.stringify({
    siteHost: 'example.test',
    siteId: 'site-1',
    blockId: 'block-1',
    page: { kind: 'system', id: 'page-1', url: '/products.html', name: 'Products' },
    settingId: 'setting-1',
    fixture: { records: { fields: { 'AUTOTEST-下拉列表': 'id-drop' }, products: {}, category: { name: 'AUTOTEST-筛选分类', id: 'id-cat-a' } } },
  }));
  const result = spawnSync(process.execPath, ['scripts/fixture-baseline.mjs',
    '--spec', localSpec, '--from-existing', report, '--dedupe', '--inventory', inventory,
    '--site-host', 'example.test', '--site-id', 'site-1', '--block', 'block-1',
    '--setting-id', 'setting-1', '--page-id', 'page-1', '--page-url', '/products.html',
    '--out', out, '--field-limit', '8'], { cwd: path.join(here, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.leftovers, 1);
  assert.equal(summary.dedupeAction, 'reported-only');
  assert.ok(summary.omittedDisplayFields.length > 0);
  const state = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(validateFixtureState(state).length, 0);
  assert.equal(state.fields[0].id, 'miUAfKegLmIn');
  assert.equal(state.fieldLimitReport.maxFields, 8);
  assert.equal(state.fieldLimitReport.source, 'cli');
  assert.ok(state.fieldLimitReport.shortfall > 0);
  assert.equal(state.fieldLimitReport.requestedDisplayFields, state.fieldLimitReport.plannedDisplayFields + state.fieldLimitReport.shortfall);
});

test('parseCustomFieldLimitText reads a stated max and fixture-state records a shortfall instead of failing', () => {
  assert.deepEqual(parseCustomFieldLimitText('最多可以添加 20 个自定义字段'), { max: 20, used: null, source: '最多可以添加 20 个自定义字段' });
  assert.deepEqual(parseCustomFieldLimitText('已添加 18 / 20'), { max: 20, used: 18, source: '已添加 18 / 20' });
  assert.equal(parseCustomFieldLimitText('no limit stated').max, null);
  const spec = loadFixtureSpec(localSpec);
  const state = sampleState(spec, { fieldLimit: 5 });
  // 4 filter fields leave at most 1 display slot; never throw
  assert.equal(state.fieldLimitReport.maxFields, 5);
  assert.ok(state.fieldLimitReport.shortfall >= 6);
  assert.equal(state.fields.filter((field) => field.role === 'display').length, state.fieldLimitReport.plannedDisplayFields);
  assert.equal(validateFixtureState(state).length, 0);
});


test('fixed 交集 policy asserts intersection and marks union as not applicable', () => {
  const profile = {
    fixture: {
      filterSettingsFixed: { 筛选逻辑: '交集', 筛选方式: '更改筛选项后自动筛选', 筛选范围: '当前分类产品' },
      category: { name: 'AUTOTEST-分类A' },
    },
  };
  assert.deepEqual(fixtureScenarioPolicy(profile, false), {
    logic: '交集', trigger: '更改筛选项后自动筛选', scope: '当前分类产品',
  });
  assert.match(fixtureScenarioPolicy(profile, true).na, /并集/);
});

test('filter requirement evaluation covers empty sets, 暂缓, pending text match, and mobile checks', () => {
  const checklist = loadFilterChecklistDraft(localChecklist);
  const deferred = checklist.requirements.find((item) => item.id === 'filter-column-sync');
  assert.equal(filterRequirementFlags(deferred).deferred, true);
  assert.equal(evaluateFilterRequirement(deferred).status, 'record');
  const combine = checklist.requirements.find((item) => item.id === 'filter-combine-logic');
  const miss = evaluateFilterRequirement(combine, { cases: { '下拉=A 且 单选=A': ['基准'], '四字段都=A': ['基准'], '多选=A 或 B': ['基准'], '下拉=B 且 多选=B': ['基准'] } });
  assert.equal(miss.status, 'fail');
  const hit = evaluateFilterRequirement(combine, { cases: {
    '下拉=A 且 单选=A': ['基准', '翻转3', '翻转4'],
    '四字段都=A': ['基准'],
    '多选=A 或 B': ['基准', '翻转1', '翻转2', '翻转3', '翻转4'],
    '下拉=B 且 多选=B': [],
  } });
  assert.equal(hit.status, 'pass');
  const text = checklist.requirements.find((item) => item.id === 'filter-type-text');
  const textResult = evaluateFilterRequirement(text, { oracle: { 'filter-type-text': ['基准', '翻转1', '翻转2', '翻转3'] } });
  assert.equal(textResult.status, 'pass');
  assert.equal(Boolean(textResult.pendingTextMatch), false);
  const pending = evaluateFilterRequirement({ ...text, status: '部分待确认', note: '完全一致还是包含匹配待确认' },
    { oracle: { 'filter-type-text': ['基准', '翻转1', '翻转2', '翻转3'] } });
  assert.equal(pending.status, 'pass');
  assert.equal(pending.pendingTextMatch, true);
  const mobile = checklist.requirements.find((item) => item.id === 'filter-mobile-layout');
  const mobileResult = evaluateFilterRequirement(mobile, { mobile: {
    filtersToggleButton: true, filterGroupsSingleColumn: true, productCountShown: true,
    pagination: true, cardsSingleColumn: true, noHorizontalOverflowAt375: true,
  } });
  assert.equal(mobileResult.status, 'pass');
});
