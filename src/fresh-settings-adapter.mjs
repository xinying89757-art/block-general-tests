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
import { discoverProfileFrontUnits, runFrontSettingUnits } from './setting-units.mjs';
import { createDiscoveredStyleSettingUnits } from './discovered-style-settings.mjs';
import { runDesignSpecEditorChecks } from './design-spec-checklist.mjs';
import { applyLearnedStyleEffects, clearLearnedStyleEffects, deriveSelectorCandidatesFromDom,
  deriveStyleEffectPaths, resolveSettingStyleEffect, snapshotInstanceComputedStyles } from './style-effect-learning.mjs';
export const FRESH_LIFECYCLE_KINDS = Object.freeze(['settings-dialog', 'canvas-popover', 'right-rail-flyout']);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function learnAppliedStyleEffect({ capture, context }) {
  if (capture.error) return { status: 'na', reason: capture.reason || 'before-snapshot-unavailable',
    learned: { status: 'na', reason: capture.reason || 'before-snapshot-unavailable', effects: [] },
    applied: { applied: [], candidateCount: 0 } };
  let after;
  let learned = { status: 'na', reason: 'no-computed-style-property-changed', effects: [] };
  const attempts = Math.max(1, Math.min(12, Number(context.config?.styleEffectSnapshotAttempts) || 8));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    after = await snapshotInstanceComputedStyles(context.canvas || context.frame, {
      blockId: context.blockId || context.config?.blockId,
      settingId: context.config?.freshSettingId || context.instance?.settingId,
      properties: capture.styleEffect.properties,
      expectedValues: capture.styleEffect.expectedValues,
      timeoutMs: context.config?.actionTimeoutMs,
    });
    if (after.status === 'ok') {
      const effectWithResolvedValues = { ...capture.styleEffect,
        expectedValues: after.resolvedExpectedValues || capture.styleEffect.expectedValues };
      learned = deriveStyleEffectPaths(capture.before.elements || [], after.elements || [], effectWithResolvedValues);
      if (learned.status === 'learned') break;
    } else learned = { status: 'na', reason: after.reason || 'after-snapshot-unavailable', effects: [] };
    if (attempt + 1 < attempts) await pause(Number(context.config?.styleEffectSnapshotIntervalMs) || 125);
  }
  if (after?.status !== 'ok') return { status: 'na', reason: learned.reason || 'after-snapshot-unavailable', learned, applied: { applied: [], candidateCount: 0 } };
  learned.candidateSelectors = deriveSelectorCandidatesFromDom(capture.before.elements || [])
    .slice(0, 100).map((entry) => entry.selector);
  const applied = applyLearnedStyleEffects(context.profile, capture.styleEffect, learned);
  return { status: applied.status, reason: applied.reason || learned.reason || null, learned, applied };
}

/**
 * Shared lifecycle wrapper for non-dialog capability surfaces. Capability
 * modules provide verified UI operations; this contract enforces open-state
 * sequencing and rejects unsupported lifecycle kinds.
 */
