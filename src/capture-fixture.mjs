import { sanitizeCaptureAttribute, sanitizeCaptureCss, sanitizeCaptureText } from './instance-capture.mjs';

const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const forbiddenTags = /^(script|style|noscript|iframe|object|embed|base|meta|link)$/i;
const voidTags = /^(area|br|col|hr|img|input|source|track|wbr)$/i;
function placeholder(row, replayObservations = false) {
  if (replayObservations && !(row.image?.naturalWidth > 0 && row.image?.naturalHeight > 0)) return 'data:image/png;base64,';
  const width = Math.max(1, Math.min(10000, Math.round(row.image?.naturalWidth || row.rect?.width || 1)));
  const height = Math.max(1, Math.min(10000, Math.round(row.image?.naturalHeight || row.rect?.height || 1)));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'/%3E`;
}
function offlineCss(input) {
  return sanitizeCaptureCss(input).replace(/url\([^)]*\)/gi, 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'1\' height=\'1\'/%3E")');
}

/** Rebuild from typed tree data; never trust or execute captured outerHTML. */
export function fixtureFromCapture(capture, { cssFile = 'fixture.css', replayObservations = false } = {}) {
  if (capture?.version !== 1 || capture.sanitized !== true || !Array.isArray(capture.elements)) throw new Error('Unsupported or unsanitized instance capture.');
  const rows = new Map(capture.elements.map((row) => [row.nodeIndex, row]));
  const root = rows.get(capture.rootIndex);
  if (!root) throw new Error('Capture root is missing.');
  const visiting = new Set();
  const render = (row) => {
    if (!row || visiting.has(row.nodeIndex)) throw new Error('Capture tree is missing a node or contains a cycle.');
    const tag = String(row.tag || '').toLowerCase();
    if (!/^[a-z][a-z0-9:-]*$/.test(tag) || forbiddenTags.test(tag) || (tag === 'input' && row.attributes?.type === 'password')) return '';
    visiting.add(row.nodeIndex);
    const attributes = [];
    for (const [name, raw] of Object.entries(row.attributes || {})) {
      if (!/^[a-z_:][a-z0-9_.:-]*$/i.test(name) || /^data-capture-node$/i.test(name)
        || /^data-(?:setting-base64|storage|auto_uuid|relate-appid|blockseditor-type)$/i.test(name)) continue;
      let value = sanitizeCaptureAttribute(name, raw);
      if (value === null) continue;
      if (/^(href|action|formaction|ping)$/i.test(name)) value = name === 'href' ? '#' : '';
      if (/^(?:src|srcset|poster|data-(?:.*-)?(?:src|srcset|original))$/i.test(name)) value = placeholder(row, replayObservations);
      if (name === 'style') { if (replayObservations) continue; value = offlineCss(value); }
      attributes.push(`${name}="${escape(value)}"`);
    }
    if (replayObservations) {
      const parent = rows.get(row.parentIndex);
      const number = (value) => Number.isFinite(Number(value)) ? Math.max(-1000000, Math.min(1000000, Number(value))) : 0;
      const rect = row.rect || {}, origin = parent?.rect || { x: 0, y: 0 };
      const width = Math.max(0, number(rect.width)), height = Math.max(0, number(rect.height));
      const observed = Object.entries(row.computed || {}).filter(([key]) =>
        ['display', 'visibility', 'opacity', 'cursor', 'backgroundImage', 'color', 'fontSize', 'fontWeight',
          'overflow', 'objectFit', 'objectPosition'].includes(key)).map(([key, value]) =>
        `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${offlineCss(String(value)).slice(0, 500)} !important`);
      // Snapshot replay, not a new layout engine: preserve observed visibility
      // and border-box geometry rather than flatten CSS specificity into a
      // different rendered state. No handler or remote request is replayed.
      observed.push('position:absolute !important', 'box-sizing:border-box !important', 'margin:0 !important',
        'padding:0 !important', 'border-width:0 !important', 'transform:none !important',
        `left:${number(rect.x) - number(origin.x)}px !important`, `top:${number(rect.y) - number(origin.y)}px !important`,
        `width:${width}px !important`, `height:${height}px !important`,
        `min-width:${width}px !important`, `max-width:${width}px !important`,
        `min-height:${height}px !important`, `max-height:${height}px !important`);
      attributes.push(`style="${escape(`${offlineCss(row.attributes?.style || '')};${observed.join(';')}`)}"`);
    }
    attributes.push(`data-capture-node="${row.nodeIndex}"`);
    const children = (row.children || []).map((child) => typeof child === 'number' ? render(rows.get(child))
      : escape(sanitizeCaptureText(child))).join('');
    visiting.delete(row.nodeIndex);
    return `<${tag} ${attributes.join(' ')}>${voidTags.test(tag) ? '' : `${children}</${tag}>`}`;
  };
  const css = (capture.cssRules || []).flatMap((rule) => {
    const selectors = [...new Set((rule.matchedNodes || []).filter((node) => rows.has(node.nodeIndex)).map((node) => {
      const suffix = /^(?:::{0,1}(?:before|after|marker|placeholder|hover|focus|focus-visible|active|checked|open))*$/.test(node.suffix || '') ? node.suffix || '' : '';
      return `[data-capture-node="${node.nodeIndex}"]${suffix}`;
    }))];
    if (!selectors.length) return [];
    const conditions = (rule.conditions || []).filter((value) => /^@(media|supports|container|layer)\b[^{};]*$/i.test(value));
    return [`${conditions.map((value) => `${sanitizeCaptureText(value)} {`).join('\n')}\n${selectors.join(',\n')} { ${offlineCss(rule.body)} }\n${'}'.repeat(conditions.length)}`];
  }).join('\n');
  const html = `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'">\n<link rel="stylesheet" href="${escape(cssFile)}"></head><body>${render(root)}</body></html>\n`;
  return { html: html.replace(/[ \t]+$/gm, ''), css, replayObservations, viewport: capture.viewport, elementCount: rows.size,
    limitations: [...(replayObservations ? ['Observed-state replay preserves captured geometry/visibility and zero natural image dimensions; unavailable image bytes remain unavailable. CSS layout, animation and SVG internals are not pixel replayed.'] : []), 'Original scripts and event handler bodies are excluded. Listener metadata is in the capture JSON; interaction behavior is not replayed.',
      'Remote resources use inert image placeholders. Rule targets are remapped to captured node identities, so outside-instance ancestors are not required.'] };
}
