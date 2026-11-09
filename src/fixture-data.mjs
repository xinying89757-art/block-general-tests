import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { FIELD_TYPE_CODES } from './cms.mjs';

const auto = value => typeof value === 'string' && value.startsWith('AUTOTEST-') && value.length > 9;
const sameValue = (a, b) => Array.isArray(a) ? a.length === 1 && a[0] === b : a === b;
export function fixtureTypes(profile) {
  const fixture = profile.fixture || {};
  const filter = fixture.filterFieldTypes ?? fixture.fields?.map(f => f.type) ?? [];
  const requirements = profile.requirements?.displayFieldTypes;
  const fallback = !Array.isArray(requirements);
  const display = fallback ? fixture.supportedTypes || [] : requirements;
  return { types: [...new Set([...display, ...filter])], fallback };
}
export function fixturePlan(profile) {
  const fixture = profile.fixture;
  if (!fixture) throw new Error('缺少 fixture。');
  const { types, fallback } = fixtureTypes(profile);
  const candidates = [...(fixture.fields || []), ...(fixture.displayFields?.fields || [])];
  const fields = types.map(type => {
    if (FIELD_TYPE_CODES[type] === undefined) throw new Error(`未知字段类型：${type}`);
    const matches = candidates.filter(f => f.type === type);
    const names = [...new Set(matches.map(f => f.name))];
    if (names.length !== 1 || !auto(names[0])) throw new Error(`类型 ${type} 必须对应唯一 AUTOTEST 字段。`);
    const source = matches.find(f => Array.isArray(f.options) && f.options.length >= 2);
    if (!source || source.options.some(o => typeof o !== 'string' || !o)) throw new Error(`字段 ${names[0]} 缺少选项。`);
    return { name: names[0], type, options: source.options, typeCode: FIELD_TYPE_CODES[type] };
  });
  if (!auto(fixture.category?.name)) throw new Error('夹具分类名称必须以 AUTOTEST- 开头。');
  if (!Array.isArray(fixture.products) || fixture.products.some(p => !auto(p.name))) throw new Error('夹具产品名称必须以 AUTOTEST- 开头。');
  const products = fixture.products.map(p => ({ name: p.name, values: Object.fromEntries(fields.map(f => {
    const value = p.values?.[f.name] ?? fixture.displayFields?.fields?.find(d => d.name === f.name)?.values?.[p.name];
    if (!f.options.includes(value)) throw new Error(`产品 ${p.name} 的字段 ${f.name} 缺少夹具选项值。`);
    return [f.name, value];
  })) }));
  return { fields, products, category: fixture.category, fallback };
}
// Resolve names on every run; a record is a cache of verified identities, not authority.
export async function ensureFixtureData({ page, profile, cms, previous = null }) {
  const plan = fixturePlan(profile), records = { fields: {}, products: {}, category: null }, writes = [];
  let step = '列出现有自定义字段';
  const atStep = (name) => { step = name; };
  const attachStep = (error) => { error.fixtureStep ||= step; error.fixtureProgress = { records, writes }; throw error; };
  try {
  const existing = await cms.listCustomFields(page);
  for (const field of plan.fields) {
    const hits = existing.filter(f => f.name === field.name);
    if (hits.length > 1) throw new Error(`字段 ${field.name} 重名。`);
    let found = hits[0];
    if (!found) { atStep(`创建字段 ${field.name}`); found = await cms.createCustomField(page, field); writes.push(`create-field:${field.name}`); }
    else {
      atStep(`核对字段 ${field.name} 选项`);
      const options = found.type === field.type ? await cms.readCustomFieldOptions(page, field.name) : [];
      const missing = field.options.filter(o => !options.includes(o));
      if (found.status !== '开启' || missing.length || found.type !== field.type) { atStep(`更新字段 ${field.name}`); await cms.updateCustomField(page, field.name, { missing, type: field.type, enable: found.status !== '开启' }); writes.push(`update-field:${field.name}`); }
    }
    atStep(`回读字段 ${field.name} 身份`);
    const verified = await cms.getCustomFieldIdentity(page, field.name);
    if (!verified?.id || verified.type !== field.type || verified.status !== '开启') throw new Error(`字段 ${field.name} 身份/类型/状态回读失败。`);
    atStep(`回读字段 ${field.name} 选项`);
    const options = await cms.readCustomFieldOptions(page, field.name);
    if (field.options.some(o => !options.includes(o))) throw new Error(`字段 ${field.name} 选项回读失败。`);
    records.fields[field.name] = verified.id;
  }
  // A site may be unable to host a new category (Leadong category limit).
  // Then category-scoped checks are skipped with this reason; fields and
  // products are still ensured. Never borrow an existing site category.
  let verifiedCategory = null;
  atStep(`查找分类 ${plan.category.name}`);
  let category = await cms.findCategory(page, plan.category.name);
  if (!category) {
    try { atStep(`创建分类 ${plan.category.name}`); category = await cms.createCategory(page, plan.category.name); writes.push(`create-category:${plan.category.name}`); }
    catch (error) {
      if (!(cms.CategoryLimitError && error instanceof cms.CategoryLimitError) && error?.code !== 'CATEGORY_LIMIT') throw error;
      records.category = { name: plan.category.name, id: null, unavailable: error.message };
    }
  }
  if (category) {
    atStep(`回读分类 ${plan.category.name}`);
    verifiedCategory = await cms.findCategory(page, plan.category.name);
    if (!verifiedCategory?.id || verifiedCategory.id !== category.id) throw new Error('夹具分类身份回读失败。');
    records.category = { name: plan.category.name, id: verifiedCategory.id };
  }
  for (const product of plan.products) {
    atStep(`查找产品 ${product.name}`);
    let id = await cms.findProduct(page, product.name);
    if (!id) { atStep(`创建产品 ${product.name}`); id = await cms.createProduct(page, product); writes.push(`create-product:${product.name}`); }
    atStep(`回读产品 ${product.name} 身份`);
    if (!id || await cms.findProduct(page, product.name) !== id) throw new Error(`产品 ${product.name} 身份回读失败。`);
    const actual = await cms.readProductFieldValues(page, id, Object.keys(product.values));
    const changed = Object.fromEntries(Object.entries(product.values).filter(([name, value]) => !sameValue(actual[name], value)));
    if (Object.keys(changed).length) { atStep(`更新产品 ${product.name} 字段值`); const updated = await cms.setProductFieldValues(page, id, changed); if (Object.entries(changed).some(([n,v]) => !sameValue(updated[n],v))) throw new Error(`产品 ${product.name} 字段回读失败。`); writes.push(`update-product:${product.name}`); }
    if (verifiedCategory) {
    atStep(`回读产品 ${product.name} 分类`);
    const categories = await cms.readProductCategories(page, id);
    if (!categories.includes(verifiedCategory.id)) { atStep(`为产品 ${product.name} 添加分类`); await cms.addProductCategory(page, id, verifiedCategory.id, plan.category.name); writes.push(`category-product:${product.name}`); }
    atStep(`确认产品 ${product.name} 分类`);
    if (!(await cms.readProductCategories(page, id)).includes(verifiedCategory.id)) throw new Error(`产品 ${product.name} 分类回读失败。`);
    }
    records.products[product.name] = id;
  }
  return { plan, records, writes, previousMatches: previous ? JSON.stringify(previous) === JSON.stringify(records) : null };
  } catch (error) { attachStep(error); }
}
export function fixtureRecordPath(config, root = 'fixtures-state') {
  const host = new URL(/^https?:\/\//i.test(config.siteDomain) ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
  if (!host || !config.blockId) throw new Error('夹具记录需要站点 host 与区块 ID。');
  return path.join(root, `${createHash('sha256').update(`${host}\0${config.blockId}`).digest('hex')}.json`);
}
export async function readFixtureRecord(config) {
  try { return JSON.parse(await readFile(fixtureRecordPath(config), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function writeFixtureRecord(config, records) {
  const file = fixtureRecordPath(config); await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(records, null, 2), { mode: 0o600 }); await rename(tmp, file);
}
