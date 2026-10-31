/**
 * Shared adapter for capability-owned fresh-setting definitions.
 * A capability opts in by exporting:
 *   freshSettings = { status: 'adapted', metadata, createDefinitions(context) }
 * Definitions return { settings, persistedControls }, where each setting has
 * id, key, apply(ctx), and check(ctx). persistedControls explicitly identify
 * the controls whose values are covered by the capability's persistence
 * assertions. Full inventories remain in the report, while transient controls
 * outside adapted definitions are reported as unverified instead of silently
 * becoming persistence assertions.
 */
export const FRESH_LIFECYCLE_KINDS = Object.freeze(['canvas-popover', 'right-rail-flyout']);

/**
 * Shared lifecycle wrapper for non-dialog capability surfaces. Capability
 * modules provide verified UI operations; this contract enforces open-state
 * sequencing and rejects unsupported lifecycle kinds.
 */
export function createFreshLifecycle(kind, operations = {}) {
  if (!FRESH_LIFECYCLE_KINDS.includes(kind)) throw new Error(`Unknown fresh settings lifecycle: ${kind}`);
  for (const method of ['open', 'read', 'apply', 'commit', 'cancel']) {
    if (typeof operations[method] !== 'function') throw new Error(`Fresh ${kind} lifecycle requires ${method}().`);
  }
  let opened = false;
  let dirty = false;
  return Object.freeze({
    kind,
    async open() { if (!opened) { await operations.open(); opened = true; } },
    async read(...args) {
      if (!opened) throw new Error(`Fresh ${kind} lifecycle read requires an open surface.`);
      return operations.read(...args);
    },
    async apply(...args) {
      if (!opened) throw new Error(`Fresh ${kind} lifecycle apply requires an open surface.`);
      await operations.apply(...args); dirty = true;
    },
    async commit(...args) {
      if (!opened) throw new Error(`Fresh ${kind} lifecycle commit requires an open surface.`);
      await operations.commit(...args); opened = false; dirty = false;
    },
    async cancel(...args) {
      if (!opened) return;
      await operations.cancel(...args); opened = false; dirty = false;
    },
    get isOpen() { return opened; },
    get hasUncommittedChanges() { return dirty; },
  });
}

