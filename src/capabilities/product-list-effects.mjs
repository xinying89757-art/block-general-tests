import { effectCheck, unavailable, uniqueControl, readEffectRoot, sameSet, sentenceList, productSnapshot, rememberCategoryState } from './effect-checks.mjs';
import { categorySelectionChanges } from './product-category-select.mjs';
import { savePage } from '../editor.mjs';
import { widgetSession, checkReportText, fixtureCategoryState } from './shared.mjs';
const SUITE = 'capability:product-list-display';
const NAMES = {
  'pld-fields': '产品列表展示字段与勾选状态', 'pld-page-size-persist': '每页产品数量保存回读与恢复',
  'pld-pagination-persist': '分页展示保存回读与恢复', 'pld-compare-persist': '产品对比保存回读与恢复',
  'pld-compare-front': '产品对比前台效果', 'pld-data-source-category-front': '列表数据来源选部分分类前台效果',
  'pld-display-field-persist': '展示字段保存回读与恢复', 'pld-data-source-persist': '列表数据来源保存回读与恢复',
  'pld-data-source-batch-effect': '批量保存后数据来源画布效果', 'pld-size-batch-effect': '批量保存后产品数量画布效果',
  'pld-pagination-batch-effect': '批量保存后分页画布效果', 'pld-compare-batch-effect': '批量保存后产品对比画布效果',
  'pld-display-field-batch-effect': '批量保存后展示字段画布效果', 'pld-front-note': '产品列表前台可观察性记录',
  'pld-fields-backend': '画布产品卡展示字段完整集合', 'pld-fields-front': '预览产品卡展示字段完整集合',
  'pld-source-all-backend': '所有产品来源在画布生效', 'pld-source-all-front': '所有产品来源在预览生效',
  'pld-source-filter-backend': '筛选条件来源在画布生效', 'pld-source-filter-front': '筛选条件来源在预览生效',
  'pld-source-products-backend': '指定产品来源在画布生效', 'pld-source-products-front': '指定产品来源在预览生效',
  'pld-source-category-backend': '所选分类的产品在画布生效', 'pld-size-backend': '画布产品数量与新数量一致',
  'pld-size-front': '预览产品数量与新数量一致', 'pld-pagination-backend': '画布分页条显隐与设置一致',
  'pld-pagination-front': '预览分页条显隐与设置一致', 'pld-compare-backend': '画布产品对比入口显隐',
  'pld-compare-off-front': '关闭产品对比后预览无入口',
};
function result(id, status, detail, evidence, textFields = {}) {
  const machineReason = evidence?.reason?.code ?? evidence?.reason;
  const reason = typeof machineReason === 'string' && /^[a-z0-9-]+$/i.test(machineReason)
    ? { stage: 'capability-effect', code: machineReason } : undefined;
  return { id, name: NAMES[id], suite: SUITE, status, detail, ...checkReportText(NAMES[id], status, detail, evidence, id),
    ...(reason ? { reason } : {}), ...textFields, ...(evidence === undefined ? {} : { evidence }) };
}
async function runListEffectPlan(tasks, { checkGroup } = {}) {
  const selected = checkGroup ? tasks.filter((task) => task.id === checkGroup) : tasks;
  const checks = [];
  for (let index = 0; index < selected.length; index += 1) {
    const task = selected[index], check = await task.run(); checks.push(check);
    if (!['env-paused', 'env-timeout'].includes(check.status)) continue;
    for (const blocked of selected.slice(index + 1)) checks.push(result(blocked.id, check.status,
      `因检查 ${check.id} 遇到 ${check.status}，此检查未执行。`, { blockedByEnvironmentCheck: check.id, notExecuted: true }));
    break;
  }
  return checks;
}
const fieldsOf = (controls) => controls.filter((item) => item.type === 'checkbox'
  && item.value && item.value !== 'on' && item.label !== '全选');
