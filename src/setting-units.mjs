/**
 * Canonical per-setting unit contract used by capability fresh adapters.
 * Locators point back to a profile requirement; they never contain a site or
 * block-specific selector. Capability callbacks remain the assertion oracle.
 */
export const SETTING_UNIT_SURFACES = Object.freeze([
  'settings-dialog', 'canvas-popover', 'right-rail-flyout', 'whole-list', 'front-only',
]);

const aliases = Object.freeze({
  'btn-text-persist': 'btn-text', 'btn-url-persist': 'btn-url', 'btn-target-persist': 'btn-target',
  'pcs-category-persist': 'product-category', 'cff-settings-persist': 'cff-fields',
  'pld-data-source-persist': 'pld-data-source', 'pld-page-size-persist': 'pld-page-size',
  'pld-pagination-persist': 'pld-pagination', 'pld-compare-persist': 'pld-compare',
  'pld-display-field-persist': 'pld-display-fields', 'bcs-color-persist': 'color-scheme',
  'mw-width-persist': 'module-width',
});

export function createSettingUnit(input) {
  const unit = { ...input };
  const requiredStrings = ['id', 'capability', 'requirementId'];
  for (const key of requiredStrings) {
    if (typeof unit[key] !== 'string' || !unit[key].trim()) throw new Error(`Setting unit requires ${key}.`);
  }
  if (!unit.locate || unit.locate.source !== 'requirement-profile' || unit.locate.id !== unit.requirementId) {
    throw new Error(`Setting unit ${unit.id} must locate through its requirement profile.`);
  }
  if (!SETTING_UNIT_SURFACES.includes(unit.lifecycleSurface)) throw new Error(`Setting unit ${unit.id} has an unsupported lifecycle surface.`);
  if (!Array.isArray(unit.dependencies) || !Array.isArray(unit.persistedControls)) {
    throw new Error(`Setting unit ${unit.id} requires dependencies and persistedControls arrays.`);
  }
  if (!Object.hasOwn(unit, 'alternateValue')) throw new Error(`Setting unit ${unit.id} must declare alternateValue (null is allowed for check-only units).`);
  for (const key of ['apply', 'editorCheck', 'restore']) {
    if (typeof unit[key] !== 'function') throw new Error(`Setting unit ${unit.id} requires ${key}().`);
  }
  if (unit.frontCheck != null && typeof unit.frontCheck !== 'function') throw new Error(`Setting unit ${unit.id} frontCheck must be a function when declared.`);
  if (!Array.isArray(unit.frontRequires)) throw new Error(`Setting unit ${unit.id} requires frontRequires array.`);
  return Object.freeze(unit);
}

function profileRequirements(profile) {
  return profile?.requirements?.capabilities || [];
}

function requirementFor(setting, profile) {
  const requirements = profileRequirements(profile);
  const requested = setting.requirementId || aliases[setting.id] || setting.key;
  return requirements.find((item) => item.id === requested) || requirements.find((item) => item.id === setting.key) || null;
}

function lifecycleSurface(setting) {
  if (Array.isArray(setting.initialValue?.selected) && Array.isArray(setting.value?.selected)) return 'whole-list';
  if (setting.lifecycle?.kind) return setting.lifecycle.kind;
  return 'settings-dialog';
}

/** Lift existing capability-owned callbacks into the common, one-setting API. */
export function adaptCapabilityDefinitions({ capability, created, profile, metadata = {} }) {
  const settings = (created.settings || []).map((setting) => {
    const requirement = requirementFor(setting, profile);
    if (profileRequirements(profile).length && !requirement) {
      throw new Error(`Setting unit ${setting.id} has no matching requirement in the block profile.`);
    }
    const requirementId = requirement?.id || setting.requirementId || aliases[setting.id] || setting.key;
    const persistedControls = (created.persistedControls || []).flatMap((ref, index) => {
      if (ref.settingId) return ref.settingId === setting.id ? [ref] : [];
      if (created.settings.length === 1) return [ref];
      if (created.persistedControls.length === created.settings.length && created.settings[index]?.id === setting.id) return [ref];
      return [];
    });
    const batchMeta = metadata[setting.key] || {};
    return createSettingUnit({
      ...setting,
      capability,
      requirementId,
      locate: { source: 'requirement-profile', id: requirementId, requirement: requirement || null },
      lifecycleSurface: lifecycleSurface(setting),
      dependencies: [...new Set([...(setting.dependencies || []), ...(batchMeta.dependsOn || []),
        ...(batchMeta.requiresBaseline || []), ...(batchMeta.interferesWith || [])])],
      persistedControls,
      alternateValue: Object.hasOwn(setting, 'alternateValue') ? setting.alternateValue
        : Object.hasOwn(setting, 'value') ? setting.value : (setting.expected ?? null),
      apply: setting.apply,
      editorCheck: setting.check,
      frontCheck: setting.frontCheck || null,
      frontRequires: setting.frontRequires || [],
      restore: setting.restore,
    });
  });
  return { ...created, settings };
}

