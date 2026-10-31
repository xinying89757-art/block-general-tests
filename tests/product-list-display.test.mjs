import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAllProducts, checkGroups, runListEffectPlan } from '../src/capabilities/product-list-display.mjs';
import { categorySelectionChanges } from '../src/capabilities/product-category-select.mjs';

const categoryBox = (index, label, checked = true) => ({ index, tag: 'INPUT', type: 'checkbox', name: 'leafProdGroup',
  label, context: label, value: 'on', checked, disabled: false, readOnly: false });

test('all-products assertion scopes membership to every AUTOTEST fixture and permits other site products', () => {
  const assessment = assessAllProducts({
    fixtureNames: ['AUTOTEST-A', 'AUTOTEST-B', 'AUTOTEST-C'],
    actualNames: ['Site product 1', 'AUTOTEST-A', 'AUTOTEST-B', 'AUTOTEST-C', 'Site product 2'],
    pagination: false,
    quantity: 100,
  });
  assert.equal(assessment.allFixturesPresent, true);
  assert.equal(assessment.countWithinQuantity, true);
  assert.equal(assessment.actualCount, 5);
  assert.equal(assessment.quantityMeaning, '显示产品总数量');
});

test('all-products assertion enforces the active per-page quantity ceiling', () => {
  const assessment = assessAllProducts({
    fixtureNames: ['AUTOTEST-A', 'AUTOTEST-B', 'AUTOTEST-C'],
    actualNames: ['AUTOTEST-A', 'AUTOTEST-B', 'AUTOTEST-C', 'Site product'],
    pagination: true,
    quantity: 3,
  });
  assert.equal(assessment.allFixturesPresent, true);
  assert.equal(assessment.countWithinQuantity, false);
  assert.equal(assessment.quantityMeaning, '每页产品数量');
});

test('all-products assertion fails when an AUTOTEST fixture product is missing', () => {
  const assessment = assessAllProducts({
    fixtureNames: ['AUTOTEST-A', 'AUTOTEST-B', 'AUTOTEST-C'],
    actualNames: ['AUTOTEST-A', 'AUTOTEST-B', 'Site product'],
    pagination: false,
    quantity: 100,
  });
  assert.equal(assessment.allFixturesPresent, false);
});

test('product-list backend checks can be isolated by check id', async () => {
  for (const id of ['pld-source-category-backend', 'pld-size-backend', 'pld-pagination-backend', 'pld-compare-backend']) {
    assert.deepEqual(checkGroups[id], ['backend']);
  }
  const called = [];
  const checks = await runListEffectPlan([
    { id: 'pld-source-category-backend', run: async () => { called.push('category'); return { id: 'pld-source-category-backend', status: 'pass' }; } },
    { id: 'pld-size-backend', run: async () => { called.push('size'); return { id: 'pld-size-backend', status: 'pass' }; } },
  ], { checkGroup: 'pld-source-category-backend' });
  assert.deepEqual(called, ['category']);
  assert.deepEqual(checks.map(({ id }) => id), ['pld-source-category-backend']);
});

test('product-list effect plan stops after environment timeout and marks later checks unexecuted', async () => {
  const called = [];
  const checks = await runListEffectPlan([
    { id: 'pld-source-category-backend', run: async () => {
      called.push('category'); return { id: 'pld-source-category-backend', status: 'env-timeout' };
    } },
    { id: 'pld-size-backend', run: async () => { called.push('size'); return { id: 'pld-size-backend', status: 'pass' }; } },
    { id: 'pld-pagination-backend', run: async () => { called.push('pagination'); return { id: 'pld-pagination-backend', status: 'pass' }; } },
  ]);
  assert.deepEqual(called, ['category']);
  assert.deepEqual(checks.map(({ status }) => status), ['env-timeout', 'env-timeout', 'env-timeout']);
  assert.equal(checks[1].evidence.notExecuted, true);
  assert.equal(checks[1].evidence.blockedByEnvironmentCheck, 'pld-source-category-backend');
});

test('product-list category selection plans one exact fixture checkbox across the full category list', () => {
  const controls = Array.from({ length: 100 }, (_, index) => categoryBox(index, `分类-${index}`, true));
  controls.push(categoryBox(100, 'AUTOTEST-筛选分类', true));
  const changes = categorySelectionChanges(controls, 'AUTOTEST-筛选分类');
  assert.equal(changes.length, 101);
  assert.equal(changes.filter(({ value }) => value).length, 1);
  assert.equal(changes.find(({ target }) => target.label === 'AUTOTEST-筛选分类').value, true);
  assert.equal(changes.filter(({ value }) => !value).length, 100);
});
