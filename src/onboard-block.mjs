import { signatures, matchCapabilities } from './capabilities/signatures.mjs';
import { inferStyleValueKind } from './style-effect-learning.mjs';

const matchesRule = (pattern, value) => pattern == null
  || (pattern instanceof RegExp ? pattern.test(String(value ?? '')) : pattern === value);

const serializableControl = (control) => ({
  index: control.index ?? null,
  type: control.type || '',
  label: control.label || '',
  context: control.context || '',
  ...(control.name ? { name: control.name } : {}),
  ...(control.value !== undefined ? { value: control.value } : {}),
  ...(control.checked !== undefined ? { checked: Boolean(control.checked) } : {}),
  ...(control.disabled !== undefined ? { disabled: Boolean(control.disabled) } : {}),
});

/** Map only uniquely detected signatures; never infer an oracle from a label. */
export function mapDiscoveredInventory(inventory, { rules = signatures } = {}) {
  const detected = matchCapabilities(inventory, rules);
  const byId = new Map();
  for (const match of detected.matched) byId.set(match.id, [...(byId.get(match.id) || []), match]);
  const ambiguous = [...byId].filter(([, matches]) => matches.length !== 1).map(([id, matches]) => ({
    id, count: matches.length, locations: matches.map(({ kind, type, title, wrapIndex }) => ({ kind, type, title, wrapIndex })),
  }));
  if (ambiguous.length) {
    const error = new Error(`Ambiguous setting controls detected; refusing to generate a profile: ${ambiguous.map((item) => `${item.id} (${item.count})`).join(', ')}`);
    error.ambiguous = ambiguous;
    throw error;
  }
  const requirements = [...byId].map(([id, [match]]) => ({ id,
    params: { ...(match.title ? { dialogTitle: match.title } : {}),
      ...(Number.isInteger(match.wrapIndex) ? { wrapIndex: match.wrapIndex } : {}) },
  }));
  const capabilityMap = new Map();
  for (const match of detected.matched) capabilityMap.set(match.parentModule, { id: match.parentModule, status: 'candidate' });
  const inventoryErrors = (inventory || []).filter((region) => region.inventoryError).map((region) => {
    const owners = [...new Set(rules.filter((rule) => matchesRule(rule.region?.type, region.type)
      && matchesRule(rule.region?.title, region.title) && matchesRule(rule.region?.wrapIndex, region.wrapIndex))
      .map((rule) => rule.parentModule))];
    for (const id of owners) if (!capabilityMap.has(id)) capabilityMap.set(id, { id, status: 'candidate' });
    return { regionType: region.inventoryError.regionType || region.type,
      capabilityCandidates: owners, code: region.inventoryError.code || 'SETTINGS_INVENTORY_ERROR',
      message: region.inventoryError.message || '', diagnostics: region.inventoryError.diagnostics || null,
      screenshot: region.inventoryError.screenshot || null };
  });
  const unmapped = detected.unrecognized.flatMap((region) => (region.controls || []).map((control) => ({
    kind: region.kind || 'settings-dialog', regionType: region.type || '', title: region.title ?? null,
    wrapIndex: region.wrapIndex ?? null, control: serializableControl(control), status: 'unmapped',
  })));
  return { requirements, capabilities: [...capabilityMap.values()], unmapped, inventoryErrors,
    matched: detected.matched.map(({ id, parentModule, kind, type, title, wrapIndex, evidence }) => ({
      id, capability: parentModule, kind, type, title: title ?? null, wrapIndex: wrapIndex ?? null, evidence,
    })) };
}

