import { addStyleFailureReasons, styleCheckDescriptors } from './capabilities/block-style-spec.mjs';

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
