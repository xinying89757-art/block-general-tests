export function isAllowedLinkUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /\s|[\u3000-\u303f\uff00-\uffef]/.test(value)) return false;
  if (value === 'javascript:void(0)') return true;
  if (/^mailto:/i.test(value)) return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function assertAllowedLinkUrl(value) {
  if (!isAllowedLinkUrl(value)) {
    throw new Error(`拒绝写入不合法的链接地址：${JSON.stringify(value)}。仅允许完整 HTTP(S) URL、mailto:地址或 javascript:void(0)。`);
  }
}
