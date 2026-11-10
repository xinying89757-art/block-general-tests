// Swappable fixture-data operations. The default adapter talks to the CMS UI;
// a later API adapter can implement the same snapshot/mutate methods.
import { PRODUCT_FLAG_VALUES } from './fixture-state.mjs';

function sameValue(expected, actual) {
  if (Array.isArray(expected)) {
    const got = Array.isArray(actual) ? actual : actual == null || actual === '' ? [] : [actual];
    return expected.length === got.length && expected.every((value) => got.includes(value));
  }
  if ((expected == null || expected === '') && (actual == null || actual === '' || (Array.isArray(actual) && !actual.length))) return true;
  return Array.isArray(actual) ? actual.length === 1 && actual[0] === expected : actual === expected;
}

function entry(kind, id, name, field, expected, actual, message) {
  return { kind, id: id || null, name, field, expected, actual, message };
}

export function diffFixtureState(state, observed) {
  const diff = [];
  const fields = observed.fields || {};
  const products = observed.products || {};
  const categories = observed.categories || {};
  for (const field of state.fields || []) {
    if (!field.id) {
      diff.push(entry('field-missing-id', null, field.name, 'id', field.id, null, `Field ${field.name} has no recorded id.`));
      continue;
    }
    const got = fields[field.id];
    if (!got) {
      diff.push(entry('field-missing', field.id, field.name, 'id', field.id, null, `Field id ${field.id} (${field.name}) was not found.`));
      continue;
    }
    if (got.name && got.name !== field.name) diff.push(entry('field-name', field.id, field.name, 'name', field.name, got.name, 'Field name drifted.'));
    if (got.type && got.type !== field.type) diff.push(entry('field-type', field.id, field.name, 'type', field.type, got.type, 'Field type drifted.'));
    const expectedOptions = (field.options || []).map((option) => (typeof option === 'string' ? option : option.value)).filter(Boolean);
    if (expectedOptions.length && Array.isArray(got.options)) {
      const missing = expectedOptions.filter((value) => !got.options.includes(value));
      if (missing.length) diff.push(entry('field-options', field.id, field.name, 'options', expectedOptions, got.options, `Missing options: ${missing.join(', ')}`));
    }
  }
  for (const category of state.categories || []) {
    if (!category.id) {
      diff.push(entry('category-missing-id', null, category.name, 'id', category.id, null, `Category ${category.name} has no recorded id.`));
      continue;
    }
    const got = categories[category.id];
    if (!got) diff.push(entry('category-missing', category.id, category.name, 'id', category.id, null, `Category id ${category.id} was not found.`));
    else if (got.name && got.name !== category.name && got.name !== category.reuseName) {
      diff.push(entry('category-name', category.id, category.name, 'name', category.name, got.name, 'Category name drifted.'));
    }
  }
  for (const product of state.products || []) {
    if (!product.id) {
      diff.push(entry('product-missing-id', null, product.name, 'id', product.id, null, `Product ${product.name} has no recorded id.`));
      continue;
    }
    const got = products[product.id];
    if (!got) {
      diff.push(entry('product-missing', product.id, product.name, 'id', product.id, null, `Product id ${product.id} was not found.`));
      continue;
    }
    if (got.name && got.name !== product.name) diff.push(entry('product-name', product.id, product.name, 'name', product.name, got.name, 'Product name drifted.'));
    for (const [fieldName, expected] of Object.entries(product.values || {})) {
      if (!sameValue(expected, got.values?.[fieldName])) {
        diff.push(entry('product-value', product.id, product.name, fieldName, expected, got.values?.[fieldName], `Product field ${fieldName} drifted.`));
      }
    }
    const expectedFlags = [...(product.flags || [])].sort();
    if (got.flags) {
      const actualFlags = [...got.flags].sort();
      if (expectedFlags.join() !== actualFlags.join()) {
        diff.push(entry('product-flags', product.id, product.name, 'flags', expectedFlags, actualFlags, 'Product flags drifted.'));
      }
    }
  }
  for (const extra of observed.unexpectedAutotestFields || []) {
    diff.push(entry('unexpected-field', extra.id, extra.name, 'name', null, extra.name, 'Leftover AUTOTEST field is not in fixture-state.'));
  }
  return diff;
}

export function structuredFixtureDiffError(diff, extra = {}) {
  const error = new Error(`Fixture data drifted (${diff.length} change${diff.length === 1 ? '' : 's'}). Auto-repair is disabled.`);
  error.diff = diff;
  error.code = 'FIXTURE_DRIFT';
  Object.assign(error, extra);
  return error;
}

