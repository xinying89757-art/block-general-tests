import { normColor } from './block-style-model.mjs';
const NAMES = {
  'bss-button-text': '按钮文字样式', 'bss-button-bg': '按钮背景样式',
  'bss-nav-parent': '分类导航父级样式', 'bss-nav-leaf': '分类导航叶子样式',
  'bss-filter-title': '筛选组标题样式', 'bss-filter-option': '筛选值样式',
  'bss-product-name': '产品名样式', 'bss-product-name-clamp': '产品名行数限制',
  'bss-details-link': '产品卡 details 链接', 'bss-pagination-current': '分页当前页样式',
  'bss-pagination-other': '分页非当前页样式', 'bss-breakage-pc': 'PC 端样式错乱检查',
  'bss-breakage-pad': 'Pad 端样式错乱检查', 'bss-breakage-mobile': '移动端样式错乱检查',
};
const isNullColorPlaceholder = (item) => item?.autoLearned && item.props
  && Object.keys(item.props).some((property) => /color|fill|stroke/i.test(property))
  && Object.values(item.props).length && Object.values(item.props).every((value) => value === null || value === undefined);
const styleViewport = (checkId, spec) => {
  const label = /breakage-pad$/.test(checkId) ? 'pad'
    : /breakage-mobile$/.test(checkId) ? 'mobile' : 'pc';
  const width = spec?.viewports?.[label] ?? ({ pc: 1440, pad: 768, mobile: 375 }[label]);
  return { label, width: typeof width === 'number' ? width : null,
    height: label === 'pc' ? 900 : label === 'pad' ? 1024 : 667 };
};

const normalizedStyle = (key, value) => ['color', 'backgroundColor', 'borderColor'].includes(key) && value
  ? normColor(String(value)) : value ?? null;

function styleItemForCheck(checkId, items) {
  if (checkId === 'bss-product-name-clamp') return items.find((item) => item.id === 'product-name' && item.clamp);
  return items.find((item) => `bss-${item.id}` === checkId);
}

export function textContentOracle(item) {
  if (item?.kind !== 'text-content') return { status: 'not-applicable' };
  if (item.text === null || item.text === undefined || String(item.text) === '') {
    return { status: 'na', reason: item.valueResolutionReason || 'expected-text-unresolved' };
  }
  return { status: 'resolved', expected: String(item.text), source: item.resolvedExpectedSources?.text || 'profile' };
}

function diagnosticValues(check, item) {
  const evidence = check.evidence || {};
  if (check.status === 'na' && (evidence.notSetProperties || evidence.applicabilitySource)) {
    return { expected: { notSetThisRun: evidence.notSetProperties || [] }, actual: { compared: false } };
  }
  if (check.id.startsWith('bss-breakage-')) {
    return {
      expected: { instanceOverflow: false, stickingOut: 0, overlaps: 0, textClipped: 0, imgDistorted: 0 },
      actual: { horizontalOverflow: Boolean(evidence.horizontalOverflow),
        stickingOut: evidence.stickingOut?.length ?? null, overlaps: evidence.overlaps?.length ?? null,
        textClipped: evidence.textClipped?.length ?? null, imgDistorted: evidence.imgDistorted?.length ?? null,
        documentWidth: evidence.docScrollWidth ?? null, viewportWidth: evidence.viewportWidth ?? null,
        overflowScope: evidence.horizontalOverflowScope || 'unknown', blockOverflow: Boolean(evidence.blockOverflow),
        pageLevelFinding: evidence.pageLevelFinding || null,
        overflowAttribution: evidence.overflowAttribution || { pageLevel: Boolean(evidence.horizontalOverflow),
          instance: Boolean(evidence.blockOverflow), source: evidence.blockOverflow && evidence.horizontalOverflow
            ? 'page-and-instance' : evidence.blockOverflow ? 'instance-only'
              : evidence.horizontalOverflow ? 'page-level-outside-instance' : 'none' },
        blockRoot: evidence.blockRoot || null,
        offendingElementSelectors: (evidence.stickingOut || []).map((entry) => entry.selector).filter(Boolean),
        overlapElementSelectors: (evidence.overlaps || []).map((entry) => [entry.aSelector, entry.bSelector]
          .filter(Boolean).join(' ↔ ')).filter(Boolean),
        clippedElementSelectors: (evidence.textClipped || []).map((entry) => entry.selector).filter(Boolean) },
    };
  }
  if (item?.kind === 'presence') return {
    expected: { minimumMatches: 1 }, actual: { found: evidence.found ?? null, cards: evidence.cards ?? null,
      searchedSources: evidence.searchedSources || ['visible text', 'aria-label', 'title'] },
  };
  if (item?.kind === 'text-content') return {
    expected: { exactText: item.text }, actual: { matchedCount: evidence.matchedCount ?? null },
  };
  if (check.id === 'bss-product-name-clamp') return {
    expected: { lineClamp: item?.clamp ?? null },
    actual: (evidence.clamps || []).map(({ clamp, overflow, display }) => ({ clamp, overflow, display })),
  };
  const props = Object.keys(item?.props || {});
  const expected = Object.fromEntries(props.map((key) => [key, normalizedStyle(key, item.props[key])]));
  if (item?.geometry?.centered) expected.centered = true;
  const actual = (evidence.elements || []).map((element) => ({
    ...Object.fromEntries(props.map((key) => [key, normalizedStyle(key, element[key])])),
    ...(item?.geometry?.centered ? { centered: element.centered || null } : {}),
  }));
  return { expected, actual };
}