export function registerFreshSettingsCapability(capability, createDefinitions, { metadata, settingKeys } = {}) {
  if (typeof capability !== 'string' || typeof createDefinitions !== 'function') throw new Error('Fresh capability registration requires id and createDefinitions().');
  return Object.freeze({
    status: 'adapted', ...(metadata ? { metadata } : {}), ...(settingKeys ? { settingKeys } : {}),
    async createDefinitions(args = {}) {
      const created = await createDefinitions(args);
      return adaptCapabilityDefinitions({ capability, created, profile: args.profile, metadata });
    },
  });
}

export function assertFixedValueFront(expected, actual) {
  const pass = Object.is(actual, expected);
  return { status: pass ? 'pass' : 'fail', expected, actual,
    detail: pass ? '前台值与画像固定值一致。' : `前台值 ${JSON.stringify(actual)} 与画像固定值 ${JSON.stringify(expected)} 不一致。` };
}

/** Existing PLD oracle: site items may be present, but every fixture item and quantity rule still apply. */
export function assertAutotestTotalCount({ fixtureNames, actualNames, quantity }) {
  if (!Array.isArray(fixtureNames) || fixtureNames.length === 0) {
    return { status: 'skip', detail: '画像没有完整的 AUTOTEST 产品名单，无法执行总数断言。' };
  }
  const counts = Object.fromEntries(fixtureNames.map((name) => [name, actualNames.filter((item) => item === name).length]));
  const allFixturesPresent = fixtureNames.every((name) => counts[name] > 0);
  const countWithinQuantity = Number.isFinite(Number(quantity)) && actualNames.length <= Number(quantity);
  return { status: allFixturesPresent && countWithinQuantity ? 'pass' : 'fail', expected: {
    allFixtureNamesPresent: [...fixtureNames], countAtMost: Number(quantity),
  }, actual: { fixtureCounts: counts, visibleCount: actualNames.length },
  detail: `不分页时所有 AUTOTEST 产品均应出现，列表总数不超过显示数量 ${quantity}；当前可见 ${actualNames.length} 项。` };
}

/** Build a generic radio setting from option identities declared in a profile. */
export async function createProfileRadioSettingUnit(requirement, editorAdapter) {
  if (!requirement?.id || requirement?.editorControl?.type !== 'radio'
    || !Array.isArray(requirement.editorControl.options) || requirement.editorControl.options.length < 2) {
    throw new Error('Profile radio unit requires an id and at least two declared radio options.');
  }
  if (!editorAdapter || !['read', 'write'].every((method) => typeof editorAdapter[method] === 'function')) {
    throw new Error(`Profile radio unit ${requirement.id} requires editorAdapter read/write operations.`);
  }
  const original = await editorAdapter.read(requirement);
  const alternate = requirement.alternateValue;
  if (!requirement.editorControl.options.some((option) => Object.is(option.value, alternate))) {
    throw new Error(`Profile radio unit ${requirement.id} alternateValue is not one of its declared options.`);
  }
  if (!requirement.editorControl.options.some((option) => Object.is(option.value, original))) {
    throw new Error(`Profile radio unit ${requirement.id} current value is not a declared option.`);
  }
  const persistedControls = requirement.persistedControls || [];
  return createSettingUnit({
    id: requirement.unitId || requirement.id,
    capability: requirement.capability || 'profile-settings',
    requirementId: requirement.id,
    locate: { source: 'requirement-profile', id: requirement.id, requirement },
    lifecycleSurface: requirement.lifecycleSurface || 'settings-dialog',
    dependencies: requirement.dependencies || [],
    persistedControls,
    alternateValue: alternate,
    apply: async () => editorAdapter.write(requirement, alternate),
    editorCheck: async () => {
      const actual = await editorAdapter.read(requirement);
      return { status: Object.is(actual, alternate) ? 'pass' : 'fail', expected: alternate, actual };
    },
    check: async () => {
      const actual = await editorAdapter.read(requirement);
      return { status: Object.is(actual, alternate) ? 'pass' : 'fail', expected: alternate, actual };
    },
    restore: async () => editorAdapter.write(requirement, original),
    frontRequires: requirement.frontRequires || [],
    frontCheck: requirement.frontAssertion && typeof editorAdapter.readFront === 'function'
      ? async () => assertFixedValueFront(alternate, await editorAdapter.readFront(requirement.frontAssertion))
      : null,
    initialValue: original,
    key: requirement.key || requirement.id,
  });
}

