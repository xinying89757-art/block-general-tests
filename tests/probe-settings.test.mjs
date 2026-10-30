import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchCapabilities, signatures } from '../src/capabilities/signatures.mjs';
import { displayFieldRequirements } from '../src/capabilities/product-list-display.mjs';
import { checkRequirements, compareWithProfile, checkDisplayFieldRequirement } from '../src/probe-settings.mjs';
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
test('需求定位只认领指定项，缺失记问题并保留其余控件', async () => {
  const inventory = await sample('40838');
  const result = checkRequirements(inventory, { capabilities: [{ id: 'btn-text' }, { id: 'product-category' }] });
  assert.equal(result.requirementCheck[0].status, 'located');
  assert.equal(result.requirementCheck[0].location.type, 'phoenix_blocks_button');
  assert.ok(result.requirementCheck[0].evidence.length);
  assert.equal(result.requirementCheck[1].status, 'missing');
  assert.ok(result.outOfScope.some(r => r.title === '设置产品列表'));
  assert.ok(result.outOfScope.some(r => r.controls.some(c => c.label === '链接网址')));
  const empty = checkRequirements(inventory, null);
  assert.equal(empty.requirementMessage, '需求未提供，需人工补充');
  assert.equal(empty.requirementCheck.length, 0);
  assert.ok(empty.outOfScope.some(r => r.title === '设置产品列表' && r.controls.some(c => /^全选/.test(c.label || ''))));
});
test('需求位置参数约束标题与序号，画像比较使用定位结果', async () => {
  const inventory = await sample('47748');
  const requirements = { capabilities: [{ id: 'pld-data-source', params: { dialogTitle: '设置与选取数据', wrapIndex: 1 } }] };
  const draft = checkRequirements(inventory, requirements);
  assert.equal(draft.requirementCheck[0].status, 'located');
  const profile = { capabilities: [{ id: 'product-list-display', dialogTitle: '设置与选取数据', wrapIndex: 1 }] };
  assert.ok(compareWithProfile(draft, profile).comparisons.every(c => c.status === '一致'));
  profile.capabilities[0].wrapIndex = 0;
  assert.equal(compareWithProfile(draft, profile).comparisons.find(c => c.subject.endsWith('wrapIndex')).status, '不一致');
  requirements.capabilities[0].params.wrapIndex = 0;
  assert.equal(checkRequirements(inventory, requirements).requirementCheck[0].status, 'missing');
  assert.equal(compareWithProfile({ requirementCheck: [] }, profile).comparisons[0].status, '无法比较');
  assert.equal(compareWithProfile(draft, null).available, false);
});
test('规则不含样本区块 ID', async () => {
  const source = await readFile(new URL('../src/capabilities/signatures.mjs', import.meta.url),'utf8');
  assert.doesNotMatch(source,/40838|47748/);
  assert.ok(signatures.length);
});
test('隐藏输入与重复副本不算未认领；显示字段全选由需求认领', async () => {
  const inventory = await sample('40838');
  const result = matchCapabilities(inventory);
  assert.ok(!result.unrecognized.some(r => r.title === '设置产品列表'), '显示字段的重复副本应被认领');
  for (const region of result.unrecognized) {
    assert.ok(region.controls.every(c => c.type !== 'hidden'));
  }

});
test('数量依赖分页，两种分页状态均双匹配；无分页时按标签', async () => {
  const inventory = await sample('40838');
  const gallery = inventory.find(r => r.title === '设置产品列表');
  for (const value of ['是', '否']) {
    for (const c of gallery.controls.filter(c => c.name === 'pagination')) c.checked = c.label === value;
    const matches = matchCapabilities(inventory).matched.filter(m => ['pld-page-size','pld-product-count'].includes(m.id));
    assert.equal(matches.length, 2);
    for (const m of matches) {
      assert.equal(m.dependsOn.currentValue, value);
      assert.equal(m.dependsOn.effectiveMeaning, value === '是' ? '每页数量' : '产品总数量');
      assert.equal(m.evidence.length, 3);
    }
  }
  gallery.controls = gallery.controls.filter(c => c.name !== 'pagination');
  assert.ok(ids(matchCapabilities(inventory)).includes('pld-page-size'));
  assert.ok(!ids(matchCapabilities(inventory)).includes('pld-product-count'));
  gallery.controls.find(c => c.type === 'text' && /数量/.test(c.context)).context = '显示产品总数量';
  assert.ok(ids(matchCapabilities(inventory)).includes('pld-product-count'));
  assert.ok(!ids(matchCapabilities(inventory)).includes('pld-page-size'));
});
test('右侧面板匹配，未知图标保留', () => {
  const result = matchCapabilities([
    {kind:'right-panel',type:'rail:color-scheme',controls:[{type:'color',label:'配色',value:'#fff'}]},
    {kind:'right-panel',type:'rail:module-width',controls:[{type:'value',label:'宽度',value:1440}]},
    {kind:'rail-icon',type:'rail:icon',title:'陌生图标',controls:[{type:'icon',label:'陌生图标'}]},
  ]);
  assert.ok(ids(result).includes('color-scheme'));
  assert.ok(ids(result).includes('module-width'));
  assert.equal(result.unrecognized[0].kind, 'rail-icon');
});
test('展示字段类型只按指定弹窗中的 AUTOTEST 夹具核对', () => {
  const profile = { requirements: { displayFieldTypes: ['单选', '多选'] }, fixture: { displayFields: { fields: [{ name: 'AUTOTEST-单选', type: '单选' }] } } };
  const group = [{ type: 'checkbox', label: '全选' }, { type: 'checkbox', label: 'Brand', value: '-3' }, { type: 'checkbox', label: 'AUTOTEST-单选', value: '1', disabled: false }];
  const inventory = [{ type: 'phoenix_blocks_gallery', title: '设置产品列表', controls: group }];
  let result = checkDisplayFieldRequirement(inventory, profile);
  assert.equal(result.status, 'unknown');
  assert.equal(result.types[0].status, 'ok');
  assert.match(result.types[1].message, /夹具缺该类型/);
  profile.fixture.displayFields.fields.push({ name: 'AUTOTEST-多选', type: '多选' });
  result = checkDisplayFieldRequirement(inventory, profile);
  assert.match(result.types[1].message, /fixture 准备/);
  group.push({ type: 'checkbox', label: 'AUTOTEST-多选', value: '2', disabled: true });
  assert.equal(checkDisplayFieldRequirement(inventory, profile).status, 'problem');
  group.at(-1).disabled = false;
  assert.equal(checkDisplayFieldRequirement(inventory, profile).status, 'ok');
  inventory[0].title = '设置与选取数据';
  assert.equal(checkDisplayFieldRequirement(inventory, profile).status, 'unknown');
  assert.equal(checkDisplayFieldRequirement(inventory, {}).status, 'missing-requirement');
});
test('非产品区块（页头样本）不匹配任何能力，其设置全部列为未识别', async () => {
  const result = matchCapabilities(await sample('24864'));
  assert.equal(result.matched.length, 0);
  assert.equal(result.absent.length, signatures.length);
  assert.ok(result.unrecognized.some(r => /语言栏/.test(r.title || '')));
});

test('展示字段效果检查以需求为准，缺需求时跳过', () => {
  const profile = { requirements: { displayFieldTypes: ['单选按钮'] }, fixture: { displayFields: { supportedTypes: ['旧类型'] } } };
  assert.deepEqual(displayFieldRequirements(profile), ['单选按钮']);
  delete profile.requirements;
  assert.throws(() => displayFieldRequirements(profile), error => error.effectStatus === 'skip' && /需求未提供，需人工补充/.test(error.message));
});
test('实站 47748：显示字段组按系统属性识别，不把分类树当显示字段；数量与分页双匹配', async () => {
  const { displayFieldControls } = await import('../src/capabilities/signatures.mjs');
  const inventory = await sample('47748');
  const list = inventory.find(r => r.title === '设置与选取数据');
  const group = displayFieldControls(list);
  assert.ok(group.length && group.every(c => c.name === 'langBarSort'));
  const ids = matchCapabilities(inventory).matched.map(m => m.id);
  for (const id of ['pld-page-size', 'pld-product-count', 'pld-pagination', 'pld-data-source', 'product-category']) assert.ok(ids.includes(id), id);
});