export function resolveFrontStyleCapability(capability, settingsReport = null) {
  const spec = capability?.styleSpec;
  if (!spec) return capability;
  const values = settingsReport?.block?.currentValues || settingsReport?.currentValues || [];
  const items = (spec.items || []).map((item) => ({ ...item, props: { ...(item.props || {}) }, resolvedExpectedSources: {} }));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const resolvedExpectedSources = {};
  const learnedByCheck = new Map();
  for (const event of settingsReport?.styleScopeLearning || []) {
    if (event.status !== 'learned') continue;
    for (const [checkId, properties] of Object.entries(event.expectedValues || {})) {
      learnedByCheck.set(checkId, { ...(learnedByCheck.get(checkId) || {}), ...properties });
    }
  }
  for (const item of items) {
    const learned = item.learnedSelectors || {};
    for (const [property, entries] of Object.entries(learned)) {
      const latest = (entries || []).at(-1);
      if (latest && Object.hasOwn(latest, 'expectedValue')) {
        learnedByCheck.set(`bss-${item.id}`, { ...(learnedByCheck.get(`bss-${item.id}`) || {}), [property]: latest.expectedValue });
      }
    }
  }
  for (const item of items) {
    const runCheckId = `bss-${item.id}`;
    const currentLearning = (settingsReport?.styleScopeLearning || []).some((event) => event.status === 'learned'
      && Object.hasOwn(event.expectedValues || {}, runCheckId));
    const learned = (item.learnedSelectorRequired && settingsReport && !currentLearning)
      ? [] : Object.values(item.learnedSelectors || {}).flat();
    if (learned.length) {
      const paths = [...new Set(learned.map((entry) => entry.selector).filter(Boolean))];
      item.selectorCandidates = paths;
      item.selector = paths.join(', ');
      item.learnedSelectorResolved = true;
      item.selectorLearningUnavailable = false;
    } else if (item.learnedSelectorRequired) {
      // A declared profile candidate remains an executable scope when no
      // editor effect was learned. Read its actual values before comparing.
      item.selector = item.selectorCandidates?.[0] || item.selector || null;
      item.learnedSelectorResolved = false;
      item.selectorLearningUnavailable = true;
    } else if (!item.selector && item.selectorCandidates?.length) item.selector = item.selectorCandidates[0];
    const runExpected = learnedByCheck.get(`bss-${item.id}`);
    if (runExpected) {
      for (const [property, value] of Object.entries(runExpected)) {
        item.props[property] = ['color', 'backgroundColor', 'borderColor'].includes(property)
          ? normColor(String(value)) : value;
        const sourceKey = `${item.id}.${property}`;
        item.resolvedExpectedSources[property] = 'run-written-editor-style-effect';
        resolvedExpectedSources[sourceKey] = 'run-written-editor-style-effect';
      }
    }
  }
  for (const item of items) {
    if (item.kind !== 'text-content' || !item.runValueSource) continue;
    const binding = item.runValueSource;
    const candidates = values.filter((entry) =>
      (binding.control?.region === undefined || entry.region === binding.control.region)
      && (binding.control?.label === undefined || entry.label === binding.control.label)
      && (binding.control?.type === undefined || entry.type === binding.control.type));
    const usable = candidates.length === 1 && candidates[0].value !== null
      && candidates[0].value !== undefined && String(candidates[0].value) !== '';
    const written = settingWasWritten(settingsReport, binding);
    if (usable && written) {
      item.text = String(candidates[0].value);
      item.resolvedExpectedSources.text = `run-report:block.currentValues[region=${binding.control?.region ?? '*'},label=${binding.control?.label ?? '*'}]`;
      item.valueResolutionReason = null;
    } else {
      const checkIds = binding.settingCheckIds || [];
      const checks = settingsReport?.checks || [];
      const lastWritten = [...checks].reverse().find((check) => checkIds.includes(check.id)
        && ['pass', 'fail'].includes(check.status) && check.value !== null && check.value !== undefined
        && String(check.value) !== '');
      const runMarker = autotestMarkerFromReport(settingsReport);
      if (lastWritten) {
        item.text = String(lastWritten.value);
        item.resolvedExpectedSources.text = `run-report:checks[${lastWritten.id}].value`;
        item.valueResolutionReason = null;
      } else if (runMarker) {
        item.text = runMarker.value;
        item.resolvedExpectedSources.text = runMarker.source;
        item.valueResolutionReason = null;
      } else {
        item.text = null;
        item.valueResolutionReason = !settingsReport ? 'run-report-not-provided'
          : candidates.length !== 1 ? 'run-control-value-not-unique' : 'setting-value-not-written-this-run';
        item.resolvedExpectedSources.text = item.valueResolutionReason;
        resolvedExpectedSources[`${item.id}.text`] = item.valueResolutionReason;
      }
    }
  }
  for (const [key, binding] of Object.entries(spec.expectedValueSources || {})) {
    const [itemId, property] = key.split('.', 2);
    const item = itemById.get(itemId);
    if (!item || !property) continue;
    const learnedRunValue = learnedByCheck.get(`bss-${itemId}`)?.[property];
    if (learnedRunValue !== undefined) continue;
    const candidates = binding.control ? values.filter((entry) =>
      (binding.control.region === undefined || entry.region === binding.control.region)
      && (binding.control.label === undefined || entry.label === binding.control.label)
      && (binding.control.type === undefined || entry.type === binding.control.type)) : [];
    const match = candidates.length === 1 ? candidates[0] : null;
    const usable = match && match.value !== null && match.value !== undefined && match.value !== '';
    const written = settingWasWritten(settingsReport, binding);
    const value = usable && written ? match.value : settingsReport ? undefined : binding.profileDefault;
    if (value === undefined) {
      item.resolvedExpectedSources[property] = 'not set this run';
      delete item.props[property];
      resolvedExpectedSources[key] = 'not set this run';
      continue;
    }
    item.props[property] = ['color', 'backgroundColor', 'borderColor'].includes(property)
      ? normColor(String(value)) : value;
    const source = usable && written
      ? `run-report:block.currentValues[region=${binding.control.region ?? '*'},label=${binding.control.label ?? '*'}]`
      : `profile-default:${key}`;
    item.resolvedExpectedSources[property] = source;
    resolvedExpectedSources[key] = source;
  }
  return { ...capability, styleSpec: { ...spec, items, resolvedExpectedSources } };
}

