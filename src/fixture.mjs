import { FIELD_TYPE_CODES, openProdPage, listCustomFields, readCustomFieldOptions,
  createCustomField, findProduct, createProduct, readProductFieldValues, setProductFieldValues } from './cms.mjs';
import { reloadEditor, openEditor, ensureTargetPage, savePage } from './editor.mjs';
import { widgetSession, probeControls, isFieldCheckbox, checkReportText } from './capabilities/shared.mjs';
import { buildFixtureTruthTable } from './capabilities/custom-filter-fields.mjs';
import { prepareContext } from './browser.mjs';

const DEFAULT_TITLE = '设置自定义字段筛选';
const sameValues = (actual, wanted) => Array.isArray(actual)
  ? actual.length === 1 && actual[0] === wanted : actual === wanted;
const names = (items) => items.map((item) => item.name).join('、') || '无';
function check(id, name, expected, detail, evidence) {
  return { id, name, status: 'pass', suite: 'fixture-prep', detail, evidence,
    ...checkReportText(name, 'pass', detail, evidence, id), expected };
}
export function validateFixture(fixture) {
  const fail = (message) => { throw new Error(`fixture 画像无效：${message}`); };
  if (!fixture || typeof fixture !== 'object' || !Array.isArray(fixture.supportedTypes) || !fixture.supportedTypes.length
    || fixture.supportedTypes.some((type) => typeof type !== 'string' || FIELD_TYPE_CODES[type] === undefined)
    || new Set(fixture.supportedTypes).size !== fixture.supportedTypes.length) fail('supportedTypes 必须是非空且不重复的已知类型列表。');
  if (!Array.isArray(fixture.fields) || !fixture.fields.length) fail('fields 至少一个字段。');
  for (const field of fixture.fields) {
    if (!field || typeof field.name !== 'string' || !field.name.trim() || !fixture.supportedTypes.includes(field.type)
      || !Array.isArray(field.options) || field.options.length < 2
      || field.options.some((value) => typeof value !== 'string' || !value.trim())
      || new Set(field.options).size !== field.options.length
      || (field.typeCode !== undefined && field.typeCode !== FIELD_TYPE_CODES[field.type])) fail('每个字段须有 name/type、至少两个不同字符串选项，类型码须与类型一致。');
  }
  if (new Set(fixture.fields.map((field) => field.name)).size !== fixture.fields.length
    || fixture.supportedTypes.some((type) => fixture.fields.filter((field) => field.type === type).length !== 1)) fail('每种支持类型应恰好一个字段，字段名不得重复。');
  if (!Array.isArray(fixture.products) || fixture.products.length !== fixture.fields.length + 1) fail('products 数量必须为字段数 + 1。');
  for (const product of fixture.products) {
    if (!product || typeof product.name !== 'string' || !product.name.trim() || !product.values
      || fixture.fields.some((field) => typeof product.values[field.name] !== 'string' || !field.options.includes(product.values[field.name]))) fail('每件产品须有名称以及所有字段的单值字符串。');
  }
  if (new Set(fixture.products.map((product) => product.name)).size !== fixture.products.length) fail('产品名不得重复。');
  buildFixtureTruthTable(fixture); // Reject a malformed truth table before any CMS write.
  return fixture;
}
function filterSession({ page, canvas, config }, title, wrapIndex = 0) {
  return widgetSession({ page, canvas, config, type: 'phoenix_blocks_filterStyle', title, wrapIndex });
}
function matchField(controls, original) {
  const found = controls.filter(isFieldCheckbox).filter((item) => item.value === original.value
    && item.name === original.name && item.label === original.label);
  if (found.length !== 1) throw new Error(`字段勾选身份无法唯一确认：${original.label}（${original.value}）。`);
  return found[0];
}
function verifyStates(controls, states) {
  const fields = controls.filter(isFieldCheckbox);
  if (fields.length !== states.length) throw new Error(`恢复字段数量不一致：应为 ${states.length}，实际 ${fields.length}。`);
  for (const state of states) if (matchField(controls, state).checked !== state.checked) throw new Error(`字段“${state.label}”持久化勾选状态未恢复。`);
}
export async function prepareFixture({ page, canvas, context, config, profile }) {
  if (!profile?.fixture) return { skipped: true };
  const fixture = validateFixture(profile.fixture);
  const capability = profile.capabilities?.find((item) => item.id === 'custom-filter-fields');
  const title = capability?.dialogTitle || DEFAULT_TITLE, wrapIndex = capability?.wrapIndex || 0;
  const prepared = { fixture, created: { fields: [], products: [] }, reused: { fields: [], products: [] }, originalFieldStates: null, checks: [] };
  // Fixture creation applies only when this block exposes a filter-fields
  // group. Probe before opening CMS or creating anything.
  const dialog = filterSession({ page, canvas, config }, title, wrapIndex);
  try {
    const probe = await probeControls(dialog);
    if (probe.reason) throw new Error(`筛选设置组探查失败，未启动 CMS 夹具准备：${probe.reason}`);
    const controls = probe.controls.filter(isFieldCheckbox);
    if (!controls.length) {
      const message = '筛选设置弹窗没有字段组；无此设置项，不创建夹具。';
      prepared.checks.push({ ...check('fixture-prep', '自定义筛选夹具准备', '若区块有筛选字段设置，才准备字段和产品。',
        message, { probe: { dialogTitle: title, wrapIndex, filterFieldCount: 0, controls: probe.controls } }), status: 'na' });
      return { ...prepared, skipped: true };
    }
    prepared.checks.push(check('fixture-prep-probe', '筛选字段组前置探查',
      '画像声明支持的筛选字段组应存在，CMS 准备只在字段缺失时补建。',
      `已在“${title}”探查到 ${controls.length} 个字段控件，继续核对 CMS 字段及产品。`,
      { probe: { dialogTitle: title, wrapIndex, filterFieldCount: controls.length,
        fields: controls.map(({ label, value, checked }) => ({ label, value, checked })) } }));
  } finally { await dialog.cancel(); }
  let cmsPage;
  let completed = false;
  try {
    try {
      cmsPage = await openProdPage(context);
      const existing = await listCustomFields(cmsPage);
      for (const field of fixture.fields) {
        const matches = existing.filter((item) => item.name === field.name);
        if (matches.length > 1) throw new Error(`同名字段“${field.name}”有 ${matches.length} 条，无法复用。`);
        const found = matches[0];
        if (found) {
          if (found.type !== field.type) throw new Error(`字段“${field.name}”类型冲突：画像 ${field.type}，CMS ${found.type}。`);
          if (found.status !== '开启') throw new Error(`字段“${field.name}”当前关闭；不悄悄改已有字段。`);
          const options = await readCustomFieldOptions(cmsPage, field.name);
          // The profile lists the values the fixture needs, not necessarily the
          // field's full option list (e.g. AUTOTEST-单选按钮A has 10 CMS options,
          // the truth table uses 2). Reuse requires the declared values to
          // exist; extra CMS options are fine and are never removed.
          const missing = field.options.filter((option) => !options.includes(option));
          if (missing.length) throw new Error(`字段“${field.name}”缺少画像要求的选项：${missing.join('、')}（CMS 现有：${options.join('、')}）；不改已有字段。`);
          prepared.reused.fields.push(found);
        } else {
          if (!field.name.startsWith('AUTOTEST-')) throw new Error(`缺失字段“${field.name}”未使用 AUTOTEST- 前缀，拒绝新建。`);
          prepared.created.fields.push(await createCustomField(cmsPage, field));
        }
      }
      prepared.checks.push(check('fixture-prep-fields', '夹具字段准备与选项核对',
        `字段类型、开启状态应与画像一致，画像要求的选项都应在 CMS 字段里（CMS 可有更多选项）：${names(fixture.fields)}。`,
        `已核对 ${fixture.fields.length} 个字段；新建 ${names(prepared.created.fields)}；复用 ${names(prepared.reused.fields)}。`,
        { created: prepared.created.fields, reused: prepared.reused.fields }));
      for (const product of fixture.products) {
        let prodId = await findProduct(cmsPage, product.name);
        const reused = Boolean(prodId);
        if (!prodId) {
          if (!product.name.startsWith('AUTOTEST-')) throw new Error(`未找到既有产品“${product.name}”，且未使用 AUTOTEST- 前缀，拒绝猜测新建；须核查产品搜索路径。`);
          prodId = await createProduct(cmsPage, product);
        }
        const record = { name: product.name, prodId, updatedFields: [] };
        prepared[reused ? 'reused' : 'created'].products.push(record);
        const actual = await readProductFieldValues(cmsPage, prodId, fixture.fields.map((field) => field.name));
        const changed = Object.fromEntries(Object.entries(product.values).filter(([name, wanted]) => !sameValues(actual[name], wanted)));
        if (Object.keys(changed).length) {
          const after = await setProductFieldValues(cmsPage, prodId, changed);
          for (const [name, wanted] of Object.entries(changed)) if (!sameValues(after[name], wanted)) throw new Error(`产品“${product.name}”字段“${name}”设值后验证失败。`);
          record.updatedFields = Object.keys(changed);
        }
      }
      prepared.checks.push(check('fixture-prep-products', '夹具产品真值表准备',
        `${fixture.products.length} 件产品的每个字段值应与画像真值表一致；一致的值不重写。`,
        `产品值已回读核对；新建 ${names(prepared.created.products)}；复用 ${names(prepared.reused.products)}。`,
        { created: prepared.created.products, reused: prepared.reused.products }));
    } finally { if (cmsPage) await cmsPage.close(); }
    // A just-added block may not yet have a baseline/save. Preserve it before
    // reloading the editor to pick up newly created CMS fields.
    await savePage(page);
    const reloaded = await reloadEditor(page, config);
    canvas = reloaded.frame;
    const session = filterSession({ page, canvas, config }, title, wrapIndex);
    try {
      const probe = await probeControls(session);
      if (probe.reason) throw new Error(`画像声明支持筛选，但设置组不可用：${probe.reason}`);
      const fields = probe.controls.filter(isFieldCheckbox);
      if (!fields.length) throw new Error('画像声明支持筛选，但弹窗没有字段设置组（画像与实际不符）。');
      prepared.originalFieldStates = fields.map((field) => ({ ...field, dialogTitle: title, wrapIndex }));
      // Validate the entire selection before the first mutation.
      const wanted = fixture.fields.map((field) => {
        const matches = fields.filter((control) => control.label === field.name);
        if (matches.length !== 1 || (matches[0].disabled && !matches[0].checked)) throw new Error(`画像字段“${field.name}”未对应唯一可启用设置组（画像与实际不符）。`);
        return matches[0];
      });
      for (const field of wanted) if (!field.checked) await session.set(field, true);
      await session.save();
      await savePage(page);
      await session.open();
      const back = await session.read();
      for (const field of fields) {
        const expected = wanted.includes(field) || field.checked;
        if (matchField(back, field).checked !== expected) throw new Error(`启用后字段“${field.label}”回读与要求不一致。`);
      }
      prepared.checks.push(check('fixture-prep-enable-fields', '启用夹具筛选字段',
        `应勾上 ${names(fixture.fields)}，其他字段保持原状，并保存页面。`,
        `已启用 ${names(fixture.fields)} 并回读确认；全部 ${fields.length} 个字段的原勾选状态已记录。`,
        { enabled: fixture.fields.map((field) => field.name), originalFieldStates: prepared.originalFieldStates }));
    } finally { await session.cancel(); }
    completed = true;
    return prepared;
  } catch (error) {
    error.fixturePreparation = prepared;
    throw error;
  } finally {
    // A partial preparation must also undo checkbox writes. CMS entities stay.
    if (!completed && prepared.originalFieldStates) {
      try { await restoreFixture({ page, canvas, config, originalFieldStates: prepared.originalFieldStates }); prepared.restored = true; }
      catch (restoreError) { prepared.restored = false; prepared.restoreErrors = [restoreError.message]; }
    }
  }
}

