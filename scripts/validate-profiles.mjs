import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFixture } from '../src/fixture.mjs';
import { fixturePlan } from '../src/fixture-data.mjs';
import { signatures } from '../src/capabilities/signatures.mjs';
import { validateSiteBaseline } from '../src/site-baseline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const profilesDir = path.join(root, 'profiles');
const capabilitiesDir = path.join(root, 'src/capabilities');
const OPTIONAL_TEMPLATE_KEYS = new Set(['baselineNote', 'fixture', 'requirements']);

function matchesTemplateType(value, example) {
  if (Array.isArray(example)) return Array.isArray(value);
  if (example !== null && typeof example === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === typeof example;
}

function validateBaseline(baseline, errors) {
  if (!Array.isArray(baseline)) {
    errors.push('baseline 必须是数组');
    return;
  }
  baseline.forEach((step, index) => {
    const label = `baseline[${index}]`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      errors.push(`${label} 必须是对象`);
      return;
    }
    if (typeof step.type !== 'string') errors.push(`${label}.type 必须是字符串`);
    // title 可为 null：占位步骤（want 为空），或 kind=button-popover（按钮浮层无对话框标题）。
    if (step.title !== null && typeof step.title !== 'string') errors.push(`${label}.title 必须是字符串或 null`);
    if (step.title === null && step.kind !== 'button-popover' && step.want?.length) errors.push(`${label}.title 为 null 时 want 必须为空（button-popover 步骤除外）`);
    if (typeof step.wrapIndex !== 'number' || !Number.isFinite(step.wrapIndex)) {
      errors.push(`${label}.wrapIndex 必须是数字`);
    }
    if (!Array.isArray(step.want)) {
      errors.push(`${label}.want 必须是数组`);
      return;
    }
    step.want.forEach((wanted, wantedIndex) => {
      const wantedLabel = `${label}.want[${wantedIndex}]`;
      if (!wanted || typeof wanted !== 'object' || Array.isArray(wanted)) {
        errors.push(`${wantedLabel} 必须是对象`);
        return;
      }
      if (typeof wanted.label !== 'string') errors.push(`${wantedLabel}.label 必须是字符串`);
      if (typeof wanted.type !== 'string') errors.push(`${wantedLabel}.type 必须是字符串`);
      if (!Object.hasOwn(wanted, 'to') || wanted.to === null || typeof wanted.to === 'object') {
        errors.push(`${wantedLabel}.to 必须存在且为字符串、数字或布尔值`);
      }
    });
  });
}

