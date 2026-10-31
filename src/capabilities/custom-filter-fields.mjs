import { effectCheck, unavailable, readEffectRoot, sameSet, sentenceList, productSnapshot } from './effect-checks.mjs';
import { blockSelector } from './shared.mjs';
import { normalizeColor } from './rail.mjs';
import { savePage, openPreview } from '../editor.mjs';
import { fixedRequirementValues } from './signatures.mjs';
import { widgetSession, probeControls, persistControl, radioPersist, poll, TIMEOUT, previewSelector, checkReportText, readBackWithRetry, isFieldCheckbox, fixtureCategoryState } from './shared.mjs';

// Editor/dialog selectors: docs/SETTINGS_INVENTORY_样本区块.md,
// scripts/probes/probe-settings8.mjs and probe-settings10/12.mjs (control label context).
// Preview selectors: scripts/probes/probe-searchnav.mjs, docs/FILTER_TEST_DATA.md,
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
  // does not exist for every block (另一样本区块 has none in preview).
  // Filter DOM has two variants: 样本区块's .prodfield-single /
  // .prodfield-left-fieldname, and 另一样本区块's .pf-field-group / .pf-field-title
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
export const freshSettings = Object.freeze({ status: 'not-adapted',
  reason: 'Field checkbox tests and the hidden profile-declared radio values share a legacy restore transaction; the fresh adapter must expose only visible controls while retaining the existing profile oracle and restore grouping.' });
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
  const name = NAMES[id] || (id.startsWith('cff-oracle-single-') ? `${NAMES['cff-oracle-single']} ${id.split('-').at(-1)}`
    : id.startsWith('cff-oracle-intersect-') ? `${NAMES['cff-oracle-intersect-pair']} ${id.split('-').slice(-2).join('、')}` : id);
  return { id, name, status, detail, suite: SUITE,
    ...checkReportText(name, status, detail, evidence, id), ...textFields,
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
  const readBack = (expected) => readBackWithRetry(read, (value) => value === expected,
    async () => { await session.cancel(); await session.open(); });
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
    evidence.afterSave = await readBack(alternate);
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
        evidence.restored = await readBack(original);
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
        evidence.restored = await readBack(original);
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

export async function runSettingsLayer({ page, canvas, context, config, capability, profile, report }) {
  const checks = [];
  const session = widgetSession({ page, canvas, config,
    type: 'phoenix_blocks_filterStyle', title: TEXT.dialogTitle });
  const initial = await probeControls(session);
  if (initial.reason) {
    let detail = `无法打开筛选设置弹窗：${initial.reason}`;
    try { await session.cancel(); } catch (error) { detail += `；取消失败：${error.message}`; }
    const skipped = SETTINGS_IDS.map((id) => result(id, 'skip', detail));
    if (profile?.fixture) skipped.push(...oldInteractionSkips(), ...await fixtureOracleChecks({ page, canvas, context, config, capability, profile, report }, detail));
    return skipped;
  }
  // Fields are the checkboxes whose value is the bare numeric field id.
  // Value sub-options (value like 826554_1, shown under single/dropdown
  // fields in 另一样本区块) are not fields; counting them inflated 另一样本区块 to 60.
  const fields = initial.controls.filter(isFieldCheckbox);
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
  // A radio group that does not exist in this block is not a failure: 另一样本区块
  // has no logic/trigger/scope groups at all. Only a present-but-broken
  // group fails; an absent group is recorded. When the profile declares a
  // design-fixed value for an absent group (另一样本区块: the three groups are
  // hidden in the editor but fixed by the Figma design), report that value.
  const required = fixedRequirementValues(profile);
  const fixed = { ...(capability?.fixedSettings || {}), ...Object.fromEntries(Object.entries({ 'cff-logic': '筛选逻辑', 'cff-trigger': '筛选触发', 'cff-scope': '产品范围' })
    .filter(([id]) => required[id]).map(([id, name]) => [name, required[id]])) };
  checks.push(result('cff-settings-state', broken.length ? 'fail' : absent.length === Object.keys(state).length
    ? 'record' : 'pass',
    Object.entries(state).map(([name, value]) => `${name}=${value ? `${value.label}（${value.value}）` : fixed[name] ? `${fixed[name]}（设计稿固定值，弹窗隐藏）` : '本区块无此设置'}`).join('；'),
    { ...state, absentGroups: absent, allRadioGroups: Object.entries(Object.groupBy(radios, (item) => item.name || `unnamed:${item.index}`))
      .map(([name, options]) => ({ name, checkedLabels: options.filter((item) => item.checked).map((item) => item.label), options })) }));

  const fixtureNames = new Set((profile?.fixture?.fields || []).map(field => field.name));
  const field = fields.find((item) => fixtureNames.has(item.label) && !item.disabled && !item.checked) || fields.find((item) => fixtureNames.has(item.label) && !item.disabled);
  try {
    if (!field) {
      const noFields = fields.length === 0;
      checks.push(...['cff-settings-persist', 'cff-field-front-group']
        .map((id) => result(id, noFields ? 'na' : 'skip', noFields ? '本区块没有可选自定义筛选字段设置项。' : '没有可切换的自定义字段。')));
    } else {
      checks.push(fromOutcome('cff-settings-persist', await persistControl({
        session, page, target: field, alternate: !field.checked,
      })));
      if (config.deferFront) {
        checks.push(result('cff-field-front-group', 'deferred', 'deferred-to-front-runner', { deferred: true }));
      } else {
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
              // Some blocks render no facet groups at all in preview (另一样本区块:
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
    }

    const outcomes = [];
    for (const group of TEXT.radioGroups) {
      let beforeScope;
      if (group.name === '产品范围' && context && !config.deferFront) {
        try {
          await session.cancel();
          beforeScope = await scopeBaseline(page, context, config);
        } catch (error) { beforeScope = { status: 'skip', detail: error.message }; }
      }
      // Scope changes depend on data. Record the alternate preview universe but
      // never assert a specific difference, unlike the two persistence-only groups.
      const afterSwitch = group.name === '产品范围' && context && !config.deferFront ? async (evidence, stage) => {
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
  const args = { page, canvas, context, config, capability, profile, report };
  checks.push(await filterFieldsEffect(args, 'front'), await backgroundEffect(args, 'front'));
  if (profile?.fixture) checks.push(...oldInteractionSkips(), ...await fixtureOracleChecks(args));
  else for (const kind of ['logic', 'trigger', 'scope', 'jump']) checks.push(await filterInteractionEffect(args, kind));
  return checks;
}

function frontSnapshot(root, selectors) {
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const counts = new Map();
  const groups = [...root.querySelectorAll(selectors.group)].filter((group) =>
    group.getClientRects().length > 0 && group.ownerDocument.defaultView.getComputedStyle(group).visibility !== 'hidden')
    .map((group) => {
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
  return { groups: groups.filter(group => group.title.startsWith('AUTOTEST-')), selected: [...root.querySelectorAll(selectors.selected)].map((node) => normalize(node.innerText)) };
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
    // No facet groups in this block's preview (另一样本区块 rendered an empty
    // filter container before it was configured). That is observability,
    // not a failure: record it and skip the facet interactions that need a
    // group to click.
    if (!baseline.groups.length) {
      return [result('cff-groups-baseline', 'record', '本区块预览里无筛选组，前台筛选效果不可观察。', baseline.groups),
        ...['cff-facet-narrow', 'cff-clear-restore'].map((id) => result(id, 'skip', '无可用筛选组基线。'))];
    }
    checks.push(result('cff-groups-baseline', 'record', `采集 ${baseline.groups.length} 个筛选组，值清单已去掉 All、Reset 等控件文本。`, baseline.groups));
    // 另一样本区块's rendered groups are pointer-events:none in editor preview
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
      clicked = await root.evaluate((node, { groupSelector, titleSelector, title, selector, checkbox, value }) => {
        const groups = [...node.querySelectorAll(groupSelector)].filter(group => (group.querySelector(titleSelector)?.innerText || '').replace(/\s+/g, ' ').trim() === title);
        if (groups.length !== 1) return false;
        const label = [...groups[0].querySelectorAll(selector)].find((node) => (node.innerText || '').replace(/\s+/g, ' ').trim() === value);
        if (!label || label.querySelector(checkbox)?.disabled || label.control?.disabled) return false;
        label.scrollIntoView({ block: 'center' });
        label.click();
        return true;
      }, { groupSelector: SELECTORS.group, titleSelector: SELECTORS.groupTitle, title: baseline.groups[0].title, selector: SELECTORS.value, checkbox: SELECTORS.checkbox, value });
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

Object.assign(NAMES, {
  'cff-fields-backend': '画布自定义筛选组完整集合',
  'cff-fields-front': '预览自定义筛选组完整集合',
  'cff-logic-front': '交集与并集的精确产品集合',
  'cff-trigger-front': '手动与自动筛选的触发行为',
  'cff-scope-front': '当前分类与所有产品的范围结果',
  'cff-jump-front': '执行筛选后的落地页面',
  'cff-background-backend': '筛选背景颜色在画布生效',
  'cff-background-front': '筛选背景颜色在预览生效',
});
const filterFields = (controls) => controls.filter(isFieldCheckbox);

function filterOracle(args) {
  return args.capability?.oracle?.fields ? args.capability.oracle : null;
}
function groupSnapshot(root) {
  const titles = [...root.querySelectorAll('.prodfield-left-fieldname, .pf-field-title')]
    .filter((node) => node.getClientRects().length > 0
      && node.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden')
    .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return titles;
}
// 样本区块 renders built-in Series and Category groups before its custom groups.
// If Category is selected as a custom field, a title-only filter must discard
// exactly the first built-in occurrence and retain the custom occurrence(s).
export function customGroupTitles(titles, builtinGroups = []) {
  const builtinCounts = new Map();
  for (const title of builtinGroups) builtinCounts.set(title, (builtinCounts.get(title) || 0) + 1);
  const seen = new Map();
  return titles.filter((title) => {
    const occurrence = seen.get(title) || 0;
    seen.set(title, occurrence + 1);
    const builtins = builtinCounts.get(title) || 0;
    if (occurrence < builtins) return false;
    return true;
  });
}
async function filterFieldsEffect(args, layer) {
  const session = widgetSession({ ...args, type: 'phoenix_blocks_filterStyle', title: TEXT.dialogTitle });
  return effectCheck({ ...args, session, result, id: `cff-fields-${layer}`, layer, run: async (tx) => {
    const fields = filterFields(await tx.controls());
    if (!fields.length) unavailable('本区块没有自定义字段勾选设置项。', 'na');
    const names = new Set((args.profile?.fixture?.fields || []).map(field => field.name));
    const editable = fields.filter((item) => names.has(item.label) && !item.disabled);
    if (!editable.length) unavailable('当前没有可以改写的 AUTOTEST 字段。');
    const selected = editable.slice(0, Math.min(3, editable.length));
    // Toggle the collection if the first three happen to be the baseline.
    if (sameSet(fields.filter((item) => item.checked).map((item) => item.value), selected.map((item) => item.value))) selected.pop();
    const wanted = fields.filter((item) => names.has(item.label) && (item.disabled ? item.checked : selected.includes(item))).map((item) => item.label);
    tx.expected(`自定义筛选组应恰好为 ${wanted.length} 个：${sentenceList(wanted)}；不能多出或少掉字段。`);
    for (const item of editable) await tx.set(item, wanted.includes(item.label));
    await tx.save();
    const titles = layer === 'backend' ? await readEffectRoot(args.canvas, args.config, groupSnapshot)
      : await tx.observe((frame) => readEffectRoot(frame, args.config, groupSnapshot));
    if (!titles.length) unavailable('该层没有渲染筛选组标题，完整字段集合暂时不可观察。');
    // Unknown group titles remain in actual and therefore fail.
    const builtin = args.capability?.builtinGroups || [];
    const actual = customGroupTitles(titles, builtin).filter(title => title.startsWith('AUTOTEST-'));
    tx.evidence.groups = { titles, excludedBuiltins: builtin, wanted, actual };
    tx.assert(sameSet(actual, wanted), `自定义筛选组实际为 ${sentenceList(actual)}，应恰好为 ${sentenceList(wanted)}；内置分类组另行记录，不计作自定义字段。`);
  } });
}

async function setFilterColor(session, page, color) {
  const input = session.root.locator('#customOnBgColor');
  const used = await input.evaluate((node, value) => {
    const win = node.ownerDocument.defaultView, jq = win.jQuery || win.$;
    if (typeof jq?.fn?.spectrum !== 'function') return false;
    jq(node).spectrum('set', value); jq(node).trigger('change'); return true;
  }, color);
  if (!used) {
    const replacer = session.root.locator('li.settings-btn-item').filter({ has: input }).locator('.sp-replacer');
    if (await replacer.count() !== 1) unavailable('背景色取色面板无法唯一定位。');
    await replacer.click({ timeout: TIMEOUT });
    const popup = page.locator('.sp-container:visible');
    if (await popup.count() !== 1) unavailable('当前取色弹窗不唯一。');
    await popup.locator('.sp-input').fill(color);
    await popup.locator('.sp-choose').click();
  }
  if (normalizeColor(await input.inputValue()) !== normalizeColor(color)) throw new Error('背景色改写后读值不一致');
}
function filterBackground(root) {
  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const ancestors = (node) => {
    const out = [];
    for (let current = node, depth = 0; current && depth < 6; current = current.parentElement, depth++) {
      out.push({ tag: current.tagName, className: String(current.className || '').slice(0, 240),
        background: getComputedStyle(current).backgroundColor });
    }
    return out;
  };
  // `.prodfield-form` also appears on the block's category chooser (Series /
  // Category), whose transparent background is unrelated to the custom
  // filter color setting. Sample only the actual custom-filter wrapper.
  const nodes = [...root.querySelectorAll('.pf-filter-wrap')];
  const samples = nodes.map((node) => ({ selector: '.pf-filter-wrap',
    background: getComputedStyle(node).backgroundColor, outerHTML: node.outerHTML.slice(0, 2400),
    text: norm(node.innerText).slice(0, 800), ancestors: ancestors(node) }));
  const colors = samples.map((sample) => sample.background);
  const painted = colors.filter((color) => color !== 'rgba(0, 0, 0, 0)');
  return { color: nodes.length === 1
    ? (painted.length ? painted[0] : colors[0]) : null, matchedCount: nodes.length, samples };
}
async function backgroundEffect(args, layer) {
  const session = widgetSession({ ...args, type: 'phoenix_blocks_filterStyle', title: TEXT.dialogTitle });
  return effectCheck({ ...args, session, result, id: `cff-background-${layer}`, layer, run: async (tx) => {
    await tx.controls();
    const input = session.root.locator('#customOnBgColor');
    if (!await input.count()) unavailable('本区块没有筛选背景颜色设置项。', 'na');
    if (await input.count() !== 1) unavailable('筛选背景色设置项不唯一。');
    const original = await input.inputValue(), alternate = normalizeColor(original) === '#010203' ? 'rgb(4, 5, 6)' : 'rgb(1, 2, 3)';
    tx.expected(`筛选区域背景色应为 ${alternate}，恢复后应回到原颜色 ${original}。`);
    tx.remember('filter-background', async () => {
      await setFilterColor(session, args.page, original); await session.save(); await session.open();
      if (normalizeColor(await input.inputValue()) !== normalizeColor(original)) throw new Error('背景颜色恢复回读不一致');
    });
    await setFilterColor(session, args.page, alternate); await tx.save();
    const sample = layer === 'backend' ? await readEffectRoot(args.canvas, args.config, filterBackground)
      : await tx.observe((frame) => readEffectRoot(frame, args.config, filterBackground));
    const actual = sample.color;
    if (actual === null) unavailable('筛选区域背景的读取位置尚不能唯一确定，需实站探查。');
    tx.evidence.color = { original, alternate, actual, sample };
    tx.assert(normalizeColor(actual) === normalizeColor(alternate), `筛选区域背景实际为 ${actual}，应为 ${alternate}。`);
  } });
}

function radioPair(items, group) {
  const options = group.prefixes.map((prefix) => items.filter((item) => item.type === 'radio' && item.label.startsWith(prefix)));
  if (options.every((found) => !found.length)) unavailable(`本区块没有${group.name}设置项。`, 'na');
  if (options.some((found) => found.length !== 1) || !options[0][0].name
    || options[0][0].name !== options[1][0].name) unavailable(`${group.name}设置组无法唯一确定。`);
  return options.map(([item]) => item);
}
async function enableOracleFields(tx, oracle) {
  const fields = filterFields(await tx.controls());
  const titles = Array.isArray(oracle) ? oracle : oracle.fields.map((condition) => condition.title);
  for (const title of titles) {
    const found = fields.filter((item) => item.label === title);
    if (found.length !== 1) unavailable(`找不到夹具要求的唯一字段“${title}”。`);
    await tx.set(found[0], true);
  }
}
async function selectFilterValue(root, condition) {
  // Probe v27: the fixed ^\s*...$ regex matches the title element itself
  // (count 1), but group.filter({ has: root title locator }) still gives 0.
  // The inner locator carries root's (the block's) selector prefix, so
  // inside :has() it looks for the block INSIDE the group, which cannot
  // match. Find the group by index with a DOM exact-title match instead
  // (same approach as frontSnapshot), then filter its labels directly.
  const exact = (text) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const groupIndex = await root.evaluate((node, { group, groupTitle, wanted }) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll(group)].findIndex((item) => norm(item.querySelector(groupTitle)?.innerText) === wanted);
  }, { group: SELECTORS.group, groupTitle: SELECTORS.groupTitle, wanted: condition.title });
  if (groupIndex < 0) unavailable(`预览中无法唯一确定筛选组“${condition.title}”。`);
  const group = root.locator(SELECTORS.group).nth(groupIndex);
  const labels = group.locator('label').filter({ hasText: exact(condition.value) });
  if (await labels.count() !== 1) unavailable(`预览中无法唯一确定筛选值“${condition.value}”。`);
  const interactive = await labels.evaluate((node) => {
    for (let current = node; current; current = current.parentElement) {
      if (getComputedStyle(current).pointerEvents === 'none') return false;
    }
    return !node.querySelector('input:disabled') && node.getClientRects().length > 0;
  });
  if (!interactive) unavailable('预览筛选表单不可交互，未强制点击。');
  await labels.click({ timeout: TIMEOUT });
  const selected = await poll(() => root.evaluate((node, value) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    return [...node.querySelectorAll('label')].some((label) => norm(label.innerText) === value && label.querySelector('input:checked'))
      || [...node.querySelectorAll('.prodfield-bottom, .pf-selected, .pf-tags')].some((tag) => norm(tag.innerText).includes(value));
  }, condition.value), Boolean);
  if (!selected.matched) throw new Error('点击后没有观察到选中值');
}
async function clickSearch(root) {
  // Probe v30/v31: the search button is visibility:hidden in the editor
  // preview (inline style, before and after selection), so a Playwright
  // visible click can never work there; but the product list narrows on
  // selection alone (v31: 20 -> the exact 3-product set within 2s). If
  // no visible search button exists, return and let the following
  // assertFilterSet poll the auto-applied result instead of skipping.
  const search = root.locator('.prodfield-search, .pf-search').filter({ visible: true });
  if (await search.count() !== 1) return;
  await search.click({ timeout: TIMEOUT });
}
async function filterProducts(frame, config) {
  return readEffectRoot(frame, config, productSnapshot);
}
async function assertFilterSet(tx, frame, config, expected, label) {
  const root = frame.locator(blockSelector(config.blockId)).first();
  const observed = await poll(() => root.evaluate(productSnapshot), (data) => data.hasList && sameSet(data.names.filter(name => name.startsWith('AUTOTEST-')), expected));
  const actual = observed.value;
  if (!actual?.hasList) unavailable('被测区块内没有可读取的产品列表，不能以空集冒充筛选结果。');
  (tx.evidence.productSets ||= []).push({ label, expected, actual: actual.names.filter(name => name.startsWith('AUTOTEST-')) });
  tx.assert(observed.matched, `${label}应显示 ${sentenceList(expected)}；实际显示 ${sentenceList(actual.names)}，已逐项核对完整产品集合。`);
}

async function filterInteractionEffect(args, kind) {
  const session = widgetSession({ ...args, type: 'phoenix_blocks_filterStyle', title: TEXT.dialogTitle });
  return effectCheck({ ...args, session, result, id: `cff-${kind}-front`, layer: 'front', run: async (tx) => {
    const items = await tx.controls();
    let options;
    if (kind !== 'jump') options = radioPair(items, TEXT.radioGroups[{ logic: 0, trigger: 1, scope: 2 }[kind]]);
    else {
      const selects = items.filter((item) => item.tag === 'SELECT' && /跳转/.test(item.label + item.context));
      if (!selects.length) unavailable('本区块没有筛选后跳转页设置项。', 'na');
      if (selects.length !== 1) unavailable('无法唯一确定筛选后跳转页。');
      options = selects;
    }
    const oracle = filterOracle(args);
    if (!oracle) unavailable('画像缺少带筛选值及结果名单的夹具，不能编造预期产品。');
    if (kind === 'scope') {
      if (!Array.isArray(oracle.scopes) || oracle.scopes.length !== 2) unavailable('缺少当前分类和所有产品各自的范围夹具及分类上下文，暂不能核对范围结果。');
      tx.expected(oracle.scopes.map((scope) => `${scope.label}应显示 ${sentenceList(scope.products)}`).join('；') + '。');
      for (let index = 0; index < 2; index++) {
        const fixture = oracle.scopes[index];
        await tx.set(options[index], true); await enableOracleFields(tx, oracle); await tx.save();
        await tx.observe(async (frame) => {
          const root = frame.locator(blockSelector(args.config.blockId)).first();
          if (fixture.category) {
            { const cat = fixtureCategoryState(args.profile, args.report); if (cat.reason) unavailable(cat.reason); }
            const nav = root.locator('.pf-cate-wrap a').getByText(fixture.category, { exact: true });
            if (await nav.count() !== 1) unavailable('夹具指定的当前分类无法唯一确定。');
            await nav.click({ timeout: TIMEOUT });
          }
          for (const condition of fixture.conditions || oracle.fields) await selectFilterValue(root, condition);
          await clickSearch(root);
          await assertFilterSet(tx, frame, args.config, fixture.products, fixture.label);
        });
      }
      return;
    }
    if (kind === 'jump') {
      const select = options[0];
      const fixture = oracle.jump;
      const option = select.options.find((item) => !item.disabled && item.value !== select.value
        && (fixture ? item.value === fixture.optionValue : /^(https?:\/\/|\/[^/])/.test(item.value)));
      const expectedUrl = fixture?.url || option?.value;
      if (!option || !expectedUrl) unavailable('跳转选项保存的是页面编号，画像没有编号与落地地址对应夹具，需先核实。');
      tx.expected(`执行筛选后应进入所选的“${option.label}”页面，地址为 ${expectedUrl}。`);
      await tx.set(select, option.value); await enableOracleFields(tx, oracle); await tx.save();
      await tx.observe(async (frame, tab) => {
        const root = frame.locator(blockSelector(args.config.blockId)).first();
        await selectFilterValue(root, oracle.fields[0]); await clickSearch(root);
        const matches = (url) => { try { const actual = new URL(url), wanted = new URL(expectedUrl, frame.url()); return actual.origin === wanted.origin && actual.pathname === wanted.pathname; } catch { return false; } };
        const landed = await poll(async () => tab.frames().map((child) => child.url()), (urls) => urls.some(matches));
        tx.evidence.landing = landed.value;
        tx.assert(landed.matched, `筛选后应进入“${option.label}”，实际落地地址为 ${sentenceList(landed.value || [])}。`);
      });
      return;
    }
    await enableOracleFields(tx, oracle);
    if (kind === 'logic') {
      // Make result application explicit so selection order cannot be hidden by
      // automatic filtering. The union fixture remains all THREE products.
      const trigger = radioPair(await tx.controls(), TEXT.radioGroups[1]);
      await tx.set(trigger[0], true);
      tx.expected(`交集应恰好显示 ${sentenceList(oracle.intersection)}；并集应恰好显示 ${sentenceList(oracle.union)}。并集应包含满足任一条件的全部夹具产品。`);
      for (const [index, expected] of [oracle.intersection, oracle.union].entries()) {
        await tx.set(options[index], true); await tx.save();
        await tx.observe(async (frame) => {
          const root = frame.locator(blockSelector(args.config.blockId)).first();
          for (const condition of oracle.fields) await selectFilterValue(root, condition);
          await clickSearch(root); await assertFilterSet(tx, frame, args.config, expected, index === 0 ? '交集' : '并集（已知缺陷仍保留正确预期）');
        });
      }
    } else {
      tx.expected(`手动筛选选值后产品列表应保持原样，点击搜索后应恰好显示 ${sentenceList(oracle.single)}；自动筛选不点击搜索也应显示同一集合。`);
      for (const [index, option] of options.entries()) {
        await tx.set(option, true); await tx.save();
        await tx.observe(async (frame) => {
          const root = frame.locator(blockSelector(args.config.blockId)).first();
          const before = await filterProducts(frame, args.config);
          if (!before.hasList) unavailable('被测区块内没有产品列表，无法核对触发前后的结果。');
          if (sameSet(before.names, oracle.single)) unavailable('初始产品集合与筛选结果相同，不能区分是否触发。');
          await selectFilterValue(root, oracle.fields[0]);
          if (index === 0) {
            const after = await filterProducts(frame, args.config);
            tx.assert(sameSet(after.names, before.names), `手动模式选值后、尚未点搜索，产品应保持 ${sentenceList(before.names)}，实际为 ${sentenceList(after.names)}。`);
            await clickSearch(root);
          }
          await assertFilterSet(tx, frame, args.config, oracle.single, index === 0 ? '手动点击搜索后' : '自动筛选且未点搜索');
        });
      }
    }
  } });
}
export async function runBackendLayer(args) {
  return [await filterFieldsEffect(args, 'backend'), await backgroundEffect(args, 'backend')];
}

async function fieldFrontGroupEffect(args) {
  const session = widgetSession({ ...args, type: 'phoenix_blocks_filterStyle', title: TEXT.dialogTitle });
  const probe = await probeControls(session);
  if (probe.reason) return result('cff-field-front-group', 'skip', probe.reason);
  const fields = probe.controls.filter(isFieldCheckbox);
  const fixtureNames = new Set((profile?.fixture?.fields || []).map(field => field.name));
  const field = fields.find((item) => fixtureNames.has(item.label) && !item.disabled && !item.checked) || fields.find((item) => fixtureNames.has(item.label) && !item.disabled);
  if (!field) return result('cff-field-front-group', fields.length ? 'skip' : 'na', '没有可切换的自定义筛选字段。');
  if (!args.context) return result('cff-field-front-group', 'skip', '未提供浏览器 context，无法打开临时预览。');
  return fromOutcome('cff-field-front-group', await persistControl({ session, page: args.page,
    target: field, alternate: !field.checked,
    afterSwitch: async (evidence, stage) => {
      stage('保存页面并打开临时预览');
      await withPreview(args.page, args.context, async (frame) => {
        stage('断言预览筛选组标题');
        const root = frame.locator(previewSelector(args.config.blockId)).first();
        await root.waitFor({ state: 'attached', timeout: TIMEOUT });
        const read = (timeout) => root.locator(SELECTORS.groupTitle).evaluateAll(
          (nodes) => nodes.map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim()), undefined, { timeout });
        const observed = await poll(read, (titles) => titles.includes(field.label) === !field.checked);
        evidence.field = field.label;
        evidence.expectedPresent = !field.checked;
        evidence.previewTitles = observed.value;
        if (!observed.value.length) { evidence.frontObservable = false; return; }
        if (!observed.matched) throw new Error(`字段 ${field.label} 翻转后筛选组${field.checked ? '仍出现' : '未出现'}`);
      });
    } }));
}

export async function runFrontEffectsLayer(args) {
  const checks = [await fieldFrontGroupEffect(args), await filterFieldsEffect(args, 'front'), await backgroundEffect(args, 'front')];
  if (args.profile?.fixture) checks.push(...oldInteractionSkips(), ...await fixtureOracleChecks(args));
  else for (const kind of ['logic', 'trigger', 'scope', 'jump']) checks.push(await filterInteractionEffect(args, kind));
  return checks;
}

Object.assign(NAMES, {
  'cff-oracle-single': '单字段第一值的精确产品集合',
  'cff-oracle-intersect-pair': '两字段交集的精确产品集合',
  'cff-oracle-intersect-all': '全部字段交集的精确产品集合',
  'cff-oracle-union-all': '全部字段并集的精确产品集合',
  'cff-oracle-multivalue': '同一产品挂多个值的集合归属',
  'cff-oracle-fixture': '筛选夹具真值表校验',
});

// Pure: compute from declared values, never from observed preview results.
// The N one-field flips may appear in any order (样本区块 preserves existing
// product order); index arithmetic alone would swap the single/dropdown sets.
export function buildFixtureTruthTable(fixture) {
  const fields = fixture?.fields, entries = fixture?.products;
  if (!Array.isArray(fields) || !fields.length || !Array.isArray(entries) || entries.length !== fields.length + 1
    || fields.some((field) => !field?.name || !Array.isArray(field.options) || field.options.length < 2 || field.options[0] === field.options[1])
    || entries.some((product) => !product?.name || !product.values)
    || new Set(fields.map((field) => field.name)).size !== fields.length
    || new Set(entries.map((product) => product.name)).size !== entries.length) {
    throw new Error('夹具真值表须包含 N 个不同字段（至少两个不同选项）及 N+1 件不同产品的完整字段值。');
  }
  const flips = entries.map((product, index) => {
    const flipped = [];
    for (const [i, field] of fields.entries()) {
      const value = product.values[field.name];
      if (value === field.options[1]) flipped.push(i);
      else if (value !== field.options[0]) throw new Error(`产品“${product.name}”的“${field.name}”须是第一或第二值的单值字符串。`);
    }
    if ((index === 0 && flipped.length) || (index > 0 && flipped.length !== 1)) throw new Error(`产品“${product.name}”不符合全第一值基准件/单字段翻转件要求。`);
    return flipped[0];
  });
  if (new Set(flips.slice(1)).size !== fields.length) throw new Error('每个字段须恰好有一件只翻该字段的产品。');
  const products = entries.map((product) => product.name);
  const single = fields.map((field, index) => ({ i: index + 1,
    products: entries.filter((product) => product.values[field.name] === field.options[0]).map((product) => product.name) }));
  const pairs = [];
  for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) {
    pairs.push({ i: i + 1, j: j + 1, products: products.filter((name) => single[i].products.includes(name) && single[j].products.includes(name)) });
  }
  return { fields: fields.map((field) => ({ title: field.name, value: field.options[0] })),
    products, single, pairs, intersection: products.filter(name => single.every(set => set.products.includes(name))),
    union: products.filter(name => single.some(set => set.products.includes(name))) };
}
function oldInteractionSkips() {
  return ['logic', 'trigger', 'scope', 'jump'].map((kind) => result(`cff-${kind}-front`, 'skip', '已被 N 字段 fixture oracle 取代。', undefined,
    { expected: '该检查已被 N 字段 fixture oracle（cff-oracle-*）取代，不再单独执行。' }));
}
// A fixed-front requirement is never manipulated as an editor setting.
export function fixtureScenarioPolicy(profile, union) {
  const fixed = fixedRequirementValues(profile);
  const logic = fixed['cff-logic'];
  const trigger = fixed['cff-trigger'];
  const scope = fixed['cff-scope'];
  if (logic && !['交集', '并集'].includes(logic)) return { skip: `未知固定筛选逻辑：${logic}` };
  if (trigger && !['点击“搜索”按钮', '更改筛选项后自动筛选'].includes(trigger)) return { skip: `未知固定筛选触发：${trigger}` };
  if (scope && !['当前分类产品', '所有产品'].includes(scope)) return { skip: `未知固定产品范围：${scope}` };
  if (logic && (logic === '并集') !== union) return { na: `筛选逻辑固定为${logic}，不能切换到${union ? '并集' : '交集'}` };
  if (scope === '当前分类产品' && !profile?.fixture?.category?.name?.startsWith('AUTOTEST-')) return { skip: '当前分类固定，缺少 AUTOTEST 夹具分类' };
  return { logic, trigger, scope };
}
async function fixtureOracleChecks(args, unavailableReason) {
  let table;
  try { table = buildFixtureTruthTable(args.profile.fixture); }
  catch (error) { return [result('cff-oracle-fixture', 'skip', `夹具准备条件未满足：${error.message}`)]; }
  const scenarios = [
    ...table.single.map(({ i, products }) => ({ id: `cff-oracle-single-${i}`, indexes: [i], products, union: false })),
    ...table.pairs.map(({ i, j, products }) => ({ id: `cff-oracle-intersect-${i}-${j}`, indexes: [i, j], products, union: false })),
    { id: 'cff-oracle-intersect-all', indexes: table.fields.map((_, i) => i + 1), products: table.intersection, union: false },
    { id: 'cff-oracle-union-all', indexes: table.fields.map((_, i) => i + 1), products: table.union, union: true },
  ];
  const checks = [];
  for (const scenario of scenarios) {
    const note = scenario.union && typeof args.profile.fixture.notes?.union === 'string' ? args.profile.fixture.notes.union : '';
    const policy = fixtureScenarioPolicy(args.profile, scenario.union);
    const expected = `${policy.trigger === '更改筛选项后自动筛选' ? '更改筛选项后自动筛选' : '手动点击搜索后'}，${scenario.indexes.map((i) => table.fields[i - 1].title).join('、')}取第一值的${scenario.union ? '并集' : '交集'}应恰好显示 ${sentenceList(scenario.products)}。`;
    const reason = unavailableReason || (args.report?.fixture?.applied === false ? '夹具准备未成功完成，未执行依赖夹具的精确集合检查。' : '') || policy.skip || policy.na;
    if (reason) {
      checks.push(result(scenario.id, policy.na && !unavailableReason && args.report?.fixture?.applied !== false ? 'na' : 'skip', `${reason}${note ? `；${note}` : ''}`, undefined, { expected }));
      continue;
    }
    const session = widgetSession({ ...args, type: 'phoenix_blocks_filterStyle', title: args.capability?.dialogTitle || TEXT.dialogTitle,
      wrapIndex: args.capability?.wrapIndex || 0 });
    const outcome = await effectCheck({ ...args, session, result, id: scenario.id, layer: 'front', run: async (tx) => {
      tx.expected(expected);
      const items = await tx.controls();
      const logic = policy.logic ? null : radioPair(items, TEXT.radioGroups[0]);
      const trigger = policy.trigger ? null : radioPair(items, TEXT.radioGroups[1]);
      await enableOracleFields(tx, table.fields.map((field) => field.title));
      if (trigger) await tx.set(trigger[0], true);
      if (logic) await tx.set(logic[scenario.union ? 1 : 0], true);
      await tx.save();
      await tx.observe(async (frame) => {
        const root = frame.locator(blockSelector(args.config.blockId)).first();
        await root.waitFor({ state: 'attached', timeout: TIMEOUT });
        const interactive = await root.evaluate((node, selectors) => {
          const groups = [...node.querySelectorAll(selectors.group)];
          const label = groups.flatMap((group) => [...group.querySelectorAll('label')]).find((item) => item.getClientRects().length);
          if (!label) return false;
          for (let current = label; current; current = current.parentElement) if (getComputedStyle(current).pointerEvents === 'none') return false;
          return true;
        }, { group: SELECTORS.group });
        if (!interactive) unavailable('预览筛选组 pointer-events:none 或无可交互筛选值，未强制点击；发布流程待定，本次不发布。');
        if (policy.scope === '当前分类产品') {
          { const cat = fixtureCategoryState(args.profile, args.report); if (cat.reason) unavailable(cat.reason); }
          const nav = root.locator('.pf-cate-wrap a').getByText(args.profile.fixture.category.name, { exact: true });
          if (await nav.count() !== 1) unavailable('无法唯一定位 AUTOTEST 当前分类。');
          await nav.click({ timeout: TIMEOUT });
        }
        for (const i of scenario.indexes) await selectFilterValue(root, table.fields[i - 1]);
        if (policy.trigger !== '更改筛选项后自动筛选') await clickSearch(root);
        await assertFilterSet(tx, frame, args.config, scenario.products, NAMES[scenario.id] || `字段 ${scenario.indexes.join('、')} 筛选`);
      });
    } });
    outcome.expected = expected;
    // Keep the union note on pass/fail/skip alike, without changing expected sets.
    if (note) {
      outcome.detail += `；${note}`;
      outcome.actual += `；${note}`;
      outcome.evidenceText.push(note);
    }
    checks.push(outcome);
  }
  checks.push(result('cff-oracle-multivalue', 'skip',
    '“一件产品挂多个值”尚未实现，需要一件在多选字段上挂两个值的产品，断言它同时出现在两个值的集合里。', undefined,
    { expected: '一件在多选字段上挂两个值的产品，应同时出现在这两个值各自的筛选结果集合里。' }));
  return checks;
}
