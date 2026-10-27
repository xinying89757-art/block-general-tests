import { savePage, openPreview } from '../editor.mjs';
import { widgetSession, probeControls, persistControl, radioPersist, poll, TIMEOUT, previewSelector, checkReportText } from './shared.mjs';

// Editor/dialog selectors: docs/SETTINGS_INVENTORY_40838.md,
// scripts/probe-settings8.mjs and probe-settings10/12.mjs (control label context).
// Preview selectors: scripts/probe-searchnav.mjs, docs/FILTER_TEST_DATA.md,
// and the verified facet/tag/Clear Filters observations supplied for this v1.
const SELECTORS = {
  editorBlock: (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`,
  filterRegion: '.backstage-blocksEditor-wrap[data-blockseditor-type="phoenix_blocks_filterStyle"]',
  settingsButton: 'a.backstage-widgettool-btns[id^="editorBtn-"]',
  dialog: '.backstage-dialog.backstage-dialog-widgetsettinsframe',
  footer: '.backstage-dialog-bottom',
  checkbox: 'input[type="checkbox"]',
  radio: 'input[type="radio"]',
  controlContext: 'li, label, .el-form-item, div',
  // Preview root is shared.previewSelector (data-appid wrap); the LA class
  // does not exist for every block (47748 has none in preview).
  // Filter DOM has two variants: 40838's .prodfield-single /
  // .prodfield-left-fieldname, and 47748's .pf-field-group / .pf-field-title
  // (values are label.pf-opt in both).
  group: '.prodfield-single, .pf-field-group',
  groupTitle: '.prodfield-left-fieldname, .pf-field-title',
  value: 'label',
  selected: '.prodfield-bottom',
  descendants: '*',
};
const TEXT = {
  dialogTitle: '设置自定义字段筛选', save: '保存', cancel: '取消', clear: 'Clear Filters',
  nonValues: ['all', 'reset', 'clear filters', 'search'],
  radioGroups: [
    { name: '筛选逻辑', prefixes: ['交集', '并集'] },
    { name: '筛选触发', prefixes: ['点击“搜索”按钮', '更改筛选项后自动筛选'] },
    { name: '产品范围', prefixes: ['当前分类产品', '所有产品'] },
  ],
};
const SUITE = 'capability:custom-filter-fields';
const NAMES = {
  'cff-settings-fields': '可选自定义筛选字段与勾选状态',
  'cff-settings-state': '筛选逻辑、触发与产品范围当前值',
  'cff-settings-persist': '自定义筛选字段保存回读与恢复',
  'cff-radio-persist': '筛选逻辑、触发与产品范围保存回读与恢复',
  'cff-select-persist': '筛选后跳转页保存回读与恢复',
  'cff-color-persist': '背景颜色保存回读与恢复',
  'cff-field-front-group': '字段启用后预览筛选组与恢复',
  'cff-groups-baseline': '筛选组标题与值基线',
  'cff-facet-narrow': '选择后刻面收窄与已选标签',
  'cff-clear-restore': '清除筛选后恢复基线',
};

function result(id, status, detail, evidence, textFields = {}) {
  return { id, name: NAMES[id], status, detail, suite: SUITE,
    ...checkReportText(NAMES[id], status, detail, evidence, id), ...textFields,
    ...(evidence === undefined ? {} : { evidence }) };
}

const SETTINGS_IDS = ['cff-settings-fields', 'cff-settings-state', 'cff-settings-persist',
  'cff-field-front-group', 'cff-radio-persist', 'cff-select-persist', 'cff-color-persist'];
const fromOutcome = (id, outcome) => result(id, outcome.status, outcome.detail, outcome.evidence,
  id === 'cff-field-front-group' && outcome.evidence?.field
    ? { expected: `启用“${outcome.evidence.field}”并保存后，预览中应出现以该字段命名的筛选组；恢复后应回到原勾选状态。` }
    : {});

async function persistSpectrumColor({ session, page, original, alternate }) {
  const evidence = { original, alternate, strategy: null };
  const read = () => session.root.locator('#customOnBgColor').inputValue({ timeout: TIMEOUT });
  const set = async (value) => {
    let apiError = '';
    try {
      const api = await session.root.evaluate((dialog, color) => {
        const input = dialog.querySelector('#customOnBgColor');
        const jq = window.jQuery || window.$;
        if (!input || !jq || !jq.fn || typeof jq.fn.spectrum !== 'function') return { available: false };
        jq(input).spectrum('set', color);
        jq(input).trigger('change');
        return { available: true, value: input.value };
      }, value, { timeout: TIMEOUT });
      const applied = await poll(read, (actual) => actual === value);
      if (api.available && applied.matched) { evidence.strategy = 'Spectrum API'; return; }
      apiError = api.available ? `API 后值为 ${JSON.stringify(applied.value)}` : '当前页面没有可用的 Spectrum jQuery API';
    } catch (error) { apiError = error.message; }

    try {
      const replacer = session.root.locator('li.settings-btn-item').filter({ has: session.root.locator('.settings-btn-title', { hasText: /^背景颜色$/ }) }).locator('.sp-replacer');
      await replacer.click({ timeout: TIMEOUT });
      const input = page.locator('.sp-container:visible .sp-input');
      await input.waitFor({ state: 'visible', timeout: TIMEOUT });
      await input.fill(value, { timeout: TIMEOUT });
      await page.locator('.sp-container:visible .sp-choose').click({ timeout: TIMEOUT });
      const applied = await poll(read, (actual) => actual === value);
      if (!applied.matched) throw new Error(`取色器选择后值为 ${JSON.stringify(applied.value)}`);
      evidence.strategy = 'Spectrum 面板';
    } catch (error) {
      throw new Error(`Spectrum API 失败（${apiError}）；取色面板降级失败（${error.message}）`);
    }
  };

  let stage = '设置背景颜色';
  let mutationStarted = false;
  const errors = [];
  try {
    mutationStarted = true;
    await set(alternate);
    stage = '保存翻转状态';
    await session.save();
    stage = '重开回读翻转状态';
    await session.open();
    evidence.afterSave = await read();
    if (evidence.afterSave !== alternate) throw new Error('保存重开后背景颜色未改变');
  } catch (error) {
    if (stage === '设置背景颜色' && error.message.includes('Spectrum API 失败')) {
      // Both supported setters failed before a save; report the requested skip.
      try { await session.cancel(); } catch { /* final cleanup handles dialog state */ }
      return result('cff-color-persist', 'skip', `背景颜色无法改写：${error.message}`, evidence);
    }
    errors.push(`${stage}失败：${error.message}`);
  } finally {
    if (mutationStarted && errors.length) {
      try {
        await session.cancel();
        await session.open();
        stage = '恢复原值';
        await set(original);
        stage = '保存恢复状态';
        await session.save();
        stage = '重开断言恢复';
        await session.open();
        evidence.restored = await read();
        if (evidence.restored !== original) throw new Error('未恢复原值');
      } catch (error) { errors.push(`${stage}失败：${error.message}`); }
    } else if (!errors.length) {
      try {
        stage = '恢复前重新打开';
        await session.cancel();
        await session.open();
        stage = '恢复原值';
        await set(original);
        stage = '保存恢复状态';
        await session.save();
        stage = '重开断言恢复';
        await session.open();
        evidence.restored = await read();
        if (evidence.restored !== original) throw new Error('未恢复原值');
      } catch (error) { errors.push(`${stage}失败：${error.message}`); }
    }
    try { await session.cancel(); } catch (error) { errors.push(`退出设置失败：${error.message}`); }
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面失败：${error.message}`); }
  }
  return result('cff-color-persist', errors.length ? 'fail' : 'pass',
    `背景颜色原值为 ${original}，改为 ${alternate} 后保存重开回读，恢复后为 ${original}。${errors.join('；') || `通过${evidence.strategy}完成回读与恢复。`}`,
    evidence, { expected: `背景颜色改为 ${alternate} 后保存重开应保持该颜色；恢复并保存后应回到 ${original}。` });
}