export function assessAllProducts({ fixtureNames, actualNames, pagination, quantity }) {
  const counts = Object.fromEntries(fixtureNames.map((name) => [name, actualNames.filter((actual) => actual === name).length]));
  const limit = Number(quantity);
  return { fixtureCounts: counts, allFixturesPresent: fixtureNames.length > 0 && fixtureNames.every((name) => counts[name] > 0),
    countWithinQuantity: Number.isFinite(limit) && actualNames.length <= limit, actualCount: actualNames.length,
    quantity: limit, quantityMeaning: pagination ? '每页产品数量' : '显示产品总数量' };
}
export function listSession(args) {
  const base = widgetSession({ ...args, type: 'phoenix_blocks_gallery',
    title: args.capability?.dialogTitle || '设置产品列表', wrapIndex: args.capability?.wrapIndex ?? 0 });
  // The same quantity input changes its caption with pagination. Normalize
  // ONLY this known caption pair, and resolve its real identity before writing.
  const quantity = (item) => ['text', 'number'].includes(item.type) && /每页产品数量|显示产品总数量/.test(item.label);
  return { ...base, read: async (...params) => (await base.read(...params)).map((item) => quantity(item) ? { ...item, label: '产品数量' } : item),
    set: async (target, value) => {
      if (target.label !== '产品数量') return base.set(target, value);
      const actual = (await base.read()).filter((item) => item.index === target.index && item.tag === target.tag
        && item.type === target.type && item.name === target.name && quantity(item));
      if (actual.length !== 1) throw new Error('产品数量输入框身份变化');
      return base.set(actual[0], value);
    } };
}
const listSize = (items) => uniqueControl(items, (item) => ['text', 'number'].includes(item.type)
  && /产品数量|显示产品总数量/.test(item.label + item.context), '本区块没有产品数量设置项。');

