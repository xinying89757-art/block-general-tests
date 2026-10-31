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
