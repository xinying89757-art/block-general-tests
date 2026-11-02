import { applyHumanReviewVerdict, collectHumanReview, countVerdicts, verdictCountsZh } from './human-review.mjs';
import { deriveFrontReportId } from './front-report-identity.mjs';
function reportBlockId(report) {
  return String(report?.blockId ?? report?.targetBlockId ?? '');
}

function frontReportIdentity(frontReport, timestamp) {
  const explicit = frontReport?.runId || frontReport?.reportId || frontReport?.id;
  if (explicit) return { id: String(explicit), derived: false };
  const id = deriveFrontReportId(frontReport?.expectedValueSourceReport, timestamp);
  return id ? { id, derived: true } : null;
}

function uniqueRows(report, sourceName) {
  if (!Array.isArray(report?.checks)) throw new Error(`${sourceName} report must contain a checks array.`);
  const ids = new Set();
  for (const row of report.checks) {
    if (!row?.id || ids.has(String(row.id))) throw new Error(`${sourceName} report has a missing or duplicate check id.`);
    ids.add(String(row.id));
  }
  return report.checks;
}

function frontConfirmsAddedInstance(boxReport, frontReport) {
  const settingId = boxReport?.lifecycle?.addedSettingId;
  const frontSettingId = frontReport?.settingId ?? frontReport?.block?.settingId;
  const url = frontReport?.finalUrl || frontReport?.url || frontReport?.links?.front || '';
  const checkedAt = frontReport?.finishedAt || frontReport?.checkedAt || frontReport?.startedAt;
  const identity = frontReportIdentity(frontReport, checkedAt);
  let cacheBusted = false;
  try { cacheBusted = Boolean(new URL(url).searchParams.get('t')); } catch {}
  return Boolean(identity && checkedAt && settingId && String(frontSettingId || '') === String(settingId)
    && String(frontReport?.instanceResolution || '').includes('block-number+settingId')
    && Number(frontReport?.blockInstances ?? frontReport?.instanceCount ?? 0) > 0
    && cacheBusted && reportBlockId(frontReport) === reportBlockId(boxReport));
}

function isFrontUnreachableFailure(row) {
  if (row?.status !== 'fail') return false;
  const codes = [row.classification, row.reason?.code, row.reason?.classification,
    row.evidence?.classification, row.batchResult?.classification]
    .filter((value) => typeof value === 'string');
  return codes.length > 0 && codes.every((code) => code === 'front-unreachable-from-runner');
}

function isDisplayEffectLimitation(row) {
  if (!['human-review', 'na', 'skip'].includes(row?.status)) return false;
  const code = row?.reason?.code ?? row?.reasonCode ?? row?.evidence?.reason?.code ?? row?.evidence?.reason;
  return code === 'effect-unresolved-on-canvas';
}

function displayFieldSetting(row) {
  const values = [row?.setting, row?.settingKey, row?.capability, row?.capabilityId]
    .filter((value) => typeof value === 'string').map((value) => value.toLowerCase());
  return values.some((value) => /display[-_ ]?field|展示字段/.test(value));
}