async function effectListFields(tx, session) {
  const fields = fieldsOf(await tx.controls());
  if (!fields.length) unavailable('本区块没有产品展示字段设置项。', 'na');
  // Use the same field identities as pld-fields. That record alone does not
  // prove which styled/hidden checkbox is effective. Keep skip if visibility
  // is ambiguous; never pick the first copy or broaden to an unverified row.
  const visibility = await session.root.evaluate((root) => {
    const visible = (node) => node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    return [...root.querySelectorAll('input, select, textarea')].map((input, index) => ({ index,
      inputVisible: Boolean(visible(input)), labelVisible: [...(input.labels || [])].some(visible),
      wrapperVisible: Boolean(visible(input.closest('label'))),
      parentTag: input.parentElement?.tagName, parentClass: input.parentElement?.className }));
  });
  const visibleIndices = visibility.filter((item) => item.inputVisible || item.labelVisible || item.wrapperVisible)
    .map((item) => item.index);
  const groups = new Map();
  for (const item of fields) {
    const key = `${item.type}:${item.name}:${item.value}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  tx.evidence.displayFieldCandidates = [...groups.values()].map((candidates) => ({
    name: candidates[0].name, value: candidates[0].value, label: candidates[0].label,
    candidates: candidates.map((item) => ({ ...item, visibility: visibility.find((state) => state.index === item.index) })),
    visibleCount: candidates.filter((item) => visibleIndices.includes(item.index)).length,
  }));
  const choices = [];
  for (const candidates of groups.values()) {
    const shown = candidates.filter((item) => visibleIndices.includes(item.index));
    if (shown.length !== 1) unavailable(`展示字段“${candidates[0].label}”有 ${candidates.length} 个候选、${shown.length} 个可见设置，需实测勾选并保存回读以确认生效副本。`);
    choices.push(shown[0]);
  }
  return choices;
}

export function cardFieldSnapshot(root, fieldLabels = []) {
  const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const cards = [...root.querySelectorAll('.one-pruduct-item')].filter(visible);
  return cards.map((card) => {
    const region = card.querySelector('.prodTabList-sitewidget');
    const brief = [...card.querySelectorAll('.prodBrief-one')].some((node) => visible(node) && norm(node.innerText));
    // Frontend field markup varies across product templates. Match the exact
    // visible label text within the card instead of relying on a legacy
    // `_left` class suffix that is absent on current templates.
    const fieldNodes = [...card.querySelectorAll('*')].filter(visible).map((node) => ({ node,
      text: norm(node.children.length ? [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join('') : node.textContent) }));
    const labels = fieldLabels.filter((label) => fieldNodes.some(({ text }) => text === label));
    if (fieldLabels.includes('Brief') && brief) labels.push('Brief');
    return { product: norm(card.querySelector('.prodlist-pro-name')?.innerText), labels,
      mapped: Boolean(region || brief || fieldLabels.some((label) => labels.includes(label))), unmappedRows: 0,
      innerText: norm(card.innerText).slice(0, 1600), outerHTML: card.outerHTML.slice(0, 3200),
      matchedNodes: fieldNodes.filter(({ text }) => fieldLabels.includes(text)).map(({ node, text }) => ({
        text, outerHTML: node.outerHTML.slice(0, 1200), className: String(node.className || '').slice(0, 240),
      })).slice(0, 40) };
  });
}
export function displayFieldRequirements(profile) {
  const required = profile?.requirements?.displayFieldTypes;
  if (!Array.isArray(required) || !required.length) unavailable('需求未提供，需人工补充');
  return required;
}

async function listFieldsEffect(args, layer) {
  const session = listSession(args);
  return effectCheck({ ...args, session, result, id: `pld-fields-${layer}`, layer, run: async (tx) => {
    const supportedTypes = displayFieldRequirements(args.profile);
    const fields = await effectListFields(tx, session);
    // 需求定义类型，夹具提供每类型对应字段及产品值。
    const display = args.profile?.fixture?.displayFields || {};
    const fixtureFields = display.fields || [];
    if (!fixtureFields.length) unavailable('画像没有产品卡自定义字段类型夹具，不能把系统属性当作自定义字段。');
    const selected = supportedTypes.map((type) => {
      const declared = fixtureFields.filter((field) => field.type === type);
      if (declared.length !== 1) unavailable(`画像类型 ${type} 应唯一对应一个 CMS 夹具字段。`);
      const matches = fields.filter((item) => item.label === declared[0].name);
      if (matches.length !== 1) unavailable(`产品卡展示字段中找不到唯一的 CMS 自定义字段“${declared[0].name}”。`);
      return { ...matches[0], fieldType: type };
    });
    const editable = fields.filter((item) => !item.disabled);
    if (selected.some((field) => field.disabled) || new Set(fields.map((item) => item.label)).size !== fields.length) unavailable('自定义展示字段不可改或名称不能唯一确定。');
    const wanted = selected.map((item) => item.label);
    const coverage = { supportedTypes, fields: selected.map(({ fieldType, label }) => ({ type: fieldType, field: label })) };
    tx.evidence.typeCoverage = coverage;
    tx.expected(`每张产品卡应恰好展示画像声明支持的自定义字段：${sentenceList(wanted)}；类型覆盖 ${supportedTypes.join('、')}，系统属性不参与。`);
    for (const field of editable) await tx.set(field, wanted.includes(field.label));
    await tx.save();
    const fieldLabels = selected.map((field) => field.label);
    const cards = layer === 'backend' ? await readEffectRoot(args.canvas, args.config, cardFieldSnapshot, fieldLabels)
      : await tx.observe((frame) => readEffectRoot(frame, args.config, cardFieldSnapshot, fieldLabels));
    if (!cards.length || cards.some((card) => !card.mapped || card.unmappedRows)) unavailable('产品卡展示字段尚不能完整识别，需核实每种字段的展示位置。');
    tx.evidence.cards = cards;
    const fixtureProducts = new Set(fixtureFields.flatMap((field) => Object.keys(field.values || {})));
    const fixtureCards = cards.filter((card) => fixtureProducts.has(card.product));
    tx.evidence.typeCoverage.fixtureCards = fixtureCards.map((card) => card.product);
    if (!fixtureCards.length) unavailable('当前产品卡中没有 AUTOTEST 夹具产品，不能证明自定义字段值在夹具卡片上显示。');
    for (const card of fixtureCards) tx.assert(sameSet(card.labels, wanted), `AUTOTEST 产品“${card.product}”实际展示字段为 ${sentenceList(card.labels)}；应恰好为 ${sentenceList(wanted)}，已逐项比较画像声明类型的完整集合。`);
    for (const card of fixtureCards) {
      for (const label of wanted) {
        const value = fixtureFields.find((field) => field.name === label)?.values?.[card.product];
        if (value === undefined) unavailable(`画像真值表缺少产品“${card.product}”字段“${label}”的值。`);
        const values = Array.isArray(value) ? value : [value];
        tx.assert(values.every((item) => card.innerText.includes(String(item))), `AUTOTEST 产品“${card.product}”字段“${label}”应显示值 ${values.join('、')}；卡片文本：${card.innerText.slice(0, 200)}`);
      }
    }
  } });
}

async function inspectProducts(tx, args, layer) {
  const snapshot = layer === 'backend' ? await readEffectRoot(args.canvas, args.config, productSnapshot)
    : await tx.observe((frame) => readEffectRoot(frame, args.config, productSnapshot));
  if (!snapshot.hasList) unavailable('该层没有可读取的产品列表，需实站核实渲染。');
  return snapshot;
}
async function sourceEffect(args, layer, kind) {
  const session = listSession(args);
  return effectCheck({ ...args, session, result, id: `pld-source-${kind}-${layer}`, layer, run: async (tx) => {
    tx.phase('read-controls');
    const items = await tx.controls();
    const labels = { all: '所有产品', filter: '使用筛选条件', products: '选择指定产品', category: '选择部分产品分类' };
    const source = uniqueControl(items, (item) => item.type === 'radio' && item.name === 'selectProdType'
      && item.label === labels[kind], `本区块没有“${labels[kind]}”数据来源设置项。`);
    const oracle = args.profile?.fixture?.category ? { category: args.profile.fixture.category.name, onShelf: args.profile.fixture.products.map(p => p.name) } : null;
    if (args.report?.fixture?.applied === false) unavailable('夹具准备失败。');
    if (kind === 'category') { const cat = fixtureCategoryState(args.profile, args.report); if (cat.reason) unavailable(cat.reason); }
    // Selecting a source alone cannot set up a new condition or product list.
    // These require their own configured fixtures; never reuse the category
    // oracle as the all-products/explicit-products universe.
    const fixture = { all: oracle?.onShelf, filter: oracle?.filteredProducts,
      products: oracle?.specifiedProducts, category: oracle?.onShelf }[kind];
    if (!Array.isArray(fixture)) unavailable(`画像没有“${labels[kind]}”的完整产品名单夹具，暂不编造结果。`);
    if (['filter', 'products'].includes(kind) && oracle?.configuredSource !== kind) unavailable(`画像尚未确认“${labels[kind]}”已有条件或产品清单，条件编辑和选产品操作留待后续探查。`);
    tx.expected(kind === 'all'
      ? `来源设为“所有产品”后应包含全部 ${fixture.length} 件 AUTOTEST 产品；其余站点产品允许出现，可见数量遵守分页/数量上限。`
      : `来源设为“${labels[kind]}”后，产品列表中的 AUTOTEST 名单应恰好为 ${fixture.length} 件：${sentenceList(fixture)}。`);
    if (kind === 'category') rememberCategoryState(tx, session, items, 'selectProdType');
    tx.phase('set-source');
    await tx.set(source, true); await tx.save();
    if (kind === 'category') {
      if (!oracle.category) unavailable('缺少目标分类名称夹具。');
      const cats = (await tx.controls()).filter((item) => item.type === 'checkbox' && item.name === 'leafProdGroup');
      if (!cats.some((item) => item.label.trim() === oracle.category)) unavailable('设置中找不到夹具分类。');
      const changes = categorySelectionChanges(cats, oracle.category);
      tx.evidence.categorySelection = { candidateCount: cats.length, targetCategory: oracle.category,
        selectedCount: changes.filter(({ value }) => value).length, plannedCount: changes.length };
      await tx.setMany(changes, { restoreKey: 'category-state:selectProdType' });
      await tx.save();
    }
    // Inspect all site products without comparing the whole site list to the
    // AUTOTEST fixture. For this scoped assertion, use the largest supported
    // quantity and no pagination so all fixture products can be visible.
    if (fixture.length > 100) unavailable('完整名单超过数量设置允许范围，需补齐整表读取方案后再测。');
    const current = await tx.controls();
    const pagination = current.filter((item) => item.type === 'radio' && item.name === 'pagination' && item.label === '否');
    const size = listSize(current);
    tx.phase('set-size-pagination');
    await tx.set(size, String(kind === 'all' ? 100 : Math.max(1, fixture.length)));
    if (pagination.length === 1) await tx.set(pagination[0], true);
    await tx.save();
    tx.phase('read-products');
    const actual = await inspectProducts(tx, args, layer);
    tx.evidence.products = { wanted: fixture, actual: actual.names };
    tx.phase('assert');
    if (kind === 'all') {
      const assessment = assessAllProducts({ fixtureNames: fixture, actualNames: actual.names,
        pagination: false, quantity: 100 });
      tx.evidence.products.assessment = assessment;
      tx.assert(assessment.allFixturesPresent,
        `来源为“所有产品”时，3 件 AUTOTEST 产品均应在可见列表中；实际命中 ${Object.entries(assessment.fixtureCounts).filter(([, count]) => count > 0).map(([name]) => name).join('、') || '无'}。`);
      tx.assert(assessment.countWithinQuantity,
        `当前测试设置为不分页、显示产品总数量 ${assessment.quantity}，可见产品数 ${assessment.actualCount} 不得超过该数量；站点其他产品不参与精确名单比较。`);
    } else {
      tx.assert(sameSet(actual.names.filter(name => name.startsWith('AUTOTEST-')), fixture), `来源为“${labels[kind]}”，应显示 ${sentenceList(fixture)}，实际显示 ${sentenceList(actual.names)}，已逐项核对完整产品名单。`);
    }
  } });
}

function listVisibility(root) {
  const visible = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const cards = [...root.querySelectorAll('.one-pruduct-item')].filter(visible);
  return { hasList: Boolean(root.querySelector('.one-pruduct-list, .pf-list-wrap, .one-pruduct-item')),
    cards: cards.length,
    pagination: [...root.querySelectorAll('.pagination')].some(visible),
    compareCards: cards.map((card) => [...card.querySelectorAll('.compared-input-wrap, input.compared-input')].some(visible)) };
}
async function listToggleEffect(args, layer, kind) {
  const session = listSession(args), id = kind === 'compare' && layer === 'front' ? 'pld-compare-off-front' : `pld-${kind}-${layer}`;
  return effectCheck({ ...args, session, result, id, layer, run: async (tx) => {
    const items = await tx.controls();
    const labels = kind === 'pagination' ? ['否', '是'] : ['关闭', '开启'];
    const options = labels.map((label) => uniqueControl(items, (item) => item.type === 'radio'
      && item.label === label && (kind !== 'pagination' || item.name === 'pagination'), `本区块没有${kind === 'pagination' ? '分页' : '产品对比'}设置项。`));
    if (!options[0].name || options[0].name !== options[1].name) unavailable('设置的单选组归属不明确。');
    const states = kind === 'compare' && layer === 'front' ? [0] : [0, 1];
    tx.expected(kind === 'pagination' ? '分页选否时应无分页条，选是时应显示分页条；不检查翻页。'
      : layer === 'front' ? '关闭产品对比后，每张产品卡都应没有对比入口。' : '关闭产品对比时每张产品卡都应没有入口；开启时每张产品卡都应有入口。');
    if (kind === 'pagination') {
      // Guarantee there is more than one product/page rather than asserting a
      // pager for a single-page data set. Capture availability before shrinking.
      await session.cancel(); await savePage(args.page);
      const before = await inspectProducts(tx, args, layer);
      if (before.count < 2) unavailable('初始不足两件产品，不能核对分页开启时是否应出现分页条。');
      // Keep the existing page size. The check concerns the pagination
      // visibility setting; forcing 1 is rejected by some site forms and
      // causes a save/readback error before the pager can be observed.
    }
    for (const index of states) {
      await tx.set(options[index], true); await tx.save();
      const observed = layer === 'backend' ? await readEffectRoot(args.canvas, args.config, listVisibility)
        : await tx.observe((frame) => readEffectRoot(frame, args.config, listVisibility));
      if (!observed.hasList || (kind === 'compare' && !observed.cards)) unavailable('该层没有产品卡可供核对，不能把没有列表当作开关生效。');
      (tx.evidence.visibility ||= []).push({ setting: labels[index], observed });
      const okay = kind === 'pagination' ? observed.pagination === Boolean(index)
        : observed.compareCards.every((shown) => shown === Boolean(index));
      tx.assert(okay, `${kind === 'pagination' ? '分页' : '产品对比'}设为“${labels[index]}”；${kind === 'pagination' ? `分页条${observed.pagination ? '显示' : '隐藏'}` : `${observed.cards} 张产品卡中 ${observed.compareCards.filter(Boolean).length} 张显示对比入口`}。`);
    }
  } });
}
async function listSizeEffect(args, layer) {
  const session = listSession(args);
  return effectCheck({ ...args, session, result, id: `pld-size-${layer}`, layer, run: async (tx) => {
    const items = await tx.controls(), size = listSize(items);
    await session.cancel(); await savePage(args.page);
    const before = await inspectProducts(tx, args, layer);
    if (!before.count) unavailable('当前没有可见产品，无法证明数量设置已同步到该层。');
    const newSize = Number(size.value) === 10 ? 5 : 10;
    // A baseline page containing at least N proves N products are available.
    // A short page proves exhaustion only when below its existing limit.
    let available = before.count >= newSize ? before.count : before.count < Number(size.value) ? before.count : null;
    if (available === null) unavailable('现有列表达到原数量上限，但没有完整可用产品数，暂不能判断增大数量后的应有件数。');
    const expected = Math.min(newSize, available);
    tx.expected(`产品数量改为 ${newSize} 后应显示 ${expected} 件；${before.count >= newSize ? `已观察到至少 ${available} 件可用产品` : `现有数量低于原上限，可用产品共 ${available} 件`}，按新数量与可用数量中的较小值判断。`);
    await tx.set(size, String(newSize)); await tx.save();
    const actual = await inspectProducts(tx, args, layer);
    tx.evidence.quantity = { oldSize: size.value, newSize, available, expected, actual: actual.count, names: actual.names };
    tx.assert(actual.count === expected, `产品数量设为 ${newSize}，本次可确认可用 ${available} 件，应显示 ${expected} 件；实际显示 ${actual.count} 件，名称为 ${sentenceList(actual.names)}。`);
  } });
}
async function listEffects(args, layer) {
  const tasks = [{ id: `pld-fields-${layer}`, run: () => listFieldsEffect(args, layer) }];
  for (const kind of ['all', 'filter', 'products', ...(layer === 'backend' ? ['category'] : [])]) {
    tasks.push({ id: `pld-source-${kind}-${layer}`, run: () => sourceEffect(args, layer, kind) });
  }
  tasks.push({ id: `pld-size-${layer}`, run: () => listSizeEffect(args, layer) });
  tasks.push({ id: `pld-pagination-${layer}`, run: () => listToggleEffect(args, layer, 'pagination') });
  tasks.push({ id: layer === 'front' ? 'pld-compare-off-front' : `pld-compare-${layer}`,
    run: () => listToggleEffect(args, layer, 'compare') });
  return runListEffectPlan(tasks, { checkGroup: layer === 'backend' ? args.config?.checkGroup : null });
}
export async function runProductListEffects(args, layer) { return listEffects(args, layer); }