export function leftoverAutotestFields(inventory = [], state) {
  const known = new Set((state.fields || []).map((field) => field.name));
  const leftovers = [];
  for (const item of inventory) {
    if (!String(item.name || '').startsWith('AUTOTEST-')) continue;
    if (known.has(item.name)) continue;
    const sibling = [...known].find((name) => item.name.startsWith(name) || name.startsWith(item.name));
    leftovers.push({ ...item, likelyDuplicateOf: sibling || null });
  }
  return leftovers;
}

export function createFixtureDataOps(adapter) {
  if (!adapter || typeof adapter.snapshotById !== 'function') {
    throw new Error('createFixtureDataOps requires an adapter with snapshotById(state).');
  }

  async function checkFixtureData(state) {
    const observed = await adapter.snapshotById(state);
    const diff = diffFixtureState(state, observed);
    const result = {
      ok: diff.length === 0,
      diff,
      observed,
      lastCheckedAt: new Date().toISOString(),
      repaired: false,
    };
    if (!result.ok) {
      const error = structuredFixtureDiffError(diff, { result });
      throw error;
    }
    return result;
  }

  async function prepareFixtureData(state, { apply = false, dedupe = false, resume = {}, fieldLimit, categoryLimit } = {}) {
    if (typeof adapter.prepare !== 'function') {
      throw new Error('This adapter cannot prepare fixture data.');
    }
    return adapter.prepare(state, { apply, dedupe, resume, fieldLimit, categoryLimit, leftoverAutotestFields });
  }

  return { checkFixtureData, prepareFixtureData, diffFixtureState, leftoverAutotestFields };
}

export function createMemoryFixtureAdapter({ observed, inventory = [], limits = {} } = {}) {
  return {
    async readFieldLimit() {
      return { max: limits.fieldLimit ?? null, used: inventory.length, source: limits.fieldLimit == null ? 'unknown' : 'adapter' };
    },
    async snapshotById(state) {
      if (typeof observed === 'function') return observed(state);
      return { ...observed, unexpectedAutotestFields: leftoverAutotestFields(inventory, state) };
    },
    async listFields() { return inventory; },
    async prepare(state, options) {
      const leftovers = leftoverAutotestFields(inventory, state);
      const report = {
        ok: true,
        apply: Boolean(options.apply),
        dedupe: leftovers,
        dedupeApplied: Boolean(options.apply && options.dedupe && leftovers.length),
        fieldLimit: options.fieldLimit ?? limits.fieldLimit ?? null,
        categoryLimit: options.categoryLimit ?? limits.categoryLimit ?? null,
        writes: [],
        resume: options.resume || {},
      };
      if (options.dedupe && leftovers.length && !options.apply) {
        report.ok = true;
        report.message = 'Duplicate AUTOTEST fields were reported only; pass --apply to change anything.';
      }
      return report;
    },
  };
}

export const FLAG_VALUES = PRODUCT_FLAG_VALUES;

export function createCmsFixtureAdapter(page, cms) {
  return {
    async readFieldLimit() {
      return cms.readCustomFieldLimit(page);
    },
    async snapshotById(state) {
      const listed = await cms.listCustomFields(page);
      const fields = {};
      for (const field of state.fields || []) {
        const hit = listed.find((item) => (field.id && item.id === field.id) || item.name === field.name);
        if (!hit) continue;
        const enumerated = field.kind === 'dropdown' || field.kind === 'radio' || field.kind === 'multi';
        const options = enumerated ? await cms.readCustomFieldOptions(page, hit.name) : [];
        fields[field.id || hit.id] = { id: hit.id, name: hit.name, type: hit.type, options };
      }
      const products = {};
      for (const product of state.products || []) {
        const id = product.id || await cms.findProduct(page, product.name);
        if (!id) continue;
        const values = await cms.readProductFieldValues(page, id, Object.keys(product.values || {}));
        products[product.id || id] = { id, name: product.name, values };
      }
      const categories = {};
      for (const category of state.categories || []) {
        const found = await cms.findCategory(page, category.name)
          || (category.reuseName ? await cms.findCategory(page, category.reuseName) : null);
        if (found) categories[category.id || found.id] = { id: found.id, name: found.name };
      }
      return { fields, products, categories, unexpectedAutotestFields: leftoverAutotestFields(listed, state) };
    },
  };
}