/**
 * Profile-driven front-only units. Box runs have no front reader and therefore
 * report deferred; Mac/front runners may supply readFrontValue/readFrontProducts.
 */
export async function discoverProfileFrontUnits(profile, { frontAvailable = false, readFrontValue, readFrontProducts,
  profileEditorAdapter } = {}) {
  const requirements = profileRequirements(profile);
  const declared = new Map(requirements.map((item) => [item.id, item]));
  const results = [];
  const units = [];
  const editorSettings = [];
  for (const id of ['block-expand-collapse', 'block-enable-toggle']) {
    if (!declared.has(id)) results.push({ id: `${id}-unit`, status: 'not-applicable',
      expected: 'Profile declares this setting unit.', actual: 'Profile has no matching requirement.' });
  }
  for (const id of ['block-expand-collapse', 'block-enable-toggle']) {
    const requirement = declared.get(id);
    if (!requirement) continue;
    if (!profileEditorAdapter || !requirement.editorControl) {
      results.push({ id: `${id}-unit`, status: 'not-adapted', expected: 'A uniquely locatable profile radio control.',
        actual: 'No common editor adapter or profile option inventory is available.',
        detail: requirement.editorControl ? 'Profile declares the setting; this runner has no generic profile editor adapter.'
          : 'Profile setting declaration lacks an editorControl option inventory.' });
    } else editorSettings.push(await createProfileRadioSettingUnit(requirement, profileEditorAdapter));
  }
  const countRequirement = declared.get('pld-product-count');
  if (countRequirement) {
    units.push(createSettingUnit({ id: 'pld-product-total-count-front', capability: 'product-list-display',
      requirementId: countRequirement.id, locate: { source: 'requirement-profile', id: countRequirement.id, requirement: countRequirement },
      lifecycleSurface: 'front-only', dependencies: ['pld-pagination', 'pld-page-size'], persistedControls: [],
      alternateValue: null, apply: async () => {}, editorCheck: async () => ({ status: 'deferred', detail: 'Front-only assertion.' }),
      restore: async () => {}, frontRequires: ['pagination=否', 'complete-AUTOTEST-product-fixture'],
      frontCheck: async ({ profile: p, frontAvailable: available = frontAvailable,
        readProducts = readFrontProducts } = {}) => {
        if (!available || typeof readProducts !== 'function') return { status: 'deferred', deferredTo: 'Mac front-end runner',
          detail: '盒子端无法读取发布页面，产品总数前台断言延后至 Mac。' };
        const observation = await readProducts(countRequirement);
        if (observation.pagination !== false) return { status: 'skip',
          detail: '总数断言要求分页设置为否；当前回读不是不分页状态。' };
        return assertAutotestTotalCount({ fixtureNames: p?.fixture?.products?.map((item) => item.name),
          actualNames: observation.names, quantity: observation.quantity });
      } }));
  }
  for (const requirement of requirements.filter((item) => item.mode === 'fixed-front' && Object.hasOwn(item, 'fixedValue'))) {
    units.push(createSettingUnit({ id: `${requirement.id}-fixed-front`, capability: 'profile-fixed-front',
      requirementId: requirement.id, locate: { source: 'requirement-profile', id: requirement.id, requirement },
      lifecycleSurface: 'front-only', dependencies: [], persistedControls: [], alternateValue: requirement.fixedValue,
      apply: async () => {}, editorCheck: async () => ({ status: 'deferred', detail: 'Profile marks this value as fixed-front.' }),
      restore: async () => {}, frontRequires: requirement.frontRequires || ['profile-front-assertion'],
      frontCheck: async ({ profile: p, frontAvailable: available = frontAvailable,
        readValue = readFrontValue } = {}) => {
        if (!available || typeof readValue !== 'function') return { status: 'deferred', deferredTo: 'Mac front-end runner',
          detail: `固定值 ${requirement.id} 的前台验证延后至 Mac。` };
        if (!requirement.frontAssertion) return { status: 'skip', detail: `画像需求 ${requirement.id} 尚未声明 frontAssertion 定位方式。` };
        return assertFixedValueFront(requirement.fixedValue, await readValue(requirement.frontAssertion, p));
      } }));
  }
  return { units, editorSettings, results };
}

export async function runFrontSettingUnits(units, context = {}) {
  const results = [];
  for (const unit of units || []) {
    if (typeof unit.frontCheck !== 'function') continue;
    const outcome = await unit.frontCheck(context);
    results.push({ id: unit.id, status: outcome?.status || 'fail', setting: unit.requirementId,
      expected: outcome?.expected, actual: outcome?.actual, detail: outcome?.detail,
      ...(outcome?.deferredTo ? { deferredTo: outcome.deferredTo } : {}) });
  }
  return results;
}
