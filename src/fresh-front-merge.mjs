import { applyHumanReviewVerdict, collectHumanReview, countVerdicts, verdictCountsZh } from './human-review.mjs';
function reportBlockId(report) {
  return String(report?.blockId ?? report?.targetBlockId ?? '');
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
  const reportId = frontReport?.runId || frontReport?.reportId || frontReport?.id;
  const checkedAt = frontReport?.finishedAt || frontReport?.checkedAt || frontReport?.startedAt;
  let cacheBusted = false;
  try { cacheBusted = Boolean(new URL(url).searchParams.get('t')); } catch {}
  return Boolean(reportId && checkedAt && settingId && String(frontSettingId || '') === String(settingId)
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

/** Keep both report sources; a front row replaces only a box deferred row. */
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
  for (const box of boxRows) {
    const front = frontById.get(String(box.id));
    const resolvesPublishFailure = confirmsAddedInstance && isFrontUnreachableFailure(box);
    const resolvesDisplayLimitation = confirmsAddedInstance && isDisplayEffectLimitation(box) && front;
    const selectedSource = resolvesPublishFailure ? 'front-report'
      : front && (box.status === 'deferred' || resolvesDisplayLimitation) ? 'front' : 'box';
    const selected = resolvesPublishFailure
      ? { ...box, status: 'pass', resolvedBy: 'front-report',
        frontConfirmation: { reportId: frontReport.runId || frontReport.reportId || frontReport.id || null,
          url: frontReport.finalUrl || frontReport.url || null,
          timestamp: frontReport.finishedAt || frontReport.checkedAt || frontReport.startedAt || null,
          settingId: frontReport.settingId ?? frontReport.block?.settingId,
          instanceResolution: frontReport.instanceResolution } }
      : selectedSource === 'front' ? front : box;
    const keptFailure = isFrontUnreachableFailure(box) && !confirmsAddedInstance
      ? { ...box, detail: '前台未找到本次新实例：Mac 前台报告未能以缓存刷新 URL 确认同一个新 settingId。',
        frontResolution: { status: 'not-confirmed', frontReportId: frontReport.runId || frontReport.reportId || frontReport.id || null,
          frontSettingId: frontReport.settingId ?? frontReport.block?.settingId ?? null,
          expectedSettingId: boxReport?.lifecycle?.addedSettingId ?? null,
          url: frontReport.finalUrl || frontReport.url || null } }
      : selected;
    selectedChecks.push({ ...keptFailure,
      sources: { box, ...(front ? { front } : {}) }, selectedSource });
  }
  for (const front of frontRows) if (!boxById.has(String(front.id))) {
    selectedChecks.push({ ...front, sources: { front }, selectedSource: 'front' });
  }
  const checks = selectedChecks.map((check) => applyHumanReviewVerdict(check));
  const summary = countVerdicts(checks);
  return { ...boxReport, flow: 'fresh-front-merged', checks, summary, humanReview: collectHumanReview(checks),
    merge: { sources: { box: boxReport.runId || null, front: frontReport.runId || frontReport.reportId || frontReport.id || null },
      matchedIds: boxRows.filter(({ id }) => frontById.has(String(id))).map(({ id }) => id),
      frontOverrides: boxRows.filter(({ id, status }) => status === 'deferred' && frontById.has(String(id))).map(({ id }) => id),
      frontResolvedIds: boxRows.filter((row) => confirmsAddedInstance
        && (isFrontUnreachableFailure(row) || (frontById.has(String(row.id)) && isDisplayEffectLimitation(row))))
        .map(({ id }) => id),
      addedInstanceConfirmed: confirmsAddedInstance,
      addedSettingId: boxReport?.lifecycle?.addedSettingId || null,
      frontOnlyIds: frontRows.filter(({ id }) => !boxById.has(String(id))).map(({ id }) => id) } };
}

export function summarizeFreshFrontMerge(report) {
  return `# 盒端与前台报告合并\n\n- 区块：${reportBlockId(report) || '未知'}\n- 检查数：${report.checks?.length || 0}\n- 结果：${verdictCountsZh(report.summary || {})}\n- 前台覆盖的 deferred：${report.merge?.frontOverrides?.join('、') || '无'}\n- 盒端与前台均保留来源记录；只有盒端 deferred 行会选用前台结果。\n`;
}