function sameValue(left, right) {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function displayFieldPersistCanvasEffectFailure(row) {
  if (!displayFieldSetting(row) || row?.status !== 'fail') return false;
  // A known persistence mismatch is authoritative even when a separate rerun
  // happened to pass; the front effect must not erase that failure.
  if (row.expected !== undefined && row.actual !== undefined && !sameValue(row.expected, row.actual)) return false;
  const rerun = row.rerunAloneResult;
  const persisted = row.expected !== undefined && row.actual !== undefined && sameValue(row.expected, row.actual)
    || rerun?.status === 'pass' && (rerun.expected === undefined || rerun.actual === undefined
      || sameValue(rerun.expected, rerun.actual));
  if (!persisted) return false;
  const details = [row.detail, row.error, row.batchResult?.detail, row.batchResult?.error,
    rerun?.detail, rerun?.evidence?.effectCheck?.detail, row.batchResult?.evidence?.effectCheck?.detail,
    row.evidence?.effectCheck?.detail,
    row.reason?.code, row.evidence?.reason?.code, row.batchResult?.evidence?.reason?.code]
    .filter((value) => typeof value === 'string').join(' ');
  const effectStatuses = [row.batchResult?.evidence?.effectCheck?.status, row.evidence?.effectCheck?.status,
    rerun?.evidence?.effectCheck?.status];
  const effectFailedOrUnresolved = effectStatuses.some((status) => ['fail', 'skip', 'na', 'human-review'].includes(status));
  return effectFailedOrUnresolved
    || /effect-unresolved-on-canvas|静态内容.{0,16}(?:读不到|暂时)|无法唯一识别|对应位置.{0,12}(?:识别|读取)/i.test(details);
}

function matchingDisplayFieldFrontRow(boxRow, frontRows) {
  if (!displayFieldSetting(boxRow)) return null;
  return frontRows.find((frontRow) => {
    if (frontRow?.setting && boxRow?.setting && String(frontRow.setting) !== String(boxRow.setting)) return false;
    const sourceId = frontRow?.evidence?.sourceCheckId ?? frontRow?.sourceCheckId;
    if (sourceId && String(sourceId) === String(boxRow.id)) return true;
    return displayFieldSetting(frontRow) && String(frontRow?.setting ?? frontRow?.settingKey ?? '')
      === String(boxRow?.setting ?? boxRow?.settingKey ?? '');
  }) || null;
}

function mergeDisplayFieldSources(boxRow, frontRow) {
  const canvasEffectStatus = boxRow?.batchResult?.evidence?.effectCheck?.status
    ?? boxRow?.evidence?.effectCheck?.status ?? boxRow?.rerunAloneResult?.evidence?.effectCheck?.status;
  const canvasDisagreement = frontRow.status === 'pass' && canvasEffectStatus === 'fail'
    ? { status: 'human-review', reason: { code: 'canvas-front-effect-disagreement' },
      detail: '盒端画布效果检查与前台结果不一致；最终 verdict 采用已确认实例的前台检查。' }
    : null;
  return { ...boxRow, status: frontRow.status,
    ...(frontRow.expected !== undefined ? { expected: frontRow.expected } : {}),
    ...(frontRow.actual !== undefined ? { actual: frontRow.actual } : {}),
    ...(frontRow.detail !== undefined ? { detail: frontRow.detail } : {}),
    ...(frontRow.reason !== undefined ? { reason: frontRow.reason } : {}),
    ...(frontRow.evidence !== undefined ? { frontEvidence: frontRow.evidence } : {}),
    ...(canvasDisagreement ? { canvasDisagreement } : {}),
    resolvedBy: 'front-report', resolvedCheckId: frontRow.id,
    sources: { box: boxRow, front: frontRow }, selectedSource: 'front-report' };
}

/** Keep both report sources; front resolves deferred checks and verified display-field effect rows. */
export function mergeFreshFrontReports(boxReport, frontReport) {
  const boxBlock = reportBlockId(boxReport);
  const frontBlock = reportBlockId(frontReport);
  if (!boxBlock || !frontBlock || boxBlock !== frontBlock) throw new Error('Box and front reports must identify the same block.');
  const boxRows = uniqueRows(boxReport, 'Box');
  const frontRows = uniqueRows(frontReport, 'Front');
  const boxById = new Map(boxRows.map((row) => [String(row.id), row]));
  const frontById = new Map(frontRows.map((row) => [String(row.id), row]));
  const confirmsAddedInstance = frontConfirmsAddedInstance(boxReport, frontReport);
  const selectedChecks = [];
  const consumedFrontRows = new Set();
  for (const box of boxRows) {
    const front = frontById.get(String(box.id));
    const displayFront = confirmsAddedInstance && displayFieldPersistCanvasEffectFailure(box)
      ? matchingDisplayFieldFrontRow(box, frontRows) : null;
    if (displayFront) consumedFrontRows.add(String(displayFront.id));
    const resolvesPublishFailure = confirmsAddedInstance && isFrontUnreachableFailure(box);
    const resolvesDisplayLimitation = confirmsAddedInstance && isDisplayEffectLimitation(box) && front;
    const selectedSource = displayFront ? 'front-report' : resolvesPublishFailure ? 'front-report'
      : front && (box.status === 'deferred' || resolvesDisplayLimitation) ? 'front' : 'box';
    const selected = resolvesPublishFailure
      ? { ...box, status: 'pass', resolvedBy: 'front-report',
        frontConfirmation: { reportId: frontReportIdentity(frontReport,
          frontReport.finishedAt || frontReport.checkedAt || frontReport.startedAt)?.id || null,
          url: frontReport.finalUrl || frontReport.url || null,
          timestamp: frontReport.finishedAt || frontReport.checkedAt || frontReport.startedAt || null,
          settingId: frontReport.settingId ?? frontReport.block?.settingId,
          instanceResolution: frontReport.instanceResolution,
          ...(frontReportIdentity(frontReport, frontReport.finishedAt || frontReport.checkedAt || frontReport.startedAt)?.derived
            ? { reportIdDerivedFrom: frontReport.expectedValueSourceReport } : {}) } }
      : displayFront ? mergeDisplayFieldSources(box, displayFront)
      : selectedSource === 'front' ? front : box;
    const keptFailure = isFrontUnreachableFailure(box) && !confirmsAddedInstance
      ? { ...box, detail: '前台未找到本次新实例：Mac 前台报告未能以缓存刷新 URL 确认同一个新 settingId。',
        frontResolution: { status: 'not-confirmed', frontReportId: frontReportIdentity(frontReport,
          frontReport.finishedAt || frontReport.checkedAt || frontReport.startedAt)?.id || null,
          frontSettingId: frontReport.settingId ?? frontReport.block?.settingId ?? null,
          expectedSettingId: boxReport?.lifecycle?.addedSettingId ?? null,
          url: frontReport.finalUrl || frontReport.url || null } }
      : selected;
    selectedChecks.push(displayFront ? selected : { ...keptFailure,
      sources: { box, ...(front ? { front } : {}) }, selectedSource });
  }
  for (const front of frontRows) if (!boxById.has(String(front.id)) && !consumedFrontRows.has(String(front.id))) {
    selectedChecks.push({ ...front, sources: { front }, selectedSource: 'front' });
  }
  const checks = selectedChecks.map((check) => applyHumanReviewVerdict(check));
  const summary = countVerdicts(checks);
  return { ...boxReport, flow: 'fresh-front-merged', checks, summary, humanReview: collectHumanReview(checks),
    merge: { sources: { box: boxReport.runId || null, front: frontReportIdentity(frontReport,
      frontReport.finishedAt || frontReport.checkedAt || frontReport.startedAt)?.id || null },
      matchedIds: boxRows.filter(({ id }) => frontById.has(String(id))).map(({ id }) => id),
      frontOverrides: boxRows.filter(({ id, status }) => status === 'deferred' && frontById.has(String(id))).map(({ id }) => id),
      frontResolvedIds: boxRows.filter((row) => confirmsAddedInstance
        && (isFrontUnreachableFailure(row) || (frontById.has(String(row.id)) && isDisplayEffectLimitation(row))
          || matchingDisplayFieldFrontRow(row, frontRows) && displayFieldPersistCanvasEffectFailure(row)))
        .map(({ id }) => id),
      addedInstanceConfirmed: confirmsAddedInstance,
      addedSettingId: boxReport?.lifecycle?.addedSettingId || null,
      frontOnlyIds: frontRows.filter(({ id }) => !boxById.has(String(id)) && !consumedFrontRows.has(String(id)))
        .map(({ id }) => id) } };
}

export function summarizeFreshFrontMerge(report) {
  return `# 盒端与前台报告合并\n\n- 区块：${reportBlockId(report) || '未知'}\n- 检查数：${report.checks?.length || 0}\n- 结果：${verdictCountsZh(report.summary || {})}\n- 前台覆盖的 deferred：${report.merge?.frontOverrides?.join('、') || '无'}\n- 盒端与前台均保留来源记录；deferred 行及已确认的展示字段效果结果按 setting 合并，仅计一次。盒端持久化不一致仍单独计 fail。\n`;
}
