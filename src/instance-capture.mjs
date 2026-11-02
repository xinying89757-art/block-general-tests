import fs from 'node:fs/promises';
import path from 'node:path';
import { scanWrittenColorStylesheets } from './design-spec-checklist.mjs';

const SECRET_NAME = /password|passwd|secret|token|cookie|authorization|credential|csrf|session|api[-_]?key/i;
export function sanitizeCaptureText(input) {
  return String(input ?? '')
    .replace(/https?:\/\/[^\s<>"'()]+/gi, (value) => {
      try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
      catch { return '[redacted-url]'; }
    })
    .replace(/\?[A-Za-z0-9_.%~-]+=[^\s"'<>)]*/g, '')
    .replace(/data:[^\s"'<>)]*/gi, '[omitted:data-url]')
    .replace(/\bBearer\s+[^\s"'<>;,]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/(["']?(?:password|passwd|secret|token|cookie|authorization|credential|csrf|session|api[-_]?key)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}<]+)/gi, '$1[redacted]');
}
export function sanitizeCaptureAttribute(name, input) {
  if (SECRET_NAME.test(name) || /^on/i.test(name) || /^(srcdoc|nonce|integrity|value)$/i.test(name)) return null;
  const value = String(input ?? '');
  if (value.length > 200) return '[omitted:attribute-over-200-chars]';
  if (/^(?:javascript|vbscript):/i.test(value.trim())) return '';
  return sanitizeCaptureText(value).slice(0, 200);
}
export function sanitizeCaptureCss(input) {
  return sanitizeCaptureText(input).replace(/@import\s+[^;]+;/gi, '')
    .replace(/(?:expression\s*\([^;]*|(?:-moz-binding|behavior)\s*:[^;]*)/gi, '')
    .replace(/url\(\s*["']?\s*(?:javascript|vbscript):[^)]*\)/gi, 'none')
    .replace(/</g, '\\3c ');
}

// Read a clone only. No live DOM attribute, value, event or setting is changed.
export function readCaptureDom({ rootSelector }) {
  const roots = document.querySelectorAll(rootSelector);
  if (roots.length !== 1) throw new Error(`Capture requires exactly one instance root (found ${roots.length}).`);
  const root = roots[0], nodes = [root, ...root.querySelectorAll('*')];
  const index = new Map(nodes.map((node, i) => [node, i]));
  const forbidden = /^(SCRIPT|STYLE|NOSCRIPT|IFRAME|OBJECT|EMBED|BASE|META|LINK)$/i;
  const secret = /password|passwd|secret|token|cookie|authorization|credential|csrf|session|api[-_]?key/i;
  const safe = (input) => String(input ?? '')
    .replace(/https?:\/\/[^\s<>"'()]+/gi, (value) => { try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; } catch { return '[redacted-url]'; } })
    .replace(/\?[A-Za-z0-9_.%~-]+=[^\s"'<>)]*/g, '')
    .replace(/data:[^\s"'<>)]*/gi, '[omitted:data-url]')
    .replace(/\bBearer\s+[^\s"'<>;,]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/(["']?(?:password|passwd|secret|token|cookie|authorization|credential|csrf|session|api[-_]?key)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}<]+)/gi, '$1[redacted]');
  const omitted = new Set();
  const tree = [];
  const relativePath = (node) => {
    if (node === root) return ':scope';
    const parts = [];
    for (let item = node; item && item !== root; item = item.parentElement) parts.unshift(`${item.tagName.toLowerCase()}:nth-child(${[...item.parentElement.children].indexOf(item) + 1})`);
    return `:scope > ${parts.join(' > ')}`;
  };
  const clone = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(safe(node.textContent).slice(0, 200));
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (forbidden.test(node.tagName) || node.matches('input[type="password"]')) { omitted.add(index.get(node)); return null; }
    const copy = node.cloneNode(false), attributes = {}, redactedAttributes = [];
    for (const attribute of [...copy.attributes]) copy.removeAttribute(attribute.name);
    for (const { name, value } of [...node.attributes]) {
      if (secret.test(name) || /^on/i.test(name) || /^(srcdoc|nonce|integrity|value)$/i.test(name)) { redactedAttributes.push(name); continue; }
      const cleaned = value.length > 200 ? '[omitted:attribute-over-200-chars]'
        : /^(?:javascript|vbscript):/i.test(value.trim()) ? '' : safe(value).slice(0, 200);
      copy.setAttribute(name, cleaned); attributes[name] = cleaned;
    }
    copy.setAttribute('data-capture-node', String(index.get(node)));
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const row = { nodeIndex: index.get(node), parentIndex: node === root ? null : index.get(node.parentElement),
      path: relativePath(node), tag: node.tagName.toLowerCase(), classes: (attributes.class || '').split(/\s+/).filter(Boolean),
      attributes, redactedAttributes,
      rect: Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.round(rect[key] * 100) / 100])),
      computed: { display: style.display, visibility: style.visibility, opacity: style.opacity, cursor: style.cursor,
        backgroundImage: safe(style.backgroundImage), color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight,
        position: style.position, overflow: style.overflow, objectFit: style.objectFit, objectPosition: style.objectPosition },
      handlerTypes: [...node.attributes].filter((attribute) => /^on[a-z]+$/i.test(attribute.name)).map((attribute) => attribute.name.slice(2)),
      ...(node.tagName === 'IMG' ? { image: { naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight } } : {}), children: [] };
    tree.push(row);
    if (node.tagName !== 'TEXTAREA') for (const child of node.childNodes) {
      const copied = clone(child);
      if (copied) { copy.append(copied); row.children.push(child.nodeType === Node.ELEMENT_NODE ? index.get(child) : copied.textContent); }
    }
    return copy;
  };
  const sanitizedRoot = clone(root);
  return { version: 1, sanitized: true, rootIndex: 0, rootCount: 1, outerHTML: sanitizedRoot.outerHTML,
    elements: tree, omittedElementCount: omitted.size, sourceElementCount: nodes.length };
}

function bounded(operation, timeoutMs, code) {
  let timer;
  return Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

async function captureListeners(page, rootSelector, elements, timeoutMs) {
  let cdp;
  try {
    const context = page.context?.();
    if (!context?.newCDPSession) return { status: 'unavailable', code: 'cdp-unavailable' };
    cdp = await context.newCDPSession(page);
    return await bounded(async () => {
      const group = `instance-capture-${Date.now()}`;
      const rows = elements.slice(0, 1000).map((row) => ({ path: row.path, tag: row.tag, id: row.attributes.id || '' }));
      const remote = await cdp.send('Runtime.evaluate', { expression: `(() => { const root = document.querySelector(${JSON.stringify(rootSelector)}); return ${JSON.stringify(rows)}.map(row => { if (!root) return null; const node = row.path === ':scope' ? root : root.querySelector(row.path); return node && node.tagName.toLowerCase() === row.tag && (node.id || '') === row.id ? node : null; }); })()`, objectGroup: group });
      const properties = await cdp.send('Runtime.getProperties', { objectId: remote.result.objectId, ownProperties: true });
      const objects = new Map(properties.result.filter((row) => /^\d+$/.test(row.name)).map((row) => [Number(row.name), row.value?.objectId]));
      let inspectedCount = 0;
      const queue = elements.slice(0, 1000).map((element, arrayIndex) => ({ element, arrayIndex }));
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const { element, arrayIndex } = queue.shift(), objectId = objects.get(arrayIndex);
          if (!objectId) { element.listenersUnavailable = 'capture-node-no-longer-matches'; continue; }
          try {
            const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId });
            element.listeners = listeners.map((listener) => ({ type: String(listener.type).slice(0, 80),
              useCapture: Boolean(listener.useCapture), passive: Boolean(listener.passive), once: Boolean(listener.once) }));
            inspectedCount += 1;
          } catch { element.listenersUnavailable = 'cdp-element-listeners-unavailable'; }
        }
      }));
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group });
      return { status: inspectedCount === elements.length ? 'available' : 'partial', inspectedCount,
        omittedCount: Math.max(0, elements.length - inspectedCount), delegatedListenersOutsideInstance: 'not-captured' };
    }, timeoutMs, 'capture-listeners-timeout');
  } catch (error) { return { status: 'unavailable', code: error.code || 'cdp-listeners-unavailable' }; }
  finally { await cdp?.detach().catch(() => {}); }
}

export async function captureFrontInstance({ page, rootSelector, directory, viewport, identity = null, timeoutMs = 20000, fetchStylesheet, fetchNode } = {}) {
  const dom = await bounded(() => page.evaluate(readCaptureDom, { rootSelector }), timeoutMs, 'capture-dom-timeout');
  const listeners = await captureListeners(page, rootSelector, dom.elements, timeoutMs);
  const captureErrors = [];
  let sheets;
  try { sheets = await bounded(() => scanWrittenColorStylesheets({ page, rootSelector, captureRules: true, fetchStylesheet, fetchNode }),
    timeoutMs * 3, 'capture-stylesheets-timeout'); }
  catch (error) { captureErrors.push({ stage: 'stylesheets', code: error.code || 'capture-stylesheets-unavailable' });
    sheets = { matchingRules: [], sheetCount: 0, ruleCount: 0, fetchFailureCount: 0, fetchFailures: [], unreadableSheets: [] }; }
  let rules = [];
  try { rules = await bounded(() => page.evaluate(({ rootSelector, rules, elements }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return [];
    const indexes = new Map(elements.flatMap((row) => {
      const node = row.path === ':scope' ? root : root.querySelector(row.path);
      return node && node.tagName.toLowerCase() === row.tag && (node.id || '') === (row.attributes.id || '') ? [[node, row.nodeIndex]] : [];
    }));
    return rules.map((rule) => ({ ...rule, matchedNodes: (rule.matchedSelectors || []).flatMap((selector) => {
      const base = selector.replace(/::(?:before|after|marker|placeholder)\b/g, '').replace(/:(?:hover|focus|focus-visible|active|checked|open)\b/g, '');
      const suffix = [...selector.matchAll(/::?(?:before|after|marker|placeholder|hover|focus-visible|focus|active|checked|open)\b/g)].map((match) => match[0]).join('');
      try {
        const matches = base.includes(':scope') ? [ ...(root.matches(base) ? [root] : []), ...root.querySelectorAll(base) ] : [...document.querySelectorAll(base)];
        return matches.filter((node) => indexes.has(node)).map((node) => ({ nodeIndex: indexes.get(node), suffix }));
      } catch { return []; }
    }) }));
  }, { rootSelector, rules: sheets.matchingRules || [], elements: dom.elements }), timeoutMs, 'capture-css-matches-timeout'); }
  catch (error) { captureErrors.push({ stage: 'css-targets', code: error.code || 'capture-css-matches-unavailable' }); }
  const cssRules = rules.map((rule) => ({ selector: sanitizeCaptureText((rule.matchedSelectors || []).join(', ')), body: sanitizeCaptureCss(rule.body),
    conditions: (rule.conditions || []).map(sanitizeCaptureText), sheetUrl: sanitizeCaptureText(rule.sheetUrl),
    source: rule.source, matchedNodes: rule.matchedNodes }));
  const payload = { ...dom, viewport, identity, capturedAt: new Date().toISOString(), listeners, cssRules, captureErrors,
    stylesheetEvidence: { sheetCount: sheets.sheetCount, ruleCount: sheets.ruleCount, fetchFailureCount: sheets.fetchFailureCount,
      fetchFailures: sheets.fetchFailures, unreadableSheets: sheets.unreadableSheets } };
  // Defence in depth for nested JSON/text from page-controlled sources.
  const safePayload = JSON.parse(JSON.stringify(payload), (_key, value) => typeof value === 'string' ? sanitizeCaptureText(value) : value);
  const label = viewport.label === 'mobile' ? 'mobile' : 'pc';
  await fs.mkdir(directory, { recursive: true });
  const jsonPath = path.join(directory, `${label}.json`), htmlPath = path.join(directory, `${label}.html`), cssPath = path.join(directory, `${label}.css`);
  const cssText = cssRules.map((rule) => `${rule.conditions.map((condition) => `${condition} {`).join('\n')}\n${rule.selector} { ${rule.body} }\n${'}'.repeat(rule.conditions.length)}`).join('\n');
  await Promise.all([fs.writeFile(jsonPath, JSON.stringify(safePayload, null, 2)), fs.writeFile(htmlPath, safePayload.outerHTML), fs.writeFile(cssPath, cssText)]);
  return { viewport, status: captureErrors.length || sheets.unreadableSheets?.length ? 'partial' : 'captured',
    jsonPath, htmlPath, cssPath, elementCount: dom.elements.length, ruleCount: cssRules.length, captureErrors,
    listeners, fetchFailureCount: sheets.fetchFailureCount };
}
