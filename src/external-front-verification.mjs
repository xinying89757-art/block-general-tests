function safeUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('External verification URL must use HTTP or HTTPS.');
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (key !== 't') url.searchParams.delete(key);
  return url.href;
}

export function applyExternalFrontVerification(report, result) {
  if (!report || typeof report !== 'object' || !report.block?.settingId || !report.blockId) {
    throw new Error('Report must identify blockId and the fresh block settingId.');
  }
  if (!result || typeof result !== 'object' || !result.url || !Number.isInteger(result.httpStatus)
    || typeof result.blockFound !== 'boolean' || typeof result.settingIdFound !== 'boolean'
    || typeof result.checkedAt !== 'string' || Number.isNaN(Date.parse(result.checkedAt))) {
    throw new Error('External result requires url, integer httpStatus, boolean blockFound/settingIdFound, and checkedAt.');
  }
  const confirmed = result.httpStatus >= 200 && result.httpStatus < 300
    && result.blockFound && result.settingIdFound;
  const externalFrontVerification = {
    url: safeUrl(result.url), httpStatus: result.httpStatus,
    blockFound: result.blockFound, settingIdFound: result.settingIdFound,
    checkedAt: new Date(result.checkedAt).toISOString(), confirmed,
  };
  return { ...report, externalFrontVerification,
    publishedConfirmed: Boolean(report.publishedConfirmed || confirmed),
    published: Boolean(report.published || confirmed),
    confirmationSource: confirmed ? 'external-front-check'
      : (report.confirmationSource || null) };
}

export function applyExternalFrontStyleReport(report, frontStyleReport, sourcePath) {
  if (!report || typeof report !== 'object' || !report.blockId || !report.block?.settingId) {
    throw new Error('Fresh report must identify blockId and the fresh block settingId.');
  }
  if (!frontStyleReport || frontStyleReport.flow !== 'front-style-only'
    || !frontStyleReport.summary || typeof frontStyleReport.summary !== 'object'
    || typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw new Error('Expected a front-style-only report, summary counts, and its source path.');
  }
  if (String(frontStyleReport.blockId) !== String(report.blockId)) throw new Error('Front-style report blockId does not match the fresh report.');
  if (frontStyleReport.settingId && String(frontStyleReport.settingId) !== String(report.block.settingId)) {
    throw new Error('Front-style report settingId does not match the fresh instance.');
  }
  const summary = {};
  for (const key of ['pass', 'fail', 'na', 'human-review', 'other']) {
    const value = frontStyleReport.summary[key] ?? 0;
    if (!Number.isInteger(value) || value < 0) throw new Error(`Front-style summary ${key} must be a non-negative integer.`);
    summary[key] = value;
  }
  return { ...report, externalFrontStyleReport: {
    path: sourcePath.split(/[\\/]/).at(-1), summary,
    settingId: frontStyleReport.settingId || null,
    checkedAt: typeof frontStyleReport.finishedAt === 'string' && !Number.isNaN(Date.parse(frontStyleReport.finishedAt))
      ? new Date(frontStyleReport.finishedAt).toISOString() : null,
  } };
}