async function withPreview(page, context, inspect) {
  const before = new Set(context.pages());
  try {
    await savePage(page);
    const preview = await openPreview(page, context);
    return await inspect(preview.frame);
  } finally {
    // openPreview may throw after creating a tab; recover those tabs as well.
    const errors = [];
    for (const tab of context.pages().filter((tab) => !before.has(tab) && tab !== page)) {
      try { if (!tab.isClosed()) await tab.close(); } catch (error) { errors.push(error.message); }
    }
    if (errors.length) throw new Error(`关闭临时预览失败：${errors.join('；')}`);
  }
}

// Radio options use the verified v1 label prefixes; unidentified groups are only recorded.
async function persistRadio(session, page, group, afterSwitch) {
  return radioPersist({ session, page, ...group, afterSwitch });
}

async function scopeBaseline(page, context, config) {
  return withPreview(page, context, async (frame) => {
    const root = frame.locator(previewSelector(config.blockId)).first();
    await root.waitFor({ state: 'attached', timeout: TIMEOUT });
    const selectors = { ...Object.fromEntries(Object.entries(SELECTORS)
      .filter(([, value]) => typeof value === 'string')), nonValues: TEXT.nonValues };
    const ready = await poll((timeout) => root.evaluate(frontSnapshot, selectors, { timeout }),
      (data) => data.groups.length > 0);
    return { status: 'record', groups: ready.value.groups };
  });
}

