export function normalizeLinkUrl(value) {
  // The editor serializes this allowlisted no-op target with a trailing
  // semicolon on some blocks. Canonicalize only that exact harmless variant.
  return value === 'javascript:void(0);' ? 'javascript:void(0)' : value;
}

export function isAllowedLinkUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /\s|[\u3000-\u303f\uff00-\uffef]/.test(value)) return false;
  const normalized = normalizeLinkUrl(value);
  if (normalized === 'javascript:void(0)') return true;
  if (/^mailto:/i.test(normalized)) return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalized);
  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function assertAllowedLinkUrl(value) {
  if (!isAllowedLinkUrl(value)) {
    throw new Error(`拒绝写入不合法的链接地址：${JSON.stringify(value)}。仅允许完整 HTTP(S) URL、mailto:地址或 javascript:void(0)。`);
  }
  return value;
}
