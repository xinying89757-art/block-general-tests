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

/** Keep both report sources; a front row replaces only a box deferred row. */
export function mergeFreshFrontReports(boxReport, frontReport) {
  const boxBlock = reportBlockId(boxReport);
  const frontBlock = reportBlockId(frontReport);
  if (!boxBlock || !frontBlock || boxBlock !== frontBlock) throw new Error('Box and front reports must identify the same block.');
  const boxRows = uniqueRows(boxReport, 'Box');
  const frontRows = uniqueRows(frontReport, 'Front');
  const boxById = new Map(boxRows.map((row) => [String(row.id), row]));
  const frontById = new Map(frontRows.map((row) => [String(row.id), row]));
  const checks = [];
  for (const box of boxRows) {
    const front = frontById.get(String(box.id));
    const selectedSource = box.status === 'deferred' && front ? 'front' : 'box';
    checks.push({ ...(selectedSource === 'front' ? front : box),
      sources: { box, ...(front ? { front } : {}) }, selectedSource });
  }
  for (const front of frontRows) if (!boxById.has(String(front.id))) {
    checks.push({ ...front, sources: { front }, selectedSource: 'front' });
  }
  const summary = { pass: 0, fail: 0, skip: 0, na: 0, record: 0, deferred: 0,
    'not-applicable': 0, 'not-adapted': 0, 'env-timeout': 0, 'env-paused': 0 };
  for (const row of checks) if (Object.hasOwn(summary, row.status)) summary[row.status] += 1;
  return { ...boxReport, flow: 'fresh-front-merged', checks, summary,
    merge: { sources: { box: boxReport.runId || null, front: frontReport.runId || null },
      matchedIds: boxRows.filter(({ id }) => frontById.has(String(id))).map(({ id }) => id),
      frontOverrides: boxRows.filter(({ id, status }) => status === 'deferred' && frontById.has(String(id))).map(({ id }) => id),
      frontOnlyIds: frontRows.filter(({ id }) => !boxById.has(String(id))).map(({ id }) => id) } };
}

export function summarizeFreshFrontMerge(report) {
  return `# 盒端与前台报告合并\n\n- 区块：${reportBlockId(report) || '未知'}\n- 检查数：${report.checks?.length || 0}\n- 结果：${Object.entries(report.summary || {}).filter(([, count]) => count).map(([status, count]) => `${status} ${count}`).join('、') || '无检查行'}\n- 前台覆盖的 deferred：${report.merge?.frontOverrides?.join('、') || '无'}\n- 盒端与前台均保留来源记录；只有盒端 deferred 行会选用前台结果。\n`;
}