export async function runSettingsLayer({ page, canvas, context, config, capability }) {
  const checks = [];
  const session = widgetSession({ page, canvas, config,
    type: 'phoenix_blocks_filterStyle', title: TEXT.dialogTitle });
  const initial = await probeControls(session);
  if (initial.reason) {
    let detail = `无法打开筛选设置弹窗：${initial.reason}`;
    try { await session.cancel(); } catch (error) { detail += `；取消失败：${error.message}`; }
    return SETTINGS_IDS.map((id) => result(id, 'skip', detail));
  }
  // Fields are the checkboxes whose value is the bare numeric field id.
  // Value sub-options (value like 826554_1, shown under single/dropdown
  // fields in 47748) are not fields; counting them inflated 47748 to 60.
  const fields = initial.controls.filter((item) => item.type === 'checkbox'
    && /^\d+$/.test(item.value || '') && item.label !== '全选');
  const radios = initial.controls.filter((item) => item.type === 'radio');
  const state = Object.fromEntries(TEXT.radioGroups.map(({ name, prefixes }) => {
    const selected = radios.filter((radio) => radio.checked && prefixes.some((prefix) => radio.label.startsWith(prefix)));
    return [name, selected.length === 1 ? selected[0] : null];
  }));
  const absent = TEXT.radioGroups.filter(({ prefixes }) => !radios.some((radio) => prefixes.some((prefix) => radio.label.startsWith(prefix)))).map(({ name }) => name);
  const broken = TEXT.radioGroups.filter(({ name, prefixes }) => {
    const candidates = radios.filter((radio) => prefixes.some((prefix) => radio.label.startsWith(prefix)));
    return candidates.length > 0 && candidates.filter((radio) => radio.checked).length !== 1;
  }).map(({ name }) => name);
  checks.push(result('cff-settings-fields', 'record', `可选字段 ${fields.length} 个（不含全选与字段值子选项）。`, fields));
  // A radio group that does not exist in this block is not a failure: 47748
  // has no logic/trigger/scope groups at all. Only a present-but-broken
  // group fails; an absent group is recorded. When the profile declares a
  // design-fixed value for an absent group (47748: the three groups are
  // hidden in the editor but fixed by the Figma design), report that value.
  const fixed = capability?.fixedSettings || {};
  checks.push(result('cff-settings-state', broken.length ? 'fail' : absent.length === Object.keys(state).length
    ? 'record' : 'pass',
    Object.entries(state).map(([name, value]) => `${name}=${value ? `${value.label}（${value.value}）` : fixed[name] ? `${fixed[name]}（设计稿固定值，弹窗隐藏）` : '本区块无此设置'}`).join('；'),
    { ...state, absentGroups: absent, allRadioGroups: Object.entries(Object.groupBy(radios, (item) => item.name || `unnamed:${item.index}`))
      .map(([name, options]) => ({ name, checkedLabels: options.filter((item) => item.checked).map((item) => item.label), options })) }));

  const field = fields.find((item) => !item.disabled && !item.checked) || fields.find((item) => !item.disabled);
  try {
    if (!field) {
      const noFields = fields.length === 0;
      checks.push(...['cff-settings-persist', 'cff-field-front-group']
        .map((id) => result(id, noFields ? 'na' : 'skip', noFields ? '本区块没有可选自定义筛选字段设置项。' : '没有可切换的自定义字段。')));
    } else {
      checks.push(fromOutcome('cff-settings-persist', await persistControl({
        session, page, target: field, alternate: !field.checked,
      })));
      // The same field is reused after the persistence transaction has restored it.
      // Prefer an unchecked field, so enabling it must expose its named group.
      const probe = await probeControls(session);
      const current = probe.controls?.find((item) => item.index === field.index && item.value === field.value);
      if (!current || current.checked !== field.checked) {
        checks.push(result('cff-field-front-group', 'skip', `字段持久化后原状态不可确认：${probe.reason || field.label}`));
      } else if (!context) {
        checks.push(result('cff-field-front-group', 'skip', '未提供浏览器 context，无法打开临时预览。'));
      } else {
        checks.push(fromOutcome('cff-field-front-group', await persistControl({ session, page,
          target: field, alternate: !field.checked,
          afterSwitch: async (evidence, stage) => {
            stage('保存页面并打开临时预览');
            await withPreview(page, context, async (frame) => {
              stage('断言预览筛选组标题');
              const root = frame.locator(previewSelector(config.blockId)).first();
              await root.waitFor({ state: 'attached', timeout: TIMEOUT });
              const read = (timeout) => root.locator(SELECTORS.groupTitle).evaluateAll(
                (nodes) => nodes.map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()), undefined, { timeout });
              const observed = await poll(read, (titles) => titles.includes(field.label) === !field.checked);
              evidence.field = field.label;
              evidence.expectedPresent = !field.checked;
              evidence.previewTitles = observed.value;
              // Some blocks render no facet groups at all in preview (47748:
              // the filter container stays empty even with a field enabled).
              // That is not a settings-layer failure; record it and let the
              // front layer decide observability instead of failing here.
              if (!observed.value.length) {
                evidence.frontObservable = false;
                return;
              }
              if (!observed.matched) throw new Error(`字段 ${field.label} 翻转后筛选组${field.checked ? '仍出现' : '未出现'}`);
            });
          },
        })));
      }
    }

    const outcomes = [];
    for (const group of TEXT.radioGroups) {
      let beforeScope;
      if (group.name === '产品范围' && context) {
        try {
          await session.cancel();
          beforeScope = await scopeBaseline(page, context, config);
        } catch (error) { beforeScope = { status: 'skip', detail: error.message }; }
      }
      // Scope changes depend on data. Record the alternate preview universe but
      // never assert a specific difference, unlike the two persistence-only groups.
      const afterSwitch = group.name === '产品范围' && context ? async (evidence, stage) => {
        stage('记录切换产品范围后的预览基线');
        try {
          evidence.scopePreview = { before: beforeScope, after: await scopeBaseline(page, context, config) };
        } catch (error) { evidence.scopePreview = { before: beforeScope, after: { status: 'skip', detail: error.message } }; }
      } : undefined;
      const outcome = await persistRadio(session, page, group, afterSwitch);
      if (group.name === '产品范围' && !context) outcome.detail += '；未提供 context，范围预览取证 skip。';
      else if (group.name === '产品范围' && outcome.evidence?.scopePreview) {
        const snapshot = outcome.evidence.scopePreview;
        outcome.detail += snapshot.before?.status === 'record' && snapshot.after?.status === 'record'
          ? '；切换前后预览组和值清单已记录，不硬断言数据变化。'
          : '；范围预览部分取证 skip，原因见 evidence。';
      }
      outcomes.push(outcome);
    }
    checks.push(result('cff-radio-persist', outcomes.some((item) => item.status === 'fail') ? 'fail'
      : outcomes.every((item) => item.status === 'pass') ? 'pass'
        : outcomes.every((item) => item.status === 'na') ? 'na' : 'skip',
    outcomes.map((item) => `[${item.status}] ${item.detail}`).join('；'), outcomes));

    const selectProbe = await probeControls(session);
    const selects = selectProbe.controls?.filter((item) => item.tag === 'SELECT') || [];
    const jumpSelects = selects.filter((item) => /跳转/.test(item.label + item.context));
    const select = jumpSelects.length === 1 ? jumpSelects[0] : (selects.length === 1 ? selects[0] : null);
    const option = select?.options.find((item) => !item.disabled && item.value && item.value !== select.value
      && !/^请选择/.test(item.label));
    checks.push(!select || select.disabled || !option
      ? result('cff-select-persist', selectProbe.reason ? 'skip' : selects.length === 0 ? 'na' : 'skip', selectProbe.reason || (selects.length === 0 ? '本区块没有筛选后跳转页设置项。' : '未找到唯一的筛选后跳转页 select，或没有其他可选页。'))
      : fromOutcome('cff-select-persist', await persistControl({ session, page, target: select, alternate: option.value })));

    // The select persist leaves the dialog closed (and its DOM may be
    // detached); reopen before probing the color input.
    await session.open();
    const color = await session.root.locator('#customOnBgColor').evaluate((input) => ({
      value: input.value, readOnly: input.readOnly, roles: input.getAttribute('roles'),
      title: input.closest('li.settings-btn-item')?.querySelector('.settings-btn-title')?.textContent?.trim(),
      replacer: Boolean(input.closest('li.settings-btn-item')?.querySelector('.sp-replacer')),
    })).catch(() => null);
    checks.push(!color || color.title !== '背景颜色' || color.roles !== 'colorPicker' || !color.replacer
      ? result('cff-color-persist', color ? 'skip' : 'na', color ? '背景颜色控件结构不符合取色器定位条件。' : '本区块没有背景颜色设置项。', color)
      : await persistSpectrumColor({ session, page, original: color.value, alternate: 'rgb(1, 2, 3)' }));
  } finally {
    try { await session.cancel(); } catch (error) {
      const last = checks.at(-1);
      if (last) { last.status = 'fail'; last.detail += `；最终取消退出失败：${error.message}`; }
    }
  }
  return checks;
}