export function createFreshLifecycle(kind, operations = {}) {
  if (!FRESH_LIFECYCLE_KINDS.includes(kind)) throw new Error(`Unknown fresh settings lifecycle: ${kind}`);
  const required = ['open', 'read', 'apply', 'commit', ...(kind !== 'canvas-popover' ? ['cancel'] : [])];
  for (const method of required) {
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
      if (typeof operations.cancel !== 'function') throw new Error(`Fresh ${kind} lifecycle has no verified non-saving cancel operation.`);
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
    const postPublishDefinitions = [];
    const styleScopeDiagnostics = [];
    const pendingStyleCaptures = new Map();
    const inventoryErrors = (mergedContext.inventory || []).filter((region) => region?.inventoryError);
    staticResults.push(...await runDesignSpecEditorChecks(mergedContext.profile, mergedContext.inventory || []));
    const profileUnits = await discoverProfileFrontUnits(mergedContext.profile, {
      frontAvailable: Boolean(mergedContext.frontAvailable),
      readFrontValue: mergedContext.readFrontValue,
      readFrontProducts: mergedContext.readFrontProducts,
      profileEditorAdapter: mergedContext.profileEditorAdapter,
    });
    staticResults.push(...profileUnits.results);
    if (profileUnits.editorSettings.length) {
      settings.push(...profileUnits.editorSettings);
      capabilityResults.push({ capability: 'profile-settings', status: 'adapted',
        settingIds: profileUnits.editorSettings.map((unit) => unit.id) });
    }
    for (const { id, item, definition } of modules) {
      const affectedInventoryError = inventoryErrors.find((region) =>
        (definition?.metadata?.inventoryRegions || []).includes(region.inventoryError.regionType));
      if (affectedInventoryError) {
        const failure = affectedInventoryError.inventoryError;
        const diagnostics = failure.diagnostics || {};
        const reason = `Settings inventory for ${failure.regionType} failed (${failure.code}); snapshots=${diagnostics.snapshotCount ?? 'unknown'}, elapsedMs=${diagnostics.elapsedMs ?? 'unknown'}, changingFields=${(diagnostics.changingFields || []).join(',') || 'none'}, unreadableFields=${(diagnostics.unreadableFields || []).join(',') || 'none'}, loadingMaskVisible=${diagnostics.loadingMaskVisible ?? 'unknown'}.`;
        capabilityResults.push({ capability: id, status: 'not-adapted', reason,
          inventoryError: { regionType: failure.regionType, code: failure.code, diagnostics, screenshot: failure.screenshot || null } });
        staticResults.push({ id: `${id}-inventory`, name: `${id} settings inventory`, suite: `capability:${id}`,
          status: 'fail', classification: 'harness-error', expected: `The ${failure.regionType} settings surface is readable.`,
          actual: failure.message, detail: reason, evidence: { ...diagnostics, screenshot: failure.screenshot || null } });
        continue;
      }
      if (definition?.status === 'check-only' && typeof definition.runPostPublish === 'function') {
        postPublishDefinitions.push({ id, item, definition });
        capabilityResults.push({ capability: id, status: 'check-only',
          reason: 'Runs its existing profile-driven assertions after page publication; it does not write block settings.' });
        continue;
      }
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
          || ['open', 'read', 'apply', 'commit'].some((method) => typeof setting.lifecycle[method] !== 'function')
          || (setting.lifecycle.kind !== 'canvas-popover' && typeof setting.lifecycle.cancel !== 'function'))) {
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
    const discoveredStyle = await createDiscoveredStyleSettingUnits({ inventory: mergedContext.inventory || [],
      persistedControls, profile: mergedContext.profile, styleControlAdapter: mergedContext.styleControlAdapter });
    if (discoveredStyle.settings.length) {
      settings.push(...discoveredStyle.settings);
      persistedControls.push(...discoveredStyle.persistedControls);
      capabilityResults.push({ capability: 'discovered-style-controls', status: 'adapted',
        settingIds: discoveredStyle.settings.map((setting) => setting.id) });
      if (discoveredStyle.requirementsAdded) await mergedContext.persistProfile?.(mergedContext.profile);
    }
    const ids = settings.map((setting) => setting.id);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('Fresh capability setting ids must be present and globally unique.');
    const pendingCapabilities = new Set();
    const pendingLifecycles = new Set();
    let activeLifecycle = null;
    const activateSurface = async (setting) => {
      const lifecycle = setting.lifecycle;
      if (!lifecycle) return;
      if (activeLifecycle && activeLifecycle !== lifecycle && activeLifecycle.isOpen) {
        await activeLifecycle.commit({ reason: 'surface-switch', capability: activeLifecycle.capability });
      }
      await lifecycle.open();
      activeLifecycle = lifecycle;
      pendingLifecycles.add(lifecycle);
    };
    const batchAdapter = {
      capture: async (items) => new Map(items.map((setting) => [setting.id, setting.initialValue])),
      apply: async (setting, phase) => {
        if (typeof setting.apply !== 'function') throw new Error(`Setting ${setting.id} has no apply definition.`);
        if (setting.styleEffect) {
          const styleEffect = resolveSettingStyleEffect(setting);
          const cleared = clearLearnedStyleEffects(mergedContext.profile, styleEffect);
          if (cleared) await mergedContext.persistProfile?.(mergedContext.profile);
          try {
            const before = await snapshotInstanceComputedStyles(mergedContext.canvas || mergedContext.frame, {
              blockId: mergedContext.blockId || mergedContext.config?.blockId,
              settingId: mergedContext.config?.freshSettingId || mergedContext.instance?.settingId,
              properties: styleEffect.properties,
              timeoutMs: mergedContext.config?.actionTimeoutMs,
            });
            pendingStyleCaptures.set(setting.id, before.status === 'ok' ? { before, setting, styleEffect, phase, cleared }
              : { error: true, reason: before.reason || 'before-snapshot-unavailable', setting, styleEffect, phase, cleared });
          } catch {
            pendingStyleCaptures.set(setting.id, { error: true, reason: 'before-snapshot-threw',
              setting, styleEffect, phase, cleared });
          }
        }
        // Snapshot before opening a settings surface: opening a rail/dialog can
        // temporarily replace or cover the editor canvas subtree being measured.
        await activateSurface(setting);
        await setting.captureEffect?.({ ...mergedContext, ...phase, setting });
        await setting.apply({ ...mergedContext, ...phase, setting });
        const capture = pendingStyleCaptures.get(setting.id);
        if (capture) capture.outcome = await learnAppliedStyleEffect({ capture, context: mergedContext });
        pendingCapabilities.add(setting.capability);
      },
      restore: async (setting, phase) => {
        if (typeof setting.restore !== 'function') throw new Error(`Setting ${setting.id} has no initial-value restore definition.`);
        await activateSurface(setting);
        await setting.restore({ ...mergedContext, ...phase, setting });
        pendingCapabilities.add(setting.capability);
      },
      save: async (info) => {
        if (typeof mergedContext.save !== 'function') throw new Error('Fresh capability adapter has no page-save operation.');
        const active = [...preparedModules.entries()].filter(([id]) => pendingCapabilities.has(id));
        for (const lifecycle of pendingLifecycles) {
          if (lifecycle.isOpen) await lifecycle.commit({ reason: info?.reason, capability: lifecycle.capability });
        }
        for (const [id, { definition, created }] of active) {
          const prepareSave = created.prepareSave || definition.prepareSave;
          await prepareSave?.({ ...mergedContext, reason: info?.reason, capability: id });
        }
        if (pendingCapabilities.has('profile-settings')) {
          await mergedContext.profileEditorAdapter?.prepareSave?.(info);
        }
        await mergedContext.save(info);
        for (const [id, { definition, created }] of active) {
          const afterSave = created.afterSave || definition.afterSave;
          await afterSave?.({ ...mergedContext, reason: info?.reason, capability: id });
        }
        if (pendingCapabilities.has('profile-settings')) {
          await mergedContext.profileEditorAdapter?.afterSave?.(info);
        }
        for (const [settingId, capture] of pendingStyleCaptures) {
          const setting = capture.setting;
          let outcome = capture.outcome || { status: 'na', reason: 'style-effect-snapshot-not-completed', learned: { effects: [] }, applied: { applied: [], candidateCount: 0 } };
          const expectedValues = {};
          for (const item of outcome.applied?.applied || []) {
            const checkId = `bss-${item.checkId}`;
            expectedValues[checkId] ||= {};
            if (Object.hasOwn(item, 'expectedValue')) expectedValues[checkId][item.property] = item.expectedValue;
          }
          outcome = { status: outcome.status, reason: outcome.reason,
            changedElementCount: new Set((outcome.learned?.effects || []).map((effect) => effect.selector)).size,
            mappedCheckCount: outcome.applied?.applied?.length || 0,
            candidateCount: outcome.applied?.candidateCount || 0, expectedValues };
          if (capture.cleared || outcome.mappedCheckCount || outcome.candidateCount) await mergedContext.persistProfile?.(mergedContext.profile);
          if (capture.error && capture.cleared) await mergedContext.persistProfile?.(mergedContext.profile);
          styleScopeDiagnostics.push({ settingId, capability: setting.capability, status: outcome.status,
            reason: outcome.reason, changedElementCount: outcome.changedElementCount || 0,
            mappedCheckCount: outcome.mappedCheckCount || 0,
            fallbackCandidateCount: outcome.candidateCount || capture.styleEffect.candidateSelectors?.length || 0,
            expectedValues: outcome.expectedValues || {},
            phase: capture.phase?.phase || 'batch' });
        }
        pendingStyleCaptures.clear();
        pendingCapabilities.clear();
        pendingLifecycles.clear();
        activeLifecycle = null;
      },
      check: async (setting, phase) => {
        if (typeof setting.check !== 'function') throw new Error(`Setting ${setting.id} has no assertion definition.`);
        return setting.check({ ...mergedContext, ...phase, setting });
      },
    };
    prepared = { settings, metadata, capabilityResults, staticResults, persistedControls, batchAdapter, styleScopeDiagnostics,
      runPostPublishChecks: async (runtime = {}) => {
        const checks = [];
        for (const { definition, item } of postPublishDefinitions) {
          const outcome = await definition.runPostPublish({ ...mergedContext, ...runtime,
            settingsReport: runtime.settingsReport || { styleScopeLearning: styleScopeDiagnostics }, capability: item });
          if (!Array.isArray(outcome)) throw new Error(`Check-only capability ${item.id} did not return a checks array.`);
          checks.push(...outcome);
        }
        checks.push(...await runFrontSettingUnits(profileUnits.units, {
          ...mergedContext, ...runtime,
          frontAvailable: Boolean(runtime.frontAvailable ?? mergedContext.frontAvailable),
        }));
        return checks;
      } };
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
        region: region.regionKey || region.title || region.kind || region.type,
        ...(control.section || region.section ? { section: control.section || region.section } : {}),
        label: control.label || '', type: control.type, value,
        ...(control.inventoryNote ? { inventoryNote: control.inventoryNote } : {}),
        ...(control.role ? { role: control.role } : {}),
        ...(control.position !== undefined ? { position: control.position } : {}),
        ...(control.identity ? { sourceIdentity: control.identity } : {}) });
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
