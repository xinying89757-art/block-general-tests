function sourceBasename(sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) return '';
  return sourcePath.trim().replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || '';
}

/** Stable, non-secret fallback identity for front reports that predate runId. */
export function deriveFrontReportId(sourceReportPath, timestamp) {
  const basename = sourceBasename(sourceReportPath);
  return basename && typeof timestamp === 'string' && timestamp.trim()
    ? `${basename}:${timestamp.trim()}` : null;
}

/** Front-only runs link their source report basename to the run's start timestamp. */
export function createFrontRunId(sourceReportPath, startedAt) {
  return deriveFrontReportId(sourceReportPath, startedAt)
    || deriveFrontReportId('front-style-only', startedAt);
}