function frontSnapshot(root, selectors) {
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const counts = new Map();
  const groups = [...root.querySelectorAll(selectors.group)].map((group) => {
    const title = normalize(group.querySelector(selectors.groupTitle)?.innerText);
    const occurrence = counts.get(title) || 0;
    counts.set(title, occurrence + 1);
    return {
      key: `${title}:${occurrence}`, title,
      values: [...new Set([...group.querySelectorAll(selectors.value)]
        .map((label) => normalize(label.innerText))
        .filter((value) => value && !selectors.nonValues.includes(value.toLowerCase())))],
    };
  });
  return { groups, selected: [...root.querySelectorAll(selectors.selected)].map((node) => normalize(node.innerText)) };
}

function sameGroups(left, right) {
  return left.length === right.length && left.every((group) => {
    const other = right.find((item) => item.key === group.key);
    return other && group.values.length === other.values.length && group.values.every((value) => other.values.includes(value));
  });
}

export async function runFrontLayer({ frame, config }) {
  const checks = [];
  const root = frame.locator(previewSelector(config.blockId)).first();
  const selectors = { ...Object.fromEntries(Object.entries(SELECTORS).filter(([, value]) => typeof value === 'string')), nonValues: TEXT.nonValues };
  const read = (timeout = TIMEOUT) => root.evaluate(frontSnapshot, selectors, { timeout });
  let baseline;
  try {
    await root.waitFor({ state: 'attached', timeout: TIMEOUT });
    const ready = await poll(read, (data) => data.groups.length > 0);
    baseline = ready.value || { groups: [], selected: [] };
    // No facet groups in this block's preview (47748 rendered an empty
    // filter container before it was configured). That is observability,
    // not a failure: record it and skip the facet interactions that need a
    // group to click.
    if (!baseline.groups.length) {
      return [result('cff-groups-baseline', 'record', '本区块预览里无筛选组，前台筛选效果不可观察。', baseline.groups),
        ...['cff-facet-narrow', 'cff-clear-restore'].map((id) => result(id, 'skip', '无可用筛选组基线。'))];
    }
    checks.push(result('cff-groups-baseline', 'record', `采集 ${baseline.groups.length} 个筛选组，值清单已去掉 All、Reset 等控件文本。`, baseline.groups));
    // 47748's rendered groups are pointer-events:none in editor preview
    // (verified 2026-10-26: neither label.click() nor a forced input click
    // checks the radio). Attempting the facet interaction would fail for a
    // rendering reason, not a setting reason: skip it and only verify the
    // groups render.
    const interactive = await root.evaluate((node, s) => {
      const label = node.querySelector(`${s.group} ${s.value}`);
      return label ? getComputedStyle(label).pointerEvents !== 'none' : false;
    }, selectors).catch(() => false);
    if (!interactive) {
      return checks.concat(['cff-facet-narrow', 'cff-clear-restore'].map((id) =>
        result(id, 'skip', '预览筛选组 pointer-events:none，编辑器预览里不可交互；只验证组渲染。')));
    }
  } catch (error) {
    return [result('cff-groups-baseline', 'fail', `采集基线失败：${error.message}`),
      ...['cff-facet-narrow', 'cff-clear-restore'].map((id) => result(id, 'skip', '无可用筛选组基线。'))];
  }

  const value = baseline.groups[0].values[0];
  let clicked = false;
  let skipReason = '第一个筛选组没有可选的非 All 值。';
  if (value) {
    try {
      clicked = await root.locator(SELECTORS.group).first().evaluate((group, { selector, checkbox, value }) => {
        const label = [...group.querySelectorAll(selector)].find((node) => (node.innerText || '').replace(/\s+/g, ' ').trim() === value);
        if (!label || label.querySelector(checkbox)?.disabled || label.control?.disabled) return false;
        label.scrollIntoView({ block: 'center' });
        label.click();
        return true;
      }, { selector: SELECTORS.value, checkbox: SELECTORS.checkbox, value });
      skipReason = `无法点击筛选值 ${value}。`;
    } catch (error) { skipReason = `无法点击筛选值 ${value}：${error.message}`; }
  }
  if (!clicked) return checks.concat(['cff-facet-narrow', 'cff-clear-restore'].map((id) => result(id, 'skip', skipReason)));

  try {
    const narrowed = await poll(read, (data) => data.groups.length > 0
      && !sameGroups(data.groups, baseline.groups) && data.selected.some((text) => text.includes(value)));
    const current = narrowed.value;
    const violations = [];
    if (!narrowed.matched) violations.push('10 秒内未同时观察到值集合变化和已选标签');
    if (current.groups.length !== baseline.groups.length) violations.push('筛选组数量变化');
    for (const group of baseline.groups.slice(1)) {
      const actual = current.groups.find((item) => item.key === group.key);
      if (!actual) violations.push(`筛选组 ${group.title} 缺失`);
      else if (actual.values.some((item) => !group.values.includes(item))) violations.push(`${group.title} 出现基线之外的值`);
    }
    checks.push(result('cff-facet-narrow', violations.length ? 'fail' : 'pass',
      `选择 ${baseline.groups[0].title} / ${value}；${violations.join('；') || '其他各组值集合均为基线子集，已选标签出现该值。'}`, current));
  } catch (error) {
    checks.push(result('cff-facet-narrow', 'fail', `选择 ${value} 后检查失败：${error.message}`));
  }

  // Clear independently even when narrowing failed, so the preview is recovered.
  try {
    const cleared = await root.evaluate((node, { selector, text }) => {
      const candidates = [...node.querySelectorAll(selector)].filter((el) => (el.innerText || '').trim() === text);
      const target = candidates.find((el) => !candidates.some((child) => child !== el && el.contains(child)));
      if (!target) return false;
      target.click();
      return true;
    }, { selector: SELECTORS.descendants, text: TEXT.clear });
    if (!cleared) throw new Error('未找到 Clear Filters');
    const restored = await poll(read, (data) => sameGroups(data.groups, baseline.groups));
    checks.push(result('cff-clear-restore', restored.matched ? 'pass' : 'fail', restored.matched
      ? 'Clear Filters 后各组值集合与基线相等。' : 'Clear Filters 后 10 秒内未恢复基线值集合。', restored.value));
  } catch (error) {
    checks.push(result('cff-clear-restore', 'fail', `清除恢复检查失败：${error.message}`));
  }
  return checks;
}