function autotestMarkerFromReport(report) {
  if (!report || typeof report !== 'object') return null;
  const explicit = [report.autotestMarker, report.marker, report.fixtureMarker,
    report.fixture?.marker, report.block?.autotestMarker, report.block?.marker]
    .filter((value) => typeof value === 'string' && /^AUTOTEST-/i.test(value.trim()));
  const currentValues = [...(report.block?.currentValues || []), ...(report.currentValues || [])]
    .filter((entry) => entry?.marker === true || entry?.fixtureMarker === true)
    .map((entry) => entry.value).filter((value) => typeof value === 'string' && /^AUTOTEST-/i.test(value.trim()));
  const values = [...new Set([...explicit, ...currentValues].map((value) => value.trim()))];
  return values.length === 1 ? { value: values[0], source: 'run-report:autotest-marker' } : null;
}

function settingWasWritten(report, binding) {
  if (!report) return true;
  const required = binding?.settingCheckIds || [];
  if (!required.length) return false;
  const checks = new Map((report.checks || []).map((check) => [check.id, check]));
  return required.every((id) => ['pass', 'fail'].includes(checks.get(id)?.status));
}

function valueAtPath(object, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => value?.[key], object);
}

export function resolveItemApplicability(item, report) {
  const rule = item.applicability;
  if (!rule) return item.requireApplicableToggle
    ? { applicable: false, reason: 'profile did not declare an applicability toggle; not set this run' }
    : { applicable: true };
  if (!report) return { applicable: false, reason: '未提供运行报告，无法读取画像声明的适用性开关。', source: rule.checkId };
  const check = (report.checks || []).find((entry) => entry.id === rule.checkId);
  if (!check || !['pass', 'fail', 'record'].includes(check.status)) {
    return { applicable: false, reason: 'not set this run', source: rule.checkId };
  }
  const actual = valueAtPath(check, rule.valuePath || 'actual');
  return actual === rule.equals
    ? { applicable: true, source: rule.checkId }
    : { applicable: false, reason: '画像开关值表明此项不适用。', source: rule.checkId };
}

