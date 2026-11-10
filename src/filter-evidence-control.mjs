// Generic published control-change for filter evidence: a product-list
// setting unrelated to data-filterfields (default: per-page product count).
// Identity and values come from args, profile or fixture-state.
import { firstDefined } from './filter-evidence.mjs';

export function expectedPageCount(productCount, pageSize) {
  const count = Number(productCount);
  const size = Number(pageSize);
  if (!Number.isFinite(count) || count < 0 || !Number.isFinite(size) || size <= 0) {
    throw new Error('Product count must be >= 0 and page size must be > 0.');
  }
  return Math.ceil(count / size);
}

export function pageCountFromLabels(labels = []) {
  const numbers = labels
    .map((label) => Number(String(label || '').replace(/\s+/g, '')))
    .filter((value) => Number.isInteger(value) && value > 0);
  return numbers.length ? Math.max(...numbers) : 1;
}

export function readFrontPaginationFn() {
  return (root) => {
    const visible = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const containers = [...root.querySelectorAll('.pagination, .pager, [class*="pagination"], [class*="page-nav"]')].filter(visible);
    if (!containers.length) return { pageCount: 1, paginationVisible: false, labels: [] };
    const labels = [...containers[0].querySelectorAll('a, li, span, button')]
      .filter(visible)
      .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return { pageCount: pageCountFromLabels(labels), paginationVisible: true, labels };
  };
}

export function assessPublishedPageCount(actualPages, expectedPages) {
  const actual = Number(actualPages);
  const expected = Number(expectedPages);
  return {
    verified: Number.isFinite(actual) && Number.isFinite(expected) && actual === expected,
    actualPages: actual,
    expectedPages: expected,
  };
}

export function shouldRestoreControlChange({ runOk, force = false } = {}) {
  return Boolean(force) || runOk !== true;
}

function categoryNamesFromState(fixtureState) {
  return (fixtureState?.categories || []).flatMap((category) => [category.name, category.reuseName].filter(Boolean));
}

export function resolveControlChangePlan({ args = {}, profile = {}, fixtureState = null } = {}) {
  const cfg = profile.controlChange || profile.fixture?.controlChange || fixtureState?.controlChange || {};
  const field = String(firstDefined(args['control-field'], cfg.field, '每页产品数量'));
  const value = String(firstDefined(args['control-value'], cfg.value, ''));
  const productCount = firstDefined(args['control-product-count'], cfg.productCount);
  const expectedPages = firstDefined(args['control-expected-pages'], cfg.expectedPages,
    productCount != null && value !== '' ? expectedPageCount(productCount, value) : '');
  const dataSource = firstDefined(args['control-data-source'], cfg.dataSource, '选择部分产品分类');
  const categories = categoryNamesFromState(fixtureState);
  const category = firstDefined(args['control-category'], cfg.category, categories[0] || '');
  const pagination = firstDefined(args['control-pagination'], cfg.pagination, '是');
  if (!value) throw new Error('Control change needs --control-value or profile/fixture controlChange.value.');
  if (expectedPages === '' || expectedPages == null || Number.isNaN(Number(expectedPages))) {
    throw new Error('Control change needs --control-expected-pages or control-product-count to derive it.');
  }
  if (!/每页|产品数量/.test(field)) {
    throw new Error(`Control field must be a per-page product count setting, not a filter field (got ${field}).`);
  }
  return {
    kind: 'page-size',
    unrelatedToFilterfields: true,
    field,
    value: String(value),
    expectedPages: Number(expectedPages),
    productCount: productCount != null ? Number(productCount) : null,
    dataSource,
    category,
    categoryAliases: [...new Set([category, ...categories].filter(Boolean))],
    pagination,
  };
}

export function isPageSizeControl(item) {
  return ['text', 'number'].includes(item?.type)
    && /每页产品数量|显示产品总数量|^产品数量$/.test(String(item.label || '') + String(item.context || ''));
}

export function readListControlSnapshot(items) {
  const sizeHits = items.filter(isPageSizeControl);
  if (sizeHits.length !== 1) throw new Error(`Per-page product count control is not unique (${sizeHits.length}).`);
  const pagination = items.filter((item) => item.type === 'radio' && item.name === 'pagination' && item.checked);
  const dataSource = items.filter((item) => item.type === 'radio' && item.name === 'selectProdType' && item.checked);
  const categories = items.filter((item) => item.type === 'checkbox' && item.name === 'leafProdGroup' && item.checked)
    .map((item) => item.label);
  return {
    pageSize: String(sizeHits[0].value ?? ''),
    pagination: pagination[0]?.label || null,
    dataSource: dataSource[0]?.label || null,
    categories,
    pageSizeControl: sizeHits[0],
  };
}