export async function createFreshSettingsAdapter({ capabilities = [], context = {}, loadCapability }) {
  if (typeof loadCapability !== 'function') throw new Error('Fresh adapter requires a capability module loader.');
  const modules = [];
  for (const item of capabilities) {
    const id = typeof item === 'string' ? item : item.id;
    if (!/^[a-z0-9-]+$/i.test(String(id || ''))) throw new Error(`Invalid capability identifier: ${id}`);
    const module = await loadCapability(id);
    modules.push({ id, item, definition: module.freshSettings });
  }
  let prepared;
  const prepare = async (runtimeContext = {}) => {
    const mergedContext = { ...context, ...runtimeContext };
    const settings = [];
    const metadata = {};
    const capabilityResults = [];
    const staticResults = [];
    const persistedControls = [];
    const preparedModules = new Map();
    for (const { id, item, definition } of modules) {
      if (!definition || definition.status !== 'adapted' || typeof definition.createDefinitions !== 'function') {
        capabilityResults.push({ capability: id, status: 'not-adapted',
          reason: definition?.reason || 'Capability has not exported fresh setting definitions.' });
        continue;
      }
      const created = await definition.createDefinitions({ ...mergedContext, capability: item });
      if (!Array.isArray(created?.settings)) throw new Error(`Capability ${id} did not return a settings array.`);
      if (created.notAdaptedReason) {
        staticResults.push(...(created.staticResults || []));
        capabilityResults.push({ capability: id, status: 'not-adapted', reason: created.notAdaptedReason });
        continue;
      }
      for (const setting of created.settings) {
        if (setting.lifecycle && (!FRESH_LIFECYCLE_KINDS.includes(setting.lifecycle.kind)
          || ['open', 'read', 'apply', 'commit', 'cancel'].some((method) => typeof setting.lifecycle[method] !== 'function'))) {
          throw new Error(`Setting ${setting.id} has an unknown or incomplete fresh lifecycle.`);
        }
      }
      preparedModules.set(id, { definition, created });
      settings.push(...created.settings.map((setting) => ({ ...setting, capability: id })));
      staticResults.push(...(created.staticResults || []));
      persistedControls.push(...(created.persistedControls || []).map((control) => ({ ...control, capability: id })));
      Object.assign(metadata, definition.metadata || {}, created.metadata || {});
      capabilityResults.push({ capability: id, status: 'adapted', settingIds: created.settings.map((setting) => setting.id) });
    }
    const ids = settings.map((setting) => setting.id);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('Fresh capability setting ids must be present and globally unique.');
    const pendingCapabilities = new Set();
    const batchAdapter = {
      capture: async (items) => new Map(items.map((setting) => [setting.id, setting.initialValue])),
      apply: async (setting, phase) => {
        if (typeof setting.apply !== 'function') throw new Error(`Setting ${setting.id} has no apply definition.`);
        await setting.lifecycle?.open();
        await setting.captureEffect?.({ ...mergedContext, ...phase, setting });
        await setting.apply({ ...mergedContext, ...phase, setting });
        pendingCapabilities.add(setting.capability);
      },
      restore: async (setting, phase) => {
        if (typeof setting.restore !== 'function') throw new Error(`Setting ${setting.id} has no initial-value restore definition.`);
        await setting.lifecycle?.open();
        await setting.restore({ ...mergedContext, ...phase, setting });
        pendingCapabilities.add(setting.capability);
      },
      save: async (info) => {
        if (typeof mergedContext.save !== 'function') throw new Error('Fresh capability adapter has no page-save operation.');
        const active = [...preparedModules.entries()].filter(([id]) => pendingCapabilities.has(id));
        const committed = new Set();
        for (const [, { created }] of active) {
          for (const setting of created.settings) {
            if (setting.lifecycle && !committed.has(setting.lifecycle)) {
              committed.add(setting.lifecycle);
              await setting.lifecycle.commit({ reason: info?.reason, capability: setting.capability });
            }
          }
        }
        for (const [id, { definition, created }] of active) {
          const prepareSave = created.prepareSave || definition.prepareSave;
          await prepareSave?.({ ...mergedContext, reason: info?.reason, capability: id });
        }
        await mergedContext.save(info);
        for (const [id, { definition, created }] of active) {
          const afterSave = created.afterSave || definition.afterSave;
          await afterSave?.({ ...mergedContext, reason: info?.reason, capability: id });
        }
        pendingCapabilities.clear();
      },
      check: async (setting, phase) => {
        if (typeof setting.check !== 'function') throw new Error(`Setting ${setting.id} has no assertion definition.`);
        return setting.check({ ...mergedContext, ...phase, setting });
      },
    };
    prepared = { settings, metadata, capabilityResults, staticResults, persistedControls, batchAdapter };
    return prepared;
  };
  return { prepare, get prepared() { return prepared; } };
}

export function currentValuesFromInventory(inventory) {
  const values = [];
  for (const region of inventory || []) {
    for (const [index, control] of (region.controls || []).entries()) {
      const sensitive = control.type === 'password' || /password|token|secret|credential|密钥|密码/i.test(control.label || '');
      const value = sensitive ? '[redacted]' : control.type === 'checkbox' || control.type === 'radio'
        ? Boolean(control.checked) : (control.value ?? null);
      const identityValue = sensitive ? '[redacted]' : (control.value || '');
      values.push({ controlIdentity: `${region.type}:${region.wrapIndex}:${region.title || region.kind || ''}:${control.type}:${control.label || ''}:${identityValue}:${index}`,
        controlIndex: control.index ?? index,
        region: region.title || region.kind || region.type, label: control.label || '', type: control.type, value });
    }
  }
  return values;
}

export function projectPersistedFreshValues(values, persistedControls) {
  const projected = [];
  for (const reference of persistedControls || []) {
    const matches = (values || []).filter((value) => value.region === reference.region
      && value.controlIndex === reference.controlIndex && value.type === reference.type);
    if (matches.length !== 1) {
      const observed = (values || []).slice(0, 4).map((value) => `${value.region}/${value.controlIndex}/${value.type}`).join(',');
      throw new Error(`Persisted control ${reference.settingId || reference.capability || ''} (${reference.region}, index ${reference.controlIndex}, ${reference.type}) resolved ${matches.length} inventory controls; expected exactly one. First controls: ${observed}`);
    }
    projected.push(matches[0]);
  }
  if (new Set(projected.map((item) => item.controlIdentity)).size !== projected.length) {
    throw new Error('Fresh persisted-control references are not unique.');
  }
  return projected;
}