/** Add structured, value-safe diagnostics without changing a check verdict. */
export function addStyleFailureReasons(checks, { capability, blockId, rootSelector, viewports } = {}) {
  const spec = capability?.styleSpec || {};
  const items = spec.items || [];
  return checks.map((check) => {
    if (check.status === 'pass') return check;
    // Checklist checkers already supplied property-specific observations.
    // Replacing them with an empty styleSpec diagnostic loses that evidence.
    if (check.id.startsWith('design-') && check.reason?.checkType) return { ...check,
      reason: { ...check.reason, ...(check.screenshot ? { screenshot: check.screenshot } : {}) } };
    const item = styleItemForCheck(check.id, items);
    const isBreakage = check.id.startsWith('bss-breakage-');
    const locator = isBreakage ? 'block subtree layout invariants'
      : rootSelector ? 'unique block instance root / profile selector candidates' : 'unique block instance root';
    const evidence = check.evidence || {};
    const matchedElementCount = Number.isInteger(evidence.matchedCount) ? evidence.matchedCount
      : Number.isInteger(evidence.found) ? evidence.found
        : Number.isInteger(evidence.rootMatchedCount) ? evidence.rootMatchedCount
          : Array.isArray(evidence.elements) ? evidence.elements.length
            : Array.isArray(evidence.clamps) ? evidence.clamps.length : null;
    const stage = check.errorDiagnostic?.stage || (check.status === 'fail' ? 'compare'
      : matchedElementCount === 0 ? 'locate' : 'read');
    const { expected, actual } = diagnosticValues(check, item);
    const configuredViewport = styleViewport(check.id, { ...spec, ...(viewports ? { viewports } : {}) });
    if (Number.isInteger(evidence.viewportWidth)) configuredViewport.width = evidence.viewportWidth;
    const suppliedCode = machineReasonCode(check.reason?.code) !== 'reason-code-unavailable'
      ? machineReasonCode(check.reason.code) : machineReasonCode(evidence.machineReason);
    const reasonCode = suppliedCode !== 'reason-code-unavailable' ? suppliedCode
      : check.errorDiagnostic ? `front-${String(check.errorDiagnostic.stage || 'read')}-error`
        : matchedElementCount === 0 || (Array.isArray(actual) && actual.length === 0) ? 'no-matched-elements'
          : check.status === 'fail' ? 'style-assertion-mismatch' : `style-${stage}-not-applicable`;
    return { ...check, name: check.name || item?.name || NAMES[check.id] || check.id, reason: {
      stage, locator, matchedElementCount,
      property: isBreakage ? ['horizontalOverflow', 'stickingOut', 'overlaps', 'textClipped', 'imgDistorted']
        : item?.kind === 'presence' ? ['presence'] : item?.clamp ? ['lineClamp']
          : [...Object.keys(item?.props || {}), ...(item?.geometry?.centered ? ['centered'] : [])],
      expected, actual, viewport: configuredViewport,
      ...(item?.resolvedExpectedSources && Object.keys(item.resolvedExpectedSources).length
        ? { expectedSource: item.resolvedExpectedSources } : {}),
      ...(check.screenshot ? { screenshot: check.screenshot } : {}),
      ...(check.errorDiagnostic ? { error: {
        class: String(check.errorDiagnostic.class || 'Error'),
        message: String(check.errorDiagnostic.message || '').slice(0, 240),
      } } : {}),
      ...(check.status === 'na' || check.status === 'skip' || check.status === 'deferred'
        ? { applicability: String(check.detail || check.status).slice(0, 240) } : {}),
      code: reasonCode,
      ...(evidence.candidateSource ? { candidateSource: String(evidence.candidateSource) } : {}),
    } };
  });
}

function machineReasonCode(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.code === 'string' && value.code.trim()) return value.code.trim();
    if (typeof value.reason === 'string' && value.reason.trim()) return value.reason.trim();
  }
  return 'reason-code-unavailable';
}

export function styleCheckDescriptors(capability) {
  const items = (capability?.styleSpec?.items || []).filter((item) => !isNullColorPlaceholder(item));
  const recordOnly = capability?.styleSpec?.recordOnly || [];
  if (!items.length && !recordOnly.length) return Object.keys(NAMES).map((id) => ({ id, name: NAMES[id], itemId: null }));
  const descriptors = items.map((item) => ({ id: `bss-${item.id}`, name: item.name || NAMES[`bss-${item.id}`] || item.id,
    itemId: item.id }));
  descriptors.push(...recordOnly.map((item) => ({ id: `bss-${item.id}`, name: item.name || item.id, itemId: item.id })));
  if (items.some((item) => item.id === 'product-name' && item.clamp)) {
    descriptors.push({ id: 'bss-product-name-clamp', name: NAMES['bss-product-name-clamp'], itemId: 'product-name' });
  }
  for (const vp of ['pc', 'pad', 'mobile']) descriptors.push({
    id: `bss-breakage-${vp}`, name: NAMES[`bss-breakage-${vp}`], itemId: null,
  });
  return descriptors;
}

