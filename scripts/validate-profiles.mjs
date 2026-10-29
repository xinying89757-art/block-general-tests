import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFixture } from '../src/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const profilesDir = path.join(root, 'profiles');
const capabilitiesDir = path.join(root, 'src/capabilities');
const OPTIONAL_TEMPLATE_KEYS = new Set(['baseline', 'baselineNote', 'fixture']);

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
    // title 可为 null：画像中 want 为空、仅占位的步骤（如 47748 的按钮步骤）没有标题。
    if (step.title !== null && typeof step.title !== 'string') errors.push(`${label}.title 必须是字符串或 null`);
    if (step.title === null && step.want?.length) errors.push(`${label}.title 为 null 时 want 必须为空`);
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

  if (Object.hasOwn(profile, 'baseline')) validateBaseline(profile.baseline, errors);

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
      if (capabilities && !capabilities.has(capability.id)) {
        errors.push(`未知能力 ${capability.id}：src/capabilities/${capability.id}.mjs 不存在`);
      }
    });
  }

  if (Object.hasOwn(profile, 'fixture')) {
    try {
      validateFixture(profile.fixture);
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
    for (const error of errors) console.error(`${relativePath}: ${error}`);
    if (errors.length) failed = true;
  }

  if (failed) process.exitCode = 1;
  else console.log(`Profiles OK: ${files.length} profile(s) validated`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