export async function restoreFixture({ page, canvas, config, originalFieldStates }) {
  if (!Array.isArray(originalFieldStates) || !originalFieldStates.length) throw new Error('缺少完整的字段勾选恢复快照。');
  const title = originalFieldStates[0].dialogTitle || DEFAULT_TITLE, wrapIndex = originalFieldStates[0].wrapIndex || 0;
  const session = filterSession({ page, canvas, config }, title, wrapIndex);
  const errors = [];
  try {
    await session.cancel();
    await session.open();
    for (const state of originalFieldStates) {
      try {
        const current = matchField(await session.read(), state);
        if (current.checked !== state.checked) await session.set(current, state.checked);
      } catch (error) { errors.push(`恢复字段“${state.label}”：${error.message}`); }
    }
    await session.save();
  } catch (error) { errors.push(`恢复弹窗：${error.message}`); }
  finally {
    try { await session.cancel(); } catch (error) { errors.push(`关闭恢复弹窗：${error.message}`); }
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面：${error.message}`); }
  }
  if (errors.length) throw new Error(errors.join('；'));
  // A separate browser context loads the saved editor data: same-dialog
  // readback cannot prove persistence. Storage state remains in memory only.
  const verification = await page.context().browser().newContext({
    storageState: await page.context().storageState(), ignoreHTTPSErrors: config.ignoreHTTPSErrors,
  });
  await prepareContext(verification, config);
  verification.setDefaultTimeout(30_000);
  verification.setDefaultNavigationTimeout(60_000);
  try {
    const editor = await openEditor(await verification.newPage(), config);
    const target = await ensureTargetPage(editor.page, config);
    const fresh = filterSession({ page: editor.page, canvas: target.frame, config }, title, wrapIndex);
    try {
      const probe = await probeControls(fresh);
      if (probe.reason) throw new Error(`新会话恢复回读失败：${probe.reason}`);
      verifyStates(probe.controls, originalFieldStates);
    } finally { await fresh.cancel(); }
  } finally { await verification.close(); }
}
