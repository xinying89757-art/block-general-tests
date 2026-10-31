/**
 * Shared adapter for capability-owned fresh-setting definitions.
 * A capability opts in by exporting:
 *   freshSettings = { status: 'adapted', metadata, createDefinitions(context) }
 * Definitions return { settings }, where each setting has id, key, apply(ctx),
 * and check(ctx). Definitions that have not been converted are reported
 * explicitly and never treated as passing checks.
 */
export async function createFreshSettingsAdapter({ capabilities = [], context = {}, loadCapability }) {
  if (typeof loadCapability !== 'function') throw new Error('Fresh adapter requires a capability module loader.');
  const settings = [];
  const metadata = {};
  const capabilityResults = [];
  for (const item of capabilities) {
    const id = typeof item === 'string' ? item : item.id;
    if (!/^[a-z0-9-]+$/i.test(String(id || ''))) throw new Error(`Invalid capability identifier: ${id}`);
    const module = await loadCapability(id);
    const definition = module.freshSettings;
    if (!definition || definition.status !== 'adapted' || typeof definition.createDefinitions !== 'function') {
      capabilityResults.push({ capability: id, status: 'not-adapted',
        reason: definition?.reason || 'Capability has not exported fresh setting definitions.' });
      continue;
    }
    const created = await definition.createDefinitions({ ...context, capability: item });
    if (!Array.isArray(created?.settings)) throw new Error(`Capability ${id} did not return a settings array.`);
    settings.push(...created.settings.map((setting) => ({ ...setting, capability: id })));
    Object.assign(metadata, definition.metadata || {}, created.metadata || {});
    capabilityResults.push({ capability: id, status: 'adapted', settingIds: created.settings.map((setting) => setting.id) });
  }
  const ids = settings.map((setting) => setting.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('Fresh capability setting ids must be present and globally unique.');
  const batchAdapter = {
    capture: async (items) => new Map(items.map((setting) => [setting.id, setting.initialValue])),
    apply: async (setting, phase) => {
      if (typeof setting.apply !== 'function') throw new Error(`Setting ${setting.id} has no apply definition.`);
      await setting.apply({ ...context, ...phase, setting });
    },
    save: async (info) => {
      if (typeof context.save !== 'function') throw new Error('Fresh capability adapter has no page-save operation.');
      await context.save(info);
    },
    check: async (setting, phase) => {
      if (typeof setting.check !== 'function') throw new Error(`Setting ${setting.id} has no assertion definition.`);
      return setting.check({ ...context, ...phase, setting });
    },
  };
  return { settings, metadata, capabilityResults, batchAdapter };
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
        region: region.title || region.kind || region.type, label: control.label || '', type: control.type, value });
    }
  }
  return values;
}