export function buildDraftProfile(template, { blockId, page, mapping, observedAt = new Date().toISOString() }) {
  if (!template || typeof template !== 'object' || !Array.isArray(mapping?.requirements)
    || !Array.isArray(mapping?.capabilities) || !Array.isArray(mapping?.unmapped)) {
    throw new Error('Onboarding requires a profile template and a complete inventory mapping.');
  }
  if (!/^\w[\w-]*$/.test(String(blockId || ''))) throw new Error('A valid block number is required.');
  if (!page || !['system', 'custom'].includes(page.kind)) throw new Error('An explicit system or custom page is required.');
  const profile = structuredClone(template);
  delete profile.fixture;
  delete profile.baselineNote;
  profile.blockId = String(blockId);
  profile.name = '待人工审核：自动盘点草稿';
  profile.category = '待人工审核';
  profile.dataMode = 'static';
  profile.dataSource = { entities: [], scope: '待人工审核', system: 'content-management' };
  profile.figma = { fileKey: '', framesObserved: [], url: '' };
  profile.capabilities = structuredClone(mapping.capabilities);
  profile.target = { createdByTest: false, language: 'en', page: page.name || page.id || page.url,
    pageKind: page.kind, ...(page.id ? { pageId: String(page.id) } : {}), ...(page.url ? { pageUrl: page.url } : {}),
    ...(page.name ? { pageName: page.name } : {}), pageKindNote: '由 onboarding 命令显式指定；草稿需人工审核。' };
  profile.requirements = { capabilities: structuredClone(mapping.requirements), displayFieldTypes: [] };
  const pendingStyleEffects = mapping.matched.flatMap((match) => (match.evidence || []).flatMap((evidence, index) => {
    const kind = inferStyleValueKind({ type: evidence.type, value: evidence.value });
    if (!kind) return [];
    const properties = kind === 'font-size' ? ['fontSize'] : ['color', 'backgroundColor', 'borderColor', 'outlineColor',
      'textDecorationColor', 'accentColor', 'caretColor', 'columnRuleColor', 'fill', 'stroke'];
    return properties.map((property) => ({ requirementId: match.id, evidenceIndex: index,
      regionType: match.type || null, wrapIndex: Number.isInteger(match.wrapIndex) ? match.wrapIndex : null,
      controlIndex: Number.isInteger(evidence.controlIndex) ? evidence.controlIndex : null,
      controlName: evidence.controlName || null, kind, property,
      status: 'pending', reason: 'awaiting-setting-unit-and-editor-effect-snapshot' }));
  }));
  if (pendingStyleEffects.length && !profile.capabilities.some((item) => item.id === 'block-style-spec')) {
    profile.capabilities.push({ id: 'block-style-spec', status: 'candidate', styleSpec: {
      items: [], recordOnly: [], viewports: { pc: 1440, pad: 768, mobile: 375 },
    } });
  }
  profile.testData = { requirements: [], status: 'unreviewed-no-fixture-oracle' };
  profile.specificChecks = [];
  profile.onboarding = { status: 'draft-unreviewed', discoveredAt: observedAt,
    matched: structuredClone(mapping.matched), unmapped: structuredClone(mapping.unmapped),
    pendingStyleEffects,
    ...(mapping.inventoryErrors?.length ? { inventoryErrors: structuredClone(mapping.inventoryErrors) } : {}),
    note: '自动映射仅复用唯一命中的通用签名；未推断预期值、夹具或断言。' };
  return profile;
}

export function summarizeDraftMapping(mapping) {
  return { autoMappedCount: mapping.matched.length, unmappedCount: mapping.unmapped.length,
    mappedSettingIds: mapping.matched.map((item) => item.id), unmappedControls: mapping.unmapped };
}

export function assertOnboardingOverwriteAllowed(existingProfile, overwriteReviewed = false) {
  if (!existingProfile) return true;
  if (existingProfile.onboarding?.status === 'draft-unreviewed') return true;
  if (overwriteReviewed) return true;
  throw new Error('An existing reviewed profile requires explicit overwrite approval.');
}

export function classifyOnboardingEnvironmentOutcome(error) {
  const message = String(error?.message || error || '');
  if (/模块列表中未找到|未找到.{0,40}模块|module librar.{0,40}not found|not found in (?:the )?module librar/i.test(message)) {
    return { status: 'environment-unavailable', code: 'TARGET_BLOCK_NOT_IN_MODULE_LIBRARY',
      message: '目标区块未出现在可搜索的模块库列表中；未运行设置批次。' };
  }
  if (error?.environment === true) return { status: 'environment-error', code: error.code || 'EDITOR_ENVIRONMENT_ERROR', message };
  return null;
}

export function buildOnboardingEnvironmentReport({ runId, blockId, siteHost, page, links, outcome, error, lastProgress }) {
  if (!outcome || !['environment-error', 'environment-unavailable'].includes(outcome.status)) {
    throw new Error('A classified onboarding environment outcome is required.');
  }
  return { schemaVersion: 1, flow: 'fresh-block-onboarding', runId, status: outcome.status,
    environmentOutcome: outcome.code, siteHost, blockId: String(blockId), page,
    links: { editor: links?.editor || null, front: links?.front || null },
    stage: outcome.code === 'TARGET_BLOCK_NOT_IN_MODULE_LIBRARY' ? 'module-library-preflight' : (lastProgress?.stage || 'start'),
    lifecycle: { deletedSettingIds: lastProgress?.deletedSettingIds || [], addedSettingId: null },
    inventory: { status: outcome.code === 'TARGET_BLOCK_NOT_IN_MODULE_LIBRARY' ? 'target-only-search-complete' : 'not-reached',
      autoMappedCount: null, unmappedCount: null },
    moduleLibraryOpenerMatchCount: Number.isInteger(error?.openerMatchCount) ? error.openerMatchCount : null,
    libraryLookup: Array.isArray(error?.libraryLookup) ? error.libraryLookup : [],
    checks: [], failures: [], publishedAt: null,
    error: { code: outcome.code, message: outcome.message, originalMessage: String(error?.message || error || '') },
  };
}
