import { createSettingUnit } from './setting-units.mjs';
import { inferStyleValueKind, ensureStyleEffectProfileEntries } from './style-effect-learning.mjs';
import { normalizeColor } from './capabilities/rail.mjs';

const SAFE_TOKEN = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'control';
const COLOR_PROPERTIES = new Set(['color', 'backgroundColor', 'borderColor', 'outlineColor', 'textDecorationColor',
  'accentColor', 'caretColor', 'columnRuleColor', 'fill', 'stroke']);

function valueForControl(control) {
  if (control.type === 'checkbox' || control.type === 'radio') return control.checked;
  return control.value;
}

export function styleControlKind(control = {}) {
  const kind = inferStyleValueKind({ value: valueForControl(control), valueKind: control.valueKind,
    kind: control.kind, type: control.type, role: control.role,
    styleProperty: control.styleProperty, cssProperty: control.cssProperty });
  // The editor exposes no font-size setting. Font sizes are design-spec
  // assertions or record-only observations; arbitrary CSS dimensions (width,
  // padding, etc.) must never become inferred setting units.
  if (kind !== 'color') return null;
  if (control.styleProperty && !COLOR_PROPERTIES.has(control.styleProperty)) return null;
  if (control.cssProperty && !COLOR_PROPERTIES.has(control.cssProperty)) return null;
  return 'color';
}

export function isColorSchemeInventoryRegion(region = {}, control = {}) {
  return region.type === 'rail:color-scheme'
    || [control.section, control.group, region.section, region.group, region.title].some((value) =>
      String(value || '').replace(/\s+/g, '').includes('区块配色'));
}

export function alternateStyleControlValue(kind, initialValue) {
  const text = String(initialValue ?? '').trim();
  if (kind === 'color') {
    const normalized = normalizeColor(text);
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) throw new Error('Generic color unit requires a readable six-digit color value.');
    const alternate = normalized.slice(1).match(/../g)
      .map((channel) => (255 - Number.parseInt(channel, 16)).toString(16).padStart(2, '0')).join('');
    return `#${alternate}`;
  }
  if (kind === 'font-size') {
    const match = text.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|em|ex|ch|lh|rlh|vw|vh|vmin|vmax|%|pt|pc|cm|mm|in)?$/i);
    if (!match) throw new Error('Generic font-size unit requires a numeric CSS length.');
    const number = Number(match[1]);
    if (!Number.isFinite(number)) throw new Error('Generic font-size unit has an invalid numeric value.');
    const next = Number((number + 1).toFixed(4));
    return `${next}${match[2] || ''}`;
  }
  throw new Error(`Unsupported style control kind: ${kind}`);
}

function distinctAlternateValue(kind, initialValue, usedValues) {
  let value = alternateStyleControlValue(kind, initialValue);
  if (kind !== 'color') return value;
  const normalize = (candidate) => normalizeColor(candidate).toLowerCase();
  let rgb = Number.parseInt(normalize(value).slice(1), 16);
  const initial = normalize(initialValue);
  while (usedValues.has(normalize(value)) || normalize(value) === initial) {
    rgb = (rgb + 1) & 0xffffff;
    value = `#${rgb.toString(16).padStart(6, '0')}`;
  }
  usedValues.add(normalize(value));
  return value;
}

function referenceFor(region, control, index, kind) {
  const controlIndex = Number.isInteger(control.index) ? control.index : index;
  const value = valueForControl(control);
  const type = control.type || (kind === 'color' ? 'color' : 'text');
  const regionName = region.regionKey || (region.type === 'rail:color-scheme' ? 'right-rail-color' : region.title || region.type);
  const token = `${SAFE_TOKEN(region.type)}-${region.wrapIndex ?? 0}-${controlIndex}-${kind}`;
  const requirementId = `discovered-style-${token}`;
  return {
    kind, initialValue: value, controlIndex, type, regionName, token,
    requirementId, id: `auto-style-${token}`,
    reference: { region: regionName, regionType: region.type, regionTitle: region.title || null,
      wrapIndex: Number.isInteger(region.wrapIndex) ? region.wrapIndex : 0,
      controlIndex, type, tag: control.tag || null, name: control.name || '', label: control.label || '',
      role: control.role || null, identity: control.identity || null,
      section: control.section || region.section || region.group || null,
      position: Number.isInteger(control.position) ? control.position : null,
      styleProperty: control.styleProperty || (kind === 'font-size' ? 'fontSize' : null) },
  };
}

function alreadyCovered(candidate, persistedControls = []) {
  return persistedControls.some((item) => item.region === candidate.regionName
    && item.controlIndex === candidate.controlIndex
    && (item.type === candidate.type || item.type === 'text' && candidate.kind === 'color'));
}

function addProfileRequirement(profile, candidate) {
  if (!profile) return;
  profile.requirements ||= { capabilities: [] };
  profile.requirements.capabilities ||= [];
  if (profile.requirements.capabilities.some((item) => item.id === candidate.requirementId)) return;
  profile.requirements.capabilities.push({ id: candidate.requirementId, capability: 'discovered-style-controls',
    mode: 'editor-setting', valueKind: candidate.kind, styleProperty: candidate.reference.styleProperty,
    lifecycleSurface: candidate.reference.regionType?.startsWith('rail:') ? 'right-rail-flyout' : 'settings-dialog',
    editorControl: { regionType: candidate.reference.regionType, regionTitle: candidate.reference.regionTitle,
      wrapIndex: candidate.reference.wrapIndex, index: candidate.reference.controlIndex,
      tag: candidate.reference.tag, type: candidate.reference.type, name: candidate.reference.name,
      label: candidate.reference.label, role: candidate.reference.role, identity: candidate.reference.identity,
      section: candidate.reference.section, position: candidate.reference.position } });
}