export function listControlChanges(items, plan, { restore = false, original } = {}) {
  const changes = [];
  const snapshot = readListControlSnapshot(items);
  const goal = restore ? {
    pagination: original?.pagination,
    dataSource: original?.dataSource,
    categoryLabels: original?.categories || [],
    pageSize: original?.pageSize,
  } : {
    pagination: plan.pagination,
    dataSource: plan.dataSource,
    categoryLabels: null,
    pageSize: plan.value,
  };
  if (goal.pagination) {
    const target = items.filter((item) => item.type === 'radio' && item.name === 'pagination' && item.label === goal.pagination);
    if (target.length !== 1) throw new Error(`Pagination option “${goal.pagination}” is not unique.`);
    if (snapshot.pagination !== goal.pagination) changes.push({ control: target[0], value: true, role: 'pagination' });
  }
  if (goal.dataSource) {
    const target = items.filter((item) => item.type === 'radio' && item.name === 'selectProdType' && item.label === goal.dataSource);
    if (target.length !== 1) throw new Error(`Data-source option “${goal.dataSource}” is not unique.`);
    if (snapshot.dataSource !== goal.dataSource) changes.push({ control: target[0], value: true, role: 'dataSource' });
  }
  const cats = items.filter((item) => item.type === 'checkbox' && item.name === 'leafProdGroup');
  if (restore && Array.isArray(goal.categoryLabels)) {
    const wanted = new Set(goal.categoryLabels);
    for (const box of cats) {
      const shouldCheck = wanted.has(box.label);
      if (Boolean(box.checked) !== shouldCheck) changes.push({ control: box, value: shouldCheck, role: 'category' });
    }
  } else if (!restore && plan.category) {
    const aliases = new Set(plan.categoryAliases || [plan.category]);
    const wanted = cats.filter((item) => aliases.has(item.label?.trim()));
    if (wanted.length !== 1) throw new Error(`Control-change category is not unique among list checkboxes (${wanted.length}).`);
    for (const box of cats) {
      const shouldCheck = box === wanted[0];
      if (Boolean(box.checked) !== shouldCheck) changes.push({ control: box, value: shouldCheck, role: 'category' });
    }
  }
  const size = snapshot.pageSizeControl;
  if (String(size.value ?? '') !== String(goal.pageSize)) changes.push({ control: size, value: String(goal.pageSize), role: 'pageSize' });
  return changes;
}

export function controlChangeSnapshot(plan, original, extras = {}) {
  return {
    ...plan,
    original,
    applied: true,
    restoreAfterFront: true,
    ...extras,
  };
}

export async function applyListControlPlan(session, plan, { restore = false, original } = {}) {
  await session.open();
  const starting = readListControlSnapshot(await session.read());
  const roles = [['pagination', 'dataSource'], ['category'], ['pageSize']];
  const changed = [];
  for (const group of roles) {
    const items = await session.read();
    const changes = listControlChanges(items, plan, { restore, original }).filter((change) => group.includes(change.role));
    for (const change of changes) await session.set(change.control, change.value);
    if (changes.length) {
      await session.save();
      await session.open();
      changed.push(...changes.map((change) => change.role));
    }
  }
  const after = readListControlSnapshot(await session.read());
  await session.cancel();
  return { original: starting, after, changed };
}

export function assertControlPlanApplied(after, plan) {
  if (String(after.pageSize) !== String(plan.value)) throw new Error(`Per-page product count read-back is ${after.pageSize}, expected ${plan.value}.`);
  if (plan.pagination && after.pagination !== plan.pagination) throw new Error(`Pagination read-back is ${after.pagination}, expected ${plan.pagination}.`);
  if (plan.dataSource && after.dataSource !== plan.dataSource) throw new Error(`Data-source read-back is ${after.dataSource}, expected ${plan.dataSource}.`);
}

export function assertControlRestored(after, original) {
  if (String(after.pageSize) !== String(original.pageSize)) throw new Error(`Restored page size is ${after.pageSize}, expected ${original.pageSize}.`);
  if (original.pagination && after.pagination !== original.pagination) throw new Error(`Restored pagination is ${after.pagination}, expected ${original.pagination}.`);
  if (original.dataSource && after.dataSource !== original.dataSource) throw new Error(`Restored data source is ${after.dataSource}, expected ${original.dataSource}.`);
}
