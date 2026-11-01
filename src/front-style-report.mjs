import { addStyleFailureReasons, styleCheckDescriptors } from './capabilities/block-style-spec.mjs';
import { dedupeChecksById } from './front-check-utils.mjs';

export function sanitizeFrontStyleUrl(input) {
  try {
    const url = new URL(input);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (key !== 't') url.searchParams.delete(key);
    return url.href;
  } catch { return '[invalid-url]'; }
}

export function sanitizeFrontStyleError(error) {
  const message = String(error?.message || error || 'Unknown error')
    .replace(/https?:\/\/[^\s)'"<>]+/gi, '[URL]')
    .replace(/\b(cookie|authorization|password|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 240);
  return { class: String(error?.class || error?.name || error?.constructor?.name || 'Error'), message };
}

export function resolveFrontStyleInstance(instances, requestedSettingId = null) {
  const rows = Array.isArray(instances) ? instances : [];
  const normalized = (value) => String(value || '').replace(/^siteblocks-setting-wrap-/, '');
  let candidates = requestedSettingId
    ? rows.map((row, index) => ({ row, index })).filter(({ row }) =>
      (row.identities || []).some((identity) => normalized(identity) === String(requestedSettingId)))
    : [];
  let resolution = requestedSettingId ? 'settingId' : 'single-instance';
  if (!candidates.length && rows.length === 1) {
    candidates = [{ row: rows[0], index: 0 }];
    resolution = requestedSettingId ? 'settingId-report + unique block instance' : 'single-instance';
  }
  if (candidates.length !== 1) return { instanceCount: rows.length, matchCount: candidates.length, index: null, settingId: null, resolution: null };
  const { row, index } = candidates[0];
  const detected = (row.identities || []).map((identity) => String(identity || '').match(/^siteblocks-setting-wrap-(.+)$/)?.[1])
    .find((value) => /^[\w-]{5,}$/.test(value || '')) || null;
  return { instanceCount: rows.length, matchCount: 1, index,
    settingId: requestedSettingId || detected, resolution };
}

export function attachFrontStyleInstance(checks, settingId) {
  return (checks || []).map((check) => ({ ...check, settingId: settingId || null }));
}

/** Final report boundary: dedupe the complete mixed check list, then recount its summary. */
export function finalizeFrontStyleReport(report) {
  const inputChecks = report?.checks || [];
  const checks = dedupeChecksById(inputChecks).map((check) => {
    if (!['na', 'fail'].includes(check.status)) return check;
    const reason = check.reason && typeof check.reason === 'object' && !Array.isArray(check.reason)
      ? { ...check.reason } : {};
    if (typeof reason.code !== 'string' || !reason.code.trim()) {
      const original = reason.code;
      reason.machineReason = original === undefined ? 'No machine reason was supplied.'
        : original && typeof original === 'object' && typeof original.code === 'string' ? original.code
          : typeof original === 'string' ? original : 'Non-string machine reason was normalized.';
      const actual = check.actual ?? reason.actual;
      const emptyActual = Array.isArray(actual) && actual.length === 0;
      reason.code = emptyActual ? 'no-matched-elements'
        : reason.stage === 'locate' ? 'instance-locator-unresolved'
          : reason.stage === 'compare' || check.status === 'fail' ? 'assertion-mismatch'
            : `front-${String(reason.stage || check.status || 'read')}-result`;
    }
    return { ...check, reason };
  });
  const count = (status) => checks.filter((check) => check.status === status).length;
  const failed = new Map(checks.filter((check) => check.status === 'fail').map((check) => [String(check.id), check]));
  const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  const viewportFor = (check) => check.reason?.viewport?.label || check.viewport?.label || (typeof check.viewport === 'string' ? check.viewport : null)
    || (/(?:^|-)mobile$/.test(check.id) ? 'mobile' : /(?:^|-)pc$/.test(check.id) ? 'pc' : null);
  const groups = new Map();
  for (const check of inputChecks.filter((item) => item?.status === 'fail' && failed.has(String(item.id)))) {
    if (!check.id.startsWith('design-') || !check.sourceText || !viewportFor(check)) continue;
    const comparison = check.reason?.mismatches?.length ? check.reason.mismatches.map(({ property, expected }) => ({ property, expected }))
      .sort((a, b) => a.property.localeCompare(b.property)) : { expected: check.expected,
        properties: check.reason?.mismatchedProperties || check.reason?.propertiesChecked || check.reason?.property || [] };
    const key = JSON.stringify(stable({ sourceText: check.sourceText, checkType: check.reason?.checkType,
      dependsOn: [...(check.dependsOn || [])].sort(), comparison }));
    groups.set(key, [...(groups.get(key) || []), check]);
  }
  const canonical = new Map([...failed.keys()].map((id) => [id, id]));
  const viewportGroups = [];
  for (const rows of groups.values()) {
    const viewports = [...new Set(rows.map(viewportFor))];
    if (viewports.length < 2) continue;
    const leader = rows.map((check) => check.id).sort()[0];
    rows.forEach((check) => canonical.set(check.id, leader));
    viewportGroups.push({ rootFailureId: leader, checkIds: [...new Set(rows.map((check) => check.id))], viewports });
  }
  const rootsFor = (id, path = []) => {
    id = canonical.get(id) || id;
    if (path.includes(id)) return [[...path.slice(path.indexOf(id))].sort()[0]];
    const dependencies = (failed.get(id)?.dependsOn || []).map(String).filter((dependency) => failed.has(dependency) && dependency !== id);
    return dependencies.length ? [...new Set(dependencies.flatMap((dependency) => rootsFor(dependency, [...path, id])))] : [id];
  };
  const failures = [...failed.keys()].map((id) => ({ checkId: id,
    dependsOn: failed.get(id).dependsOn || [], rootFailureIds: rootsFor(id) }));
  const rootIds = [...new Set(failures.flatMap((item) => item.rootFailureIds))];
  const rootFailures = rootIds.map((id) => {
    const rows = failures.filter((item) => item.rootFailureIds.includes(id)).map((item) => failed.get(item.checkId));
    const ids = new Set(rows.map((check) => check.id));
    const observations = inputChecks.filter((check) => check?.status === 'fail' && ids.has(check.id));
    return { checkId: id, checkIds: [...ids], viewports: [...new Set(observations.map(viewportFor).filter(Boolean))] };
  });
  const byId = new Map(failures.map((item) => [item.checkId, item.rootFailureIds]));
  return { ...report, checks: checks.map((check) => check.status === 'fail'
    ? { ...check, rootFailureIds: byId.get(String(check.id)) } : check),
    failureDeduplication: { rule: 'Each failed check id is one raw failure; failed dependsOn chains and the same spec/property/expectation across viewports count once per root. All rows remain in checks.',
      rawFailCount: failed.size, rawFailureObservationCount: inputChecks.filter((check) => check?.status === 'fail').length,
      dedupedFailCount: rootIds.length, rootFailureIds: rootIds, rootFailures, viewportGroups, failures },
    summary: { pass: count('pass'), fail: rootIds.length, rawFail: failed.size, dedupedFail: rootIds.length, na: count('na') + count('skip'),
      other: checks.filter((check) => !['pass', 'fail', 'na', 'skip'].includes(check.status)).length } };
}

export function preservePartialFrontStyleReport(report, { stage, error } = {}) {
  const safe = sanitizeFrontStyleError(error || new Error('Run interrupted.'));
  return { ...report, partial: true, error: safe.message,
    executionError: { stage: String(stage || 'unknown'), class: safe.class, message: safe.message },
    checks: [...(report?.checks || [])] };
}

export function buildFrontStyleExecutionErrors({ capability, blockId, stage, error, viewport }) {
  const safe = sanitizeFrontStyleError(error);
  const reasonStage = ['navigate', 'locate-block', 'launch-browser'].includes(stage) ? 'locate' : 'read';
  const checks = styleCheckDescriptors(capability).map(({ id, name }) => ({
    id, name, status: 'error', detail: `前台样式检查在 ${stage} 阶段异常中止。`,
    errorDiagnostic: { stage: reasonStage, class: safe.class, message: safe.message },
    evidence: { matchedCount: null },
  }));
  return addStyleFailureReasons(checks, { capability, blockId, viewports: viewport || capability?.styleSpec?.viewports });
}
