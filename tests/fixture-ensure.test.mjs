import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureFixtureData, fixturePlan, fixtureTypes, fixtureRecordPath } from '../src/fixture-data.mjs';
const profile = JSON.parse(readFileSync(new URL('../profiles/47748.json', import.meta.url)));
function mock() {
  const fields = new Map(), products = new Map(), categories = new Map(); let writes = 0;
  const api = {
    listCustomFields: async () => [...fields.values()].map(({name,type,status}) => ({name,type,status})),
    createCustomField: async (_, f) => { writes++; const v = { ...structuredClone(f), id: `f${fields.size}`, status: '开启' }; fields.set(f.name,v); return v; },
    updateCustomField: async (_, n, {missing,type}) => { writes++; const f=fields.get(n); f.type=type; f.status='开启'; f.options=[...new Set([...f.options,...missing])]; },
    readCustomFieldOptions: async (_, n) => fields.get(n).options,
    getCustomFieldIdentity: async (_, n) => fields.get(n),
    findCategory: async (_, n) => categories.get(n) || null,
    createCategory: async (_, n) => { writes++; const c={name:n,id:`c${categories.size}`}; categories.set(n,c); return c; },
    findProduct: async (_, n) => products.get(n)?.id || null,
    createProduct: async (_, p) => { writes++; const v={id:`p${products.size}`,values:{},categories:[]}; products.set(p.name,v); return v.id; },
    readProductFieldValues: async (_, id) => [...products.values()].find(p => p.id===id).values,
    setProductFieldValues: async (_, id, values) => { writes++; const p=[...products.values()].find(p => p.id===id); Object.assign(p.values,values); return p.values; },
    readProductCategories: async (_, id) => [...products.values()].find(p=>p.id===id).categories,
    addProductCategory: async (_, id, category) => { writes++; [...products.values()].find(p=>p.id===id).categories.push(category); },
  };
  return {api,fields,products,categories,get writes(){return writes;}};
}
test('fixture ensures union of required types, repairs drift, and is idempotent', async () => {
  const m=mock(); const plan=fixturePlan(profile); assert.deepEqual(new Set(plan.fields.map(f=>f.type)), new Set(profile.requirements.displayFieldTypes));
  const first=await ensureFixtureData({profile,cms:m.api}); const count=m.writes;
  const second=await ensureFixtureData({profile,cms:m.api,previous:first.records});
  assert.equal(m.writes,count); assert.deepEqual(second.writes,[]); assert.equal(second.previousMatches,true);
  m.fields.set('已有字段', { name: '已有字段', id: 'other-field', type: '文本字段', status: '关闭', options: ['原值'] });
  m.products.set('已有产品', { id: 'other-product', values: { '已有字段': '原值' }, categories: ['other-category'] });
  const untouched = structuredClone({field: m.fields.get('已有字段'), product: m.products.get('已有产品')});
  m.fields.get(plan.fields[0].name).options=[]; m.fields.get(plan.fields[0].name).status='关闭'; m.fields.get(plan.fields[0].name).type='下拉列表';
  m.products.get(plan.products[0].name).values[plan.fields[0].name]='wrong';
  m.products.get(plan.products[0].name).categories=[];
  const repaired=await ensureFixtureData({profile,cms:m.api});
  assert.equal(repaired.writes.length,3);
  assert.deepEqual({field: m.fields.get('已有字段'), product: m.products.get('已有产品')}, untouched); assert.deepEqual(m.fields.get(plan.fields[0].name).options,plan.fields[0].options);
  assert.equal(m.products.get(plan.products[0].name).values[plan.fields[0].name],plan.products[0].values[plan.fields[0].name]);
});
test('invalid non-AUTOTEST entities fail before CMS operations',async()=>{
  for (const mutate of [p=>p.fixture.category.name='normal',p=>p.fixture.products[0].name='normal',p=>p.fixture.fields[0].name='normal']) {
    const p=structuredClone(profile), m=mock(); mutate(p); await assert.rejects(ensureFixtureData({profile:p,cms:m.api})); assert.equal(m.writes,0);
  }
});
test('requirement types override legacy fallback and record is isolated by host and block',()=>{
  const p=structuredClone(profile); p.fixture.supportedTypes=['下拉列表']; assert.ok(fixtureTypes(p).types.includes('多选按钮'));
  delete p.requirements.displayFieldTypes; assert.equal(fixtureTypes(p).fallback,true);
  assert.notEqual(fixtureRecordPath({siteDomain:'https://a.example',blockId:'1'}),fixtureRecordPath({siteDomain:'https://a.example',blockId:'2'}));
  assert.notEqual(fixtureRecordPath({siteDomain:'https://a.example',blockId:'1'}),fixtureRecordPath({siteDomain:'https://b.example',blockId:'1'}));
});