export function validateProfile(profile, template, { capabilities } = {}) {
  const errors = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return ['画像顶层必须是对象'];
  }
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    return ['模板顶层必须是对象'];
  }

  // These sections are absent from one of the two established profiles.
  // They remain optional, but are type-checked whenever a profile supplies them.
  for (const [key, example] of Object.entries(template)) {
    if (!Object.hasOwn(profile, key)) {
      if (!OPTIONAL_TEMPLATE_KEYS.has(key)) errors.push(`缺少必需顶层键 ${key}`);
      continue;
    }
    if (!matchesTemplateType(profile[key], example)) {
      errors.push(`顶层键 ${key} 类型错误：应为 ${Array.isArray(example) ? '数组' : typeof example}`);
    }
  }

  if (profile.requirements && Object.hasOwn(profile.requirements, 'capabilities')) {
    const items = profile.requirements.capabilities;
    if (!Array.isArray(items)) errors.push('requirements.capabilities 必须是数组');
    else {
      const ids = new Set();
      items.forEach((item, index) => {
        const label = `requirements.capabilities[${index}]`;
        const discoveredStyle = item?.capability === 'discovered-style-controls'
          && item?.mode === 'editor-setting'
          && /^discovered-style-[a-z0-9-]+$/i.test(String(item?.id || ''))
          && ['color', 'font-size'].includes(item?.valueKind)
          && ['settings-dialog', 'right-rail-flyout'].includes(item?.lifecycleSurface)
          && item?.editorControl && typeof item.editorControl === 'object'
          && typeof item.editorControl.regionType === 'string'
          && Number.isInteger(item.editorControl.wrapIndex) && item.editorControl.wrapIndex >= 0
          && Number.isInteger(item.editorControl.index) && item.editorControl.index >= 0
          && typeof item.editorControl.type === 'string';
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string'
          || (!signatures.some(s => s.id === item.id) && !discoveredStyle)) errors.push(`${label}.id 必须是已知设置项 id 或有效的发现式样式设置项`);
        else if (ids.has(item.id)) errors.push(`${label}.id 重复：${item.id}`);
        else ids.add(item.id);
        if (item?.mode !== undefined && item.mode !== 'fixed-front'
          && !(discoveredStyle && item.mode === 'editor-setting')) errors.push(`${label}.mode 只能是 fixed-front 或有效的 editor-setting`);
        if (item?.mode === 'fixed-front' && (typeof item.fixedValue !== 'string' || !item.fixedValue)) errors.push(`${label}.fixedValue 必须是非空字符串（fixed-front 时）`);
        if (item?.fixedValue !== undefined && item?.mode !== 'fixed-front') errors.push(`${label}.fixedValue 只能与 mode=fixed-front 一起使用`);
        if (item?.params !== undefined && (!item.params || typeof item.params !== 'object' || Array.isArray(item.params))) errors.push(`${label}.params 必须是对象`);
        else if (item?.params) {
          if (item.params.dialogTitle !== undefined && typeof item.params.dialogTitle !== 'string') errors.push(`${label}.params.dialogTitle 必须是字符串`);
          if (item.params.wrapIndex !== undefined && (!Number.isInteger(item.params.wrapIndex) || item.params.wrapIndex < 0)) errors.push(`${label}.params.wrapIndex 必须是非负整数`);
        }
        if (item?.styleEffect !== undefined) {
          const effect = item.styleEffect;
          if (!effect || typeof effect !== 'object' || !Array.isArray(effect.properties) || !effect.properties.length
            || !effect.properties.every((property) => typeof property === 'string' && /^[a-z][a-zA-Z0-9]*$/.test(property))) {
            errors.push(`${label}.styleEffect.properties 必须是非空 CSS 属性名数组`);
          }
          if (!Array.isArray(effect?.checks) || effect.checks.some((check) => !check || typeof check.checkId !== 'string'
            || !effect.properties.includes(check.property))) errors.push(`${label}.styleEffect.checks 必须引用已声明属性与 styleSpec 检查 id`);
          if (effect?.candidateSelectors !== undefined && (!Array.isArray(effect.candidateSelectors)
            || !effect.candidateSelectors.every((selector) => typeof selector === 'string' && selector.trim()))) {
            errors.push(`${label}.styleEffect.candidateSelectors 必须是非空选择器字符串数组`);
          }
          if (effect?.valueSource !== 'alternateValue'
            && (!effect?.valueMap || typeof effect.valueMap !== 'object' || Array.isArray(effect.valueMap))) {
            errors.push(`${label}.styleEffect 必须声明 valueSource=alternateValue 或 valueMap`);
          }
        }
      });
    }
  }

  if (profile.requirements && Object.hasOwn(profile.requirements, 'displayFieldTypes') && (!Array.isArray(profile.requirements.displayFieldTypes) || !profile.requirements.displayFieldTypes.every(v => typeof v === 'string'))) errors.push('requirements.displayFieldTypes 必须是字符串数组');

  if (Object.hasOwn(profile, 'baseline')) errors.push('baseline 必须位于 sites/<site-host>/<block-id>.baseline.json');
  if (Object.hasOwn(profile, 'fixture')) errors.push('fixture 是站点数据引用，必须放在 sites/<site-host>/<block-id>.baseline.json.fixtureRefs');

  if (Array.isArray(profile.capabilities)) {
    const ids = new Set();
    profile.capabilities.forEach((capability, index) => {
      const location = `capabilities[${index}]`;
      if (!capability || typeof capability !== 'object' || Array.isArray(capability)
        || typeof capability.id !== 'string' || !capability.id.trim()) {
        errors.push(`${location}.id 必须是非空字符串`);
        return;
      }
      if (ids.has(capability.id)) errors.push(`能力 id 重复：${capability.id}`);
      ids.add(capability.id);
      if (capability.styleSpec) {
        const checkIds = new Set((capability.styleSpec.items || []).map((item) => item.id));
        for (const requirement of Array.isArray(profile.requirements?.capabilities) ? profile.requirements.capabilities : []) {
          for (const check of requirement.styleEffect?.checks || []) {
            if (!checkIds.has(check.checkId)) errors.push(`${location}.styleSpec 缺少 styleEffect 检查项 ${check.checkId}`);
          }
        }
        for (const [itemIndex, item] of (capability.styleSpec.items || []).entries()) {
          const hasLearnedSelectors = Object.values(item.learnedSelectors || {}).some((entries) =>
            Array.isArray(entries) && entries.some((entry) => typeof entry?.selector === 'string' && entry.selector.trim()));
          if ((!Array.isArray(item.selectorCandidates) || !item.selectorCandidates.length)
            && !(item.autoLearned === true && item.learnedSelectorRequired === true
              && (item.selectorLearningPending === true || hasLearnedSelectors))) {
            errors.push(`${location}.styleSpec.items[${itemIndex}].selectorCandidates 必须是非空候选数组`);
          }
          if ((item.selectorCandidates || []).some((selector) => /blockCon\d+/i.test(selector))) {
            errors.push(`${location}.styleSpec.items[${itemIndex}] 不得使用生成的区块编号 class`);
          }
        }
      }
      if (capabilities && !capabilities.has(capability.id)) {
        errors.push(`未知能力 ${capability.id}：src/capabilities/${capability.id}.mjs 不存在`);
      }
    });
  }

  if (Object.hasOwn(profile, 'fixture')) {
    try {
      validateFixture(profile.fixture, profile.requirements);
      fixturePlan(profile);
    } catch (error) {
      errors.push(`fixture 无效：${error.message}`);
    }
  }
  return errors;
}

