import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchCapabilities, signatures } from '../src/capabilities/signatures.mjs';
import { inferDisplayFieldTypes, compareWithProfile } from '../src/probe-settings.mjs';
const sample = async (id) => JSON.parse(await readFile(new URL(`./fixtures/inventory-${id}.json`, import.meta.url)));
const ids = result => result.matched.map(m => m.id);
test('盘点样本按设置语义匹配', async () => {
  const a = ids(matchCapabilities(await sample('40838')));
  for (const id of ['pld-display-fields', 'pld-pagination', 'pld-compare', 'cff-fields', 'cff-logic', 'cff-trigger', 'cff-scope', 'cff-jump', 'btn-text', 'btn-url', 'btn-target']) assert.ok(a.includes(id), id);
  const b = ids(matchCapabilities(await sample('47748')));
  for (const id of ['product-category', 'cff-fields', 'pld-display-fields', 'pld-data-source']) assert.ok(b.includes(id), id);
});
test('缺少控件进入 absent，未知控件和弹窗保留', async () => {
  const inventory = await sample('40838');
  const gallery = inventory.find(r => r.title === '设置产品列表');
  gallery.controls = gallery.controls.filter(c => !(c.type === 'radio' && /^(是|否|关闭|开启)$/.test(c.label)));
  gallery.controls.push({ type: 'range', label: '陌生滑块', value: '2' });
  inventory.push({ type: 'unknown', wrapIndex: 0, title: '陌生弹窗', controls: [{ type: 'text', label: '陌生设置' }] });
  const result = matchCapabilities(inventory);
  assert.ok(result.absent.some(r => r.id === 'pld-pagination'));
  assert.ok(result.absent.some(r => r.id === 'pld-compare'));
  assert.ok(result.unrecognized.some(r => r.controls.some(c => c.label === '陌生滑块')));
  assert.ok(result.unrecognized.some(r => r.title === '陌生弹窗'));
});
test('展示字段类型只依据 CMS 可唯一核实的字段', () => {
  const controls = [{ type: 'checkbox', label: 'Brand', value: '-3' }, { type: 'checkbox', label: '颜色', value: '11' }, { type: 'checkbox', label: '型号', value: '12' }];
  const known = inferDisplayFieldTypes(controls, [{name:'颜色',type:'色卡'}, {name:'型号',type:'单选按钮'}]);
  assert.deepEqual(known.supportedTypes, ['单选按钮', '色卡']);
  assert.equal(known.fields[0].type, '色卡');
  assert.equal(inferDisplayFieldTypes(controls, []).supportedTypes, null);
  assert.equal(inferDisplayFieldTypes(controls, null).supportedTypes, null);
  assert.equal(inferDisplayFieldTypes(controls, [{name:'颜色',type:'色卡'}, {name:'颜色',type:'文本字段'}]).supportedTypes, null);
});
test('画像对比报告一致、不一致及无法比较', () => {
  const draft = {matched:[{parentModule:'example', title:'标题',wrapIndex:0}],displayFields:{supportedTypes:['色卡']}};
  const profile = {capabilities:[{id:'example',dialogTitle:'标题',wrapIndex:0}],fixture:{displayFields:{supportedTypes:['色卡']}}};
  assert.ok(compareWithProfile(draft,profile).comparisons.every(c=>c.status==='一致'));
  profile.capabilities[0].wrapIndex=1;
  assert.equal(compareWithProfile(draft,profile).comparisons.find(c=>c.subject.endsWith('wrapIndex')).status,'不一致');
  draft.displayFields.supportedTypes=null;
  assert.equal(compareWithProfile(draft,profile).comparisons.at(-1).status,'无法比较');
  assert.equal(compareWithProfile(draft,null).available,false);
});
test('规则不含样本区块 ID', async () => {
  const source = await readFile(new URL('../src/capabilities/signatures.mjs', import.meta.url),'utf8');
  assert.doesNotMatch(source,/40838|47748/);
  assert.ok(signatures.length);
});
test('隐藏输入、全选与重复副本不算未识别；系统属性按 id 结构排除', async () => {
  const inventory = await sample('40838');
  const result = matchCapabilities(inventory);
  assert.ok(!result.unrecognized.some(r => r.title === '设置产品列表'), '显示字段的重复副本应被认领');
  for (const region of result.unrecognized) {
    assert.ok(region.controls.every(c => c.type !== 'hidden' && !/^全选/.test(c.label || '')));
  }
  const gallery = inventory.find(r => r.title === '设置产品列表');
  const types = inferDisplayFieldTypes((await import('../src/capabilities/signatures.mjs')).displayFieldControls(gallery),
    [{ name: 'Model', type: '文本字段' }, ...[...new Set(gallery.controls.filter(c => c.type === 'checkbox' && !/^-/.test(c.value) && !/^全选/.test(c.label)).map(c => c.label))].map(name => ({ name, type: '单选按钮' }))]);
  assert.ok(types.fields.every(f => f.label !== 'Model'), '系统属性 Model 不参与，即使 CMS 有同名字段');
  assert.deepEqual(types.supportedTypes, ['单选按钮']);
});
test('每页数量不被当作产品总数量', async () => {
  const result = matchCapabilities(await sample('40838'));
  const count = result.matched.find(m => m.id === 'pld-product-count');
  assert.ok(!count || count.evidence.every(e => !/每页/.test(e.label)));
});
test('非产品区块（页头样本）不匹配任何能力，其设置全部列为未识别', async () => {
  const result = matchCapabilities(await sample('24864'));
  assert.equal(result.matched.length, 0);
  assert.equal(result.absent.length, signatures.length);
  assert.ok(result.unrecognized.some(r => /语言栏/.test(r.title || '')));
});
