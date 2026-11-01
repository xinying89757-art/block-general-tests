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
  const checks = dedupeChecksById(report?.checks || []).map((check) => {
    if (check.status !== 'na') return check;
    const reason = check.reason && typeof check.reason === 'object' && !Array.isArray(check.reason)
      ? { ...check.reason } : {};
    if (typeof reason.code !== 'string' || !reason.code.trim()) {
      reason.machineReason = reason.code === undefined ? 'No machine reason was supplied.' : reason.code;
      reason.code = 'na-reason-unavailable';
    }
    return { ...check, reason };
  });
  const count = (status) => checks.filter((check) => check.status === status).length;
  return { ...report, checks,
    summary: { pass: count('pass'), fail: count('fail'), na: count('na') + count('skip'),
      other: checks.length - count('pass') - count('fail') - count('na') - count('skip') } };
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