export function discoverStyleControlCandidates(inventory = [], persistedControls = []) {
  const candidates = [];
  for (const region of inventory || []) {
    for (const [index, control] of (region.controls || []).entries()) {
      if (control.disabled || control.readOnly || control.inventoryNote) continue;
      const kind = styleControlKind(control);
      if (!kind) continue;
      if (kind === 'color' && !isColorSchemeInventoryRegion(region, control)) continue;
      const candidate = referenceFor(region, control, index, kind);
      if (!alreadyCovered(candidate, persistedControls)) candidates.push(candidate);
    }
  }
  const keys = new Set();
  for (const item of candidates) {
    const key = `${item.id}:${item.reference.identity || item.reference.name || item.reference.label}`;
    if (keys.has(key)) throw new Error(`Discovered style control identity is ambiguous for ${item.id}.`);
    keys.add(key);
  }
  return candidates;
}

function normalizedEqual(kind, actual, expected) {
  if (kind === 'color') return normalizeColor(actual) === normalizeColor(expected);
  const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i, (_, number, unit) => `${Number(number)}${unit}`);
  return norm(actual) === norm(expected);
}

export async function createDiscoveredStyleSettingUnits({ inventory = [], persistedControls = [], profile,
  styleControlAdapter } = {}) {
  if (!styleControlAdapter || typeof styleControlAdapter.createLifecycle !== 'function') return { settings: [], persistedControls: [], requirementsAdded: false };
  const candidates = discoverStyleControlCandidates(inventory, persistedControls);
  const lifecycleByRegion = new Map();
  const settings = [];
  const controls = [];
  const writtenColorValues = new Set();
  let requirementsAdded = false;
  for (const candidate of candidates) {
    if (candidate.initialValue === null || candidate.initialValue === undefined || candidate.initialValue === '') continue;
    const alternateValue = distinctAlternateValue(candidate.kind, candidate.initialValue, writtenColorValues);
    const lifecycleKey = `${candidate.reference.regionType}:${candidate.reference.regionTitle}:${candidate.reference.wrapIndex}`;
    let lifecycle = lifecycleByRegion.get(lifecycleKey);
    if (!lifecycle) {
      lifecycle = await styleControlAdapter.createLifecycle(candidate.reference);
      lifecycleByRegion.set(lifecycleKey, lifecycle);
    }
    const hadRequirement = Boolean(profile?.requirements?.capabilities?.some((item) => item.id === candidate.requirementId));
    addProfileRequirement(profile, candidate);
    requirementsAdded ||= !hadRequirement;
    const requirement = profile?.requirements?.capabilities?.find((item) => item.id === candidate.requirementId)
      || { id: candidate.requirementId, editorControl: candidate.reference };
    const check = async () => {
      await lifecycle.open();
      try {
        const actual = await lifecycle.read(candidate.reference);
        const pass = normalizedEqual(candidate.kind, actual, alternateValue);
        return { status: pass ? 'pass' : 'fail', expected: alternateValue, actual,
          detail: 'Style control persistence should retain the value written by this setting unit.' };
      } finally { await lifecycle.cancel(); }
    };
    const unit = createSettingUnit({ id: candidate.id, capability: 'discovered-style-controls',
      requirementId: candidate.requirementId, locate: { source: 'requirement-profile', id: candidate.requirementId, requirement },
      lifecycleSurface: lifecycle.kind, dependencies: [],
      persistedControls: [{ region: candidate.regionName, controlIndex: candidate.controlIndex, type: candidate.type }],
      alternateValue, initialValue: candidate.initialValue, valueKind: candidate.kind,
      ...(candidate.kind === 'font-size' ? { styleProperty: 'fontSize' } : { styleProperty: 'color' }),
      lifecycle,
      apply: async () => lifecycle.apply(candidate.reference, alternateValue),
      editorCheck: check, check,
      restore: async () => lifecycle.apply(candidate.reference, candidate.initialValue),
      frontRequires: [],
    });
    ensureStyleEffectProfileEntries(profile, unit, unit.styleEffect);
    for (const pending of profile?.onboarding?.pendingStyleEffects || []) {
      if (pending.status !== 'pending' || pending.kind !== candidate.kind
        || pending.regionType !== candidate.reference.regionType
        || pending.wrapIndex !== candidate.reference.wrapIndex
        || pending.controlIndex !== candidate.controlIndex
        || (pending.controlName && pending.controlName !== candidate.reference.name)) continue;
      pending.settingUnitId = unit.id;
      pending.checkIds = unit.styleEffect.checks.map((checkItem) => checkItem.checkId);
    }
    settings.push(unit);
    controls.push(...unit.persistedControls.map((item) => ({ ...item, capability: unit.capability, settingId: unit.id })));
  }
  return { settings, persistedControls: controls, requirementsAdded };
}
