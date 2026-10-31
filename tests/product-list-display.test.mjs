import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAllProducts } from '../src/capabilities/product-list-display.mjs';

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