async function main() {
  const templatePath = path.join(profilesDir, 'TEMPLATE.json');
  let template;
  try {
    template = JSON.parse(await readFile(templatePath, 'utf8'));
  } catch (error) {
    console.error(`profiles/TEMPLATE.json: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const capabilityIds = new Set((await readdir(capabilitiesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs')
      && !['TEMPLATE.mjs', 'shared.mjs'].includes(entry.name))
    .map((entry) => entry.name.slice(0, -'.mjs'.length)));

  let failed = false;
  const files = (await readdir(profilesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'TEMPLATE.json')
    .map((entry) => entry.name)
    .sort();

  for (const filename of files) {
    const relativePath = `profiles/${filename}`;
    let profile;
    try {
      profile = JSON.parse(await readFile(path.join(profilesDir, filename), 'utf8'));
    } catch (error) {
      console.error(`${relativePath}: JSON 解析失败：${error.message}`);
      failed = true;
      continue;
    }
    const errors = validateProfile(profile, template, { capabilities: capabilityIds });
    const blockId = String(profile.blockId);
    const siteDirs = (await readdir(path.join(root, 'sites'), { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory());
    const siteBaselines = [];
    for (const siteDir of siteDirs) {
      const baselinePath = path.join(root, 'sites', siteDir.name, `${blockId}.baseline.json`);
      try {
        const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
        validateSiteBaseline(baseline, { siteHost: siteDir.name, blockId });
        if (baseline.fixtureRefs) {
          validateFixture(baseline.fixtureRefs, profile.requirements);
          fixturePlan({ ...profile, fixture: baseline.fixtureRefs });
        }
        siteBaselines.push(baselinePath);
      } catch (error) {
        if (error.code !== 'ENOENT') errors.push(`${path.relative(root, baselinePath)}: ${error.message}`);
      }
    }
    for (const error of errors) console.error(`${relativePath}: ${error}`);
    if (errors.length) failed = true;
  }

  if (failed) process.exitCode = 1;
  else console.log(`Profiles OK: ${files.length} profile(s) validated`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
