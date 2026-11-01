import { markUniqueFrontInstance } from './front-instance-root.mjs';

export const DESIGN_CHECK_TYPES = Object.freeze([
  'color-default', 'color-scope', 'typography', 'module-width', 'height-fit',
  'text-truncation', 'image-ratio', 'overflow-threshold', 'search-box-per-field',
  'default-expand', 'selected-tag-behaviour', 'mobile-layout', 'manual',
]);

const TYPE_SET = new Set(DESIGN_CHECK_TYPES);
const NODE_ID = /^[0-9]+:[0-9]+$/;
const FILE_KEY = /^[A-Za-z0-9_-]+$/;

/** Canonical representation shared by CSS colors and the design-spec notation `#RRGGBB @N%`. */
export function normalizeDesignColor(value) {
  const text = String(value ?? '').trim().toLowerCase();
  let rgba;
  const withOpacity = text.match(/^#([0-9a-f]{6})\s*@\s*(\d+(?:\.\d+)?)%$/i);
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
  if (withOpacity) rgba = [0, 2, 4].map((index) => Number.parseInt(withOpacity[1].slice(index, index + 2), 16))
    .concat(Number(withOpacity[2]) / 100);
  else if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((part) => part + part).join('');
    rgba = [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16))
      .concat(digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1);
  } else if (rgb) {
    const parts = rgb[1].split(/[,/]/).map((part) => part.trim());
    if (parts.length < 3) return text.replace(/\s+/g, '');
    const channels = parts.slice(0, 3).map((part) => part.endsWith('%')
      ? Math.round(Number.parseFloat(part) * 2.55) : Math.round(Number.parseFloat(part)));
    const alphaText = parts[3];
    const alpha = alphaText === undefined ? 1 : alphaText.endsWith('%')
      ? Number.parseFloat(alphaText) / 100 : Number.parseFloat(alphaText);
    if (![...channels, alpha].every(Number.isFinite)) return text.replace(/\s+/g, '');
    rgba = [...channels, alpha];
  } else return text.replace(/\s+/g, '');
  return `rgba(${rgba.slice(0, 3).join(',')},${Number(rgba[3].toFixed(4))})`;
}

export function validateDesignSpec(spec, profileId = '(unknown)') {
  const errors = [];
  const add = (path, message) => errors.push({ profileId, path: `designSpec${path}`, message });
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return [{ profileId, path: 'designSpec', message: 'must be an object' }];
  if (!spec.source || typeof spec.source !== 'object' || Array.isArray(spec.source)) add('.source', 'must be an object');
  else {
    if (typeof spec.source.fileKey !== 'string' || !FILE_KEY.test(spec.source.fileKey)) add('.source.fileKey', 'must be a Figma file key, not a URL');
    if (typeof spec.source.nodeId !== 'string' || !NODE_ID.test(spec.source.nodeId)) add('.source.nodeId', 'must use numeric page:node form');
    if (Object.keys(spec.source).some((key) => !['fileKey', 'nodeId'].includes(key))) add('.source', 'may contain only fileKey and nodeId');
  }
  if (!Array.isArray(spec.requirements)) add('.requirements', 'must be an array');
  else {
    const ids = new Set();
    spec.requirements.forEach((item, index) => {
      const path = `.requirements[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add(path, 'must be an object'); return; }
      for (const key of ['id', 'checkType', 'sourceText', 'expected', 'checkStage', 'params']) {
        if (!Object.hasOwn(item, key)) add(`${path}.${key}`, 'is required');
      }
      if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) add(`${path}.id`, 'must be a lowercase identifier');
      else if (ids.has(item.id)) add(`${path}.id`, 'must be unique');
      else ids.add(item.id);
      if (!TYPE_SET.has(item.checkType)) add(`${path}.checkType`, `must be one of: ${DESIGN_CHECK_TYPES.join(', ')}`);
      if (typeof item.sourceText !== 'string' || !item.sourceText.trim()) add(`${path}.sourceText`, 'must be non-empty verbatim source text');
      if (!['editor', 'front', 'both'].includes(item.checkStage)) add(`${path}.checkStage`, 'must be editor, front, or both');
      if (!item.params || typeof item.params !== 'object' || Array.isArray(item.params)) add(`${path}.params`, 'must be an object');
      if (Object.keys(item).some((key) => !['id', 'checkType', 'sourceText', 'expected', 'checkStage', 'params'].includes(key))) add(path, 'contains an unknown property');
    });
  }
  const checkOverrides = (key, allowedStatus) => {
    if (spec[key] === undefined && key === 'scopeOverrides') return;
    if (!Array.isArray(spec[key])) { add(`.${key}`, 'must be an array'); return; }
    const requirementIds = new Set((spec.requirements || []).map((item) => item?.id));
    spec[key].forEach((item, index) => {
      const path = `.${key}[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add(path, 'must be an object'); return; }
      if (!requirementIds.has(item.requirementId)) add(`${path}.requirementId`, 'must reference an existing requirement');
      if (allowedStatus && item.status !== allowedStatus) add(`${path}.status`, `must be ${allowedStatus}`);
      if (key === 'overrides') {
        if (typeof item.reason !== 'string' || !item.reason.trim()) add(`${path}.reason`, 'must be non-empty');
        if (Object.keys(item).some((prop) => !['requirementId', 'status', 'reason'].includes(prop))) add(path, 'contains an unknown property');
      } else {
        for (const prop of ['sourceText', 'resolvedScope', 'reason']) if (typeof item[prop] !== 'string' || !item[prop].trim()) add(`${path}.${prop}`, 'must be non-empty');
        if (Object.keys(item).some((prop) => !['requirementId', 'sourceText', 'resolvedScope', 'reason'].includes(prop))) add(path, 'contains an unknown property');
      }
    });
  };
  checkOverrides('overrides', 'waived');
  checkOverrides('scopeOverrides');
  if (Object.keys(spec).some((key) => !['source', 'requirements', 'overrides', 'scopeOverrides'].includes(key))) add('', 'contains an unknown property');
  return errors;
}

export function validateDesignProfiles(profiles) {
  return profiles.flatMap(({ id, profile }) => profile.designSpec ? validateDesignSpec(profile.designSpec, id) : []);
}

function checkResult(requirement, status, { detail, actual, reason, classification, displayName, expected } = {}) {
  const waived = classification === 'known-exception';
  const machineCode = typeof reason?.code === 'string' && reason.code.trim() ? reason.code.trim()
    : status === 'na' ? 'design-check-not-applicable' : 'design-check-result';
  const humanReviewRequired = reason?.humanReviewRequired === true
    || ['scope-unmapped', 'front-checker-unavailable', 'unsupported-requirement-human-review',
      'design-typography-properties-unavailable', 'mapped-style-check-unavailable'].includes(machineCode);
  return { id: `design-${requirement.id}`, name: waived ? '已知例外' : displayName || requirement.sourceText,
    status, classification: classification || null,
    sourceText: requirement.sourceText, expected: expected ?? requirement.expected,
    ...(actual === undefined ? {} : { actual }), detail,
    reason: { stage: requirement.checkStage, checkType: requirement.checkType, ...reason, code: machineCode,
      ...(humanReviewRequired ? { humanReviewRequired: true } : {}),
      ...(status === 'na' && reason?.code === undefined ? { machineReason: 'No applicable automated oracle was available.' } : {}) } };
}

function overrideFor(spec, id) { return (spec?.overrides || []).find((entry) => entry.requirementId === id && entry.status === 'waived'); }
function scopeOverrideFor(spec, id) { return (spec?.scopeOverrides || []).find((entry) => entry.requirementId === id); }

export function checkDesignRequirementEditor(requirement, { profile, inventory = [] } = {}) {
  const override = overrideFor(profile?.designSpec, requirement.id);
  if (override) return checkResult(requirement, 'na', { classification: 'known-exception',
    detail: `已知例外：${override.reason}`, reason: { code: 'waived', reason: override.reason } });
  if (!['editor', 'both'].includes(requirement.checkStage)) return null;
  if (requirement.checkType !== 'module-width') return checkResult(requirement, 'na', {
    detail: '此设计要求尚无可重复的编辑器阶段 oracle。', reason: { code: 'editor-checker-unavailable' } });
  if (!requirement.expected?.expandable) return checkResult(requirement, 'na', {
    detail: '规范没有声明行展开要求。', reason: { code: 'not-applicable' } });
  const regions = inventory.filter((region) => region.type === 'rail:module-width');
  const radios = regions.flatMap((region) => (region.controls || []).filter((control) => control.type === 'radio'));
  const selected = radios.filter((control) => control.checked);
  const selectedLabel = selected.length === 1 ? String(selected[0].label || selected[0].value || '').trim() : null;
  const customWidth = selected.length === 1 && /自定义/i.test(selectedLabel || '')
    ? regions.flatMap((region) => region.controls || []).find((control) => control.type === 'text'
      && control.styleProperty === 'width')?.value
    : null;
  const defaultValue = selected.length !== 1 ? null : customWidth !== null && customWidth !== undefined && customWidth !== ''
    ? (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(String(customWidth).trim())
      ? `${Number.parseFloat(customWidth)}px` : String(customWidth).trim())
    : selectedLabel;
  const wanted = String(requirement.expected.default || '').trim();
  const exists = regions.length === 1 && radios.length > 0;
  const normalizeWidth = (value) => {
    const match = String(value ?? '').trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$/i);
    return match ? `${Number(match[1])}px` : String(value ?? '').trim().toLowerCase();
  };
  const pass = exists && selected.length === 1 && normalizeWidth(defaultValue) === normalizeWidth(wanted);
  return checkResult(requirement, pass ? 'pass' : 'fail', {
    detail: pass ? '模块宽度设置存在，默认宽度符合设计规范。' : '规范要求行展开；模块宽度设置必须存在且默认值须符合设计规范。',
    actual: { settingExists: exists, selectedCount: selected.length, selectedOption: selectedLabel, defaultValue },
    reason: { code: pass ? 'module-width-default-matched' : exists ? 'module-width-default-mismatch' : 'module-width-setting-missing' },
  });
}

function sourceTextTokens(text = '') {
  const normalized = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const semanticRemainder = normalized.replace(/产品名称|筛选标题|下拉占位|数值输入|选中项|产品分类|产品|分类|一级|子级|标题|按钮|筛选|文字|样式|分页/g, ' ');
  const tokens = new Set(semanticRemainder.match(/[a-z][a-z0-9_-]*|\d+(?:[/:.-]\d+)*|[\u3400-\u9fff]{2,}/g) || []);
  return [...tokens].filter((token) => token.length >= 2);
}

function rowsFromFrontCheck(check) {
  const rows = [];
  const add = (value) => {
    if (Array.isArray(value)) { for (const item of value) add(item); return; }
    if (!value || typeof value !== 'object') return;
    if (['fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'borderColor'].some((key) => value[key] !== undefined)) rows.push(value);
    for (const key of ['actual', 'elements', 'records', 'matchedElements']) if (value[key] !== undefined) add(value[key]);
  };
  add(check?.actual); add(check?.reason?.actual); add(check?.evidence); add(check?.reason?.evidence);
  return rows;
}

function mappedFrontCheck(requirement, frontChecks) {
  const ids = requirement.params?.styleCheckIds || (requirement.params?.styleCheckId ? [requirement.params.styleCheckId] : []);
  let found = ids.length
    ? ids.map((id) => frontChecks.find((item) => item.id === id || item.id === `bss-${id}`)).filter(Boolean) : [];
  if (!found.length) {
    // Reuse existing functional style observations by their visible text and
    // semantic role/structure evidence. The profile still owns explicit IDs
    // when available; this fallback never borrows another block's selectors.
    const tokens = sourceTextTokens(requirement.sourceText);
    const matches = frontChecks.filter((item) => {
      const rows = rowsFromFrontCheck(item);
      return rows.some((row) => {
        const label = String(row.label || row.text || row.accessibleName || '').toLowerCase();
        return tokens.length && tokens.some((token) => label.includes(token));
      });
    });
    if (matches.length === 1) found = matches;
  }
  if (!found.length && requirement.checkType === 'typography' && requirement.params?.styleCheckId) {
    const id = requirement.params.styleCheckId;
    found = frontChecks.filter((item) => item.id === id || item.id === `bss-${id}`);
  }
  if (!found.length) return null;
  const judged = found.filter((item) => ['pass', 'fail'].includes(item.status));
  if (!judged.length) return { status: 'na', reason: { code: 'mapped-style-check-not-asserted', statuses: found.map((item) => item.status) } };
  const observations = judged.flatMap((item) => {
    const rows = rowsFromFrontCheck(item);
    return rows.length ? rows.map((row) => ({ ...row, id: item.id, status: item.status }))
      : [{ id: item.id, status: item.status, expected: item.reason?.expected ?? item.expected,
        actual: item.reason?.actual ?? item.actual ?? item.evidence?.elements }];
  });
  return { status: judged.every((item) => item.status === 'pass') ? 'pass' : 'fail',
    actual: observations,
    reason: { code: 'profile-mapped-style-check', mappedCheckCount: ids.length, assertedCheckCount: judged.length } };
}

function normalizedFontSize(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`;
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

async function readInstanceColorSnapshot(page, rootSelector) {
  return page.evaluate(({ rootSelector }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return { rootCount: 0, styles: [] };
    const nodes = [root, ...root.querySelectorAll('*')];
    const properties = ['color', 'backgroundColor', 'borderColor', 'fill', 'stroke', 'outlineColor',
      'boxShadow', 'backgroundImage'];
    const readStyle = (node, pseudo = null) => {
      const style = getComputedStyle(node, pseudo);
      const svgPaint = node.namespaceURI === 'http://www.w3.org/2000/svg';
      return Object.fromEntries(properties.map((property) => [property,
        (property === 'fill' || property === 'stroke') && !svgPaint ? null : style[property] || null]));
    };
    return { rootCount: 1, styles: nodes.map((node) => ({ ...readStyle(node),
      before: readStyle(node, '::before'), after: readStyle(node, '::after') })) };
  }, { rootSelector });
}

function cssColors(value) {
  const text = String(value ?? '');
  const found = [];
  for (const match of text.matchAll(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[\da-f]{3,8}\b/gi)) found.push(match[0]);
  return found;
}

function opaqueColorKey(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const hex = text.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    let parts = hex[1];
    if (parts.length <= 4) parts = [...parts].map((part) => part + part).join('');
    return parts.slice(0, 6);
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%')
      ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
    const channels = parts.slice(0, 3).map((part) => part.endsWith('%')
      ? Math.round(Number.parseFloat(part) * 2.55) : Math.round(Number.parseFloat(part)));
    if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
    return channels.map((channel) => channel.toString(16).padStart(2, '0')).join('');
  }
  const hsl = text.match(/^hsla?\(([^)]+)\)$/i);
  if (hsl) {
    const parts = hsl[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%')
      ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
    const h = ((Number.parseFloat(parts[0]) % 360) + 360) % 360 / 360;
    const s = Number.parseFloat(parts[1]) / 100, l = Number.parseFloat(parts[2]) / 100;
    if (![h, s, l].every(Number.isFinite) || s < 0 || s > 1 || l < 0 || l > 1) return null;
    const hue = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const channels = s === 0 ? [l, l, l] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
    return channels.map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

export function countCssColorMatches(cssText, expected) {
  const expectedKey = opaqueColorKey(expected);
  if (!expectedKey) return 0;
  return cssColors(cssText).filter((candidate) => opaqueColorKey(candidate) === expectedKey).length;
}

function cssColorDeclarations(cssText, expected) {
  const expectedKey = opaqueColorKey(expected);
  if (!expectedKey) return [];
  const matches = [];
  // CSSOM is not available for cross-origin stylesheets. Parse ordinary and
  // conditionally nested rules from fetched text without evaluating the media.
  for (const rule of cssRuleEntries(cssText)) {
    const selector = rule.selector;
    const properties = [];
    for (const declaration of rule.body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 1) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).replace(/!important\s*$/i, '').trim();
      const colors = cssColors(value).filter((candidate) => opaqueColorKey(candidate) === expectedKey);
      if (colors.length) properties.push({ property, value: colors[0] });
    }
    if (properties.length) matches.push({ selector, selectors: splitCssSelectorList(selector), declarations: properties });
  }
  return matches;
}

function cssRuleEntries(cssText) {
  const entries = [];
  // Retain selectors nested in conditional at-rules (media/supports/layer).
  // This is intentionally a lightweight CSS rule reader, not a CSS evaluator.
  const visit = (text) => {
    let cursor = 0;
    while (cursor < text.length) {
      const open = text.indexOf('{', cursor);
      if (open < 0) break;
      const head = text.slice(cursor, open).trim();
      let depth = 1, close = open + 1;
      while (close < text.length && depth) {
        if (text[close] === '{') depth += 1;
        else if (text[close] === '}') depth -= 1;
        close += 1;
      }
      if (depth) break;
      const body = text.slice(open + 1, close - 1);
      if (head.startsWith('@')) visit(body);
      else if (head) entries.push({ selector: head, body });
      cursor = close;
    }
  };
  const source = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import\s+(?:url\(\s*)?(?:['"][^'"]+['"]|[^\s;)]+)\s*\)?[^;]*;/gi, '');
  visit(source);
  return entries;
}

function cssRuleSelectors(cssText) {
  return [...new Set(cssRuleEntries(cssText).flatMap((rule) => splitCssSelectorList(rule.selector)))];
}

function isFontOnlyStylesheetUrl(input) {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return /(^|[.-])fonts?([.-]|$)/.test(host)
      && (path === '/css' || path.startsWith('/css/') || path.endsWith('.css'));
  } catch { return false; }
}

function isOnlyFontOrImportMetadata(cssText) {
  const residual = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@font-face\s*\{(?:[^{}]|\{[^{}]*\})*\}/gi, '')
    .replace(/@(?:import\s+(?:url\(\s*)?(?:['"][^'"]+['"]|[^\s;)]+)\s*\)?|charset\s+[^;]+|namespace\s+[^;]+);/gi, '').trim();
  return residual.length === 0;
}

function countCssRules(cssText) {
  return cssRuleEntries(cssText).length;
}

function splitCssSelectorList(selectorList) {
  const selectors = [];
  let depth = 0, quote = '', start = 0;
  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    if (quote) { if (char === quote && selectorList[index - 1] !== '\\') quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) { selectors.push(selectorList.slice(start, index).trim()); start = index + 1; }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors.filter(Boolean);
}

export function sanitizeStylesheetUrl(input) {
  try {
    const url = new URL(input);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return '[invalid-stylesheet-url]'; }
}

function importUrls(cssText, baseUrl) {
  const urls = [];
  for (const match of String(cssText || '').matchAll(/@import\s+(?:url\(\s*)?(?:['"]([^'"]+)['"]|([^\s;)]+))\s*\)?[^;]*;/gi)) {
    try { urls.push(new URL(match[1] || match[2], baseUrl).href); } catch {}
  }
  return urls;
}

function stylesheetUrlAttempts(input) {
  try {
    const original = new URL(input);
    const urls = [original.href];
    if (original.protocol === 'https:') { const http = new URL(original.href); http.protocol = 'http:'; urls.push(http.href); }
    return [...new Set(urls)];
  } catch { return []; }
}

function safeStylesheetFailure(error) {
  return String(error?.message || error || 'stylesheet-fetch-failed')
    .replace(/https?:\/\/[^\s)'"<>]+/gi, (url) => sanitizeStylesheetUrl(url))
    .replace(/\b(cookie|authorization|password|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 180);
}

async function readStylesheetText({ page, href, fetchStylesheet, fetchNode = null }) {
  const attempts = [];
  const urls = stylesheetUrlAttempts(href);
  const contextRequest = page.context?.()?.request || page.request;
  for (const url of urls) {
    if (fetchStylesheet) {
      try { return { text: await fetchStylesheet(url), attempts, fetchedUrl: url }; }
      catch (error) { attempts.push({ method: 'injected-fetch', url: sanitizeStylesheetUrl(url), reason: safeStylesheetFailure(error) }); }
    } else if (contextRequest?.get) {
      try {
        const response = await contextRequest.get(url, { timeout: 15000 });
        if (!response.ok()) throw new Error(`http-${response.status()}`);
        return { text: await response.text(), attempts, fetchedUrl: url };
      } catch (error) { attempts.push({ method: 'page-context-request', url: sanitizeStylesheetUrl(url), reason: safeStylesheetFailure(error) }); }
    } else attempts.push({ method: 'page-context-request', url: sanitizeStylesheetUrl(url), reason: 'request-api-unavailable' });
  }
  for (const url of urls) {
    try {
      const nodeRequest = fetchNode || fetch;
      if (typeof nodeRequest !== 'function') throw new Error('node-fetch-unavailable');
      const response = await nodeRequest(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`http-${response.status}`);
      const text = typeof response.text === 'function' ? await response.text() : String(response.text ?? '');
      return { text, attempts, fetchedUrl: url };
    } catch (error) { attempts.push({ method: 'node-fetch', url: sanitizeStylesheetUrl(url), reason: safeStylesheetFailure(error) }); }
  }
  return { text: '', attempts, unavailable: true };
}

async function scopedCssMatches(page, rootSelector, declarations) {
  if (!declarations.length) return [];
  return page.evaluate(({ rootSelector, declarations }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return [];
    return declarations.flatMap((declaration) => {
      const matchedSelectors = declaration.selectors.filter((selector) => {
        const base = selector.replace(/::(?:before|after|marker|placeholder)\b/g, '')
          .replace(/:(?:hover|focus|focus-visible|active|checked|open)\b/g, '');
        try {
          if (root.matches(base) || root.querySelector(base)) return true;
          // Rules often use a framework wrapper class outside the settingId
          // root (and that class need not contain the block number). Match the
          // selector globally, then require the actual matched element to be
          // the selected instance root or one of its descendants.
          return [...document.querySelectorAll(base)].some((element) => element === root || root.contains(element));
        } catch { return false; }
      });
      return matchedSelectors.length ? [{ ...declaration, matchedSelectors }] : [];
    });
  }, { rootSelector, declarations });
}

export async function scanWrittenColorStylesheets({ page, rootSelector, settingsReport, fetchStylesheet, fetchNode } = {}) {
  const values = extractWrittenColorValues(settingsReport);
  if (!page || !rootSelector || !values.length) return { evidenceById: {}, sheetCount: 0, ruleCount: 0, fetchFailureCount: 0,
    fetchFailures: [], recoveredFetches: [], unreadableSheets: [], excludedSheets: [] };
  const inventory = await page.evaluate(({ rootSelector }) => {
    const links = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((item) => item.href);
    const preloads = [...document.querySelectorAll('link[rel~="preload"][as="style"][href]')].map((item) => item.href);
    const inline = [...document.querySelectorAll('style')].map((item) => item.textContent || '');
    const linkRules = [];
    const unreadableSheets = [];
    for (const sheet of [...document.styleSheets]) {
      const href = sheet.href;
      if (!href) continue;
      try {
        const rules = [...sheet.cssRules];
        const collect = (items) => items.flatMap((rule) => [rule.cssText,
          ...(rule.styleSheet ? collect(rule.styleSheet.cssRules) : [])]);
        linkRules.push({ href, text: collect(rules).join('\n') });
      } catch (error) { unreadableSheets.push({ href, reason: error?.name || 'cssom-unreadable' }); }
    }
    const inlineRules = [];
    const target = document.querySelector(rootSelector);
    const relativePath = (node) => {
      if (node === target) return ':scope';
      const parts = [];
      for (let current = node; current && current !== target; current = current.parentElement) {
        const siblings = current.parentElement ? [...current.parentElement.children].filter((el) => el.tagName === current.tagName) : [];
        parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
      }
      return `:scope > ${parts.join(' > ')}`;
    };
    if (target) for (const item of [target, ...target.querySelectorAll('*')]) {
      const style = item.getAttribute('style');
      if (style) inlineRules.push({ selector: relativePath(item), text: style });
    }
    return { links, preloads, inline, inlineRules, linkRules, unreadableSheets, baseUrl: location.href };
  }, { rootSelector });
  const sheets = [...inventory.inline.map((text, index) => ({ source: `inline-${index}`, url: inventory.baseUrl, text }))];
  for (const [index, item] of (inventory.inlineRules || []).entries())
    sheets.push({ source: `inline-attr-${index}`, url: inventory.baseUrl, text: `${item.selector}{${item.text}}` });
  const alreadyRead = new Map((inventory.linkRules || []).map((item) => [item.href, item.text]));
  const discovered = new Set([...(inventory.links || []), ...(inventory.preloads || []), ...alreadyRead.keys(),
    ...(inventory.unreadableSheets || []).map((sheet) => sheet.href)]);
  const imported = new Set();
  for (const text of inventory.inline || []) importUrls(text, inventory.baseUrl).forEach((url) => { discovered.add(url); imported.add(url); });
  for (const [href, text] of alreadyRead) importUrls(text, href).forEach((url) => { discovered.add(url); imported.add(url); });
  const fetchFailures = [];
  const recoveredFetches = [];
  const unreadableSheets = [];
  const excludedSheets = [];
  const visited = new Set();
  const queue = [...discovered];
  let fetchedIndex = 0;
  while (queue.length && visited.size < 200) {
    const href = queue.shift();
    if (visited.has(href)) continue;
    visited.add(href);
    const source = `external-${fetchedIndex++}`;
    let text;
    let fetchedUrl = href;
    if (alreadyRead.has(href)) text = alreadyRead.get(href);
    else {
      const fetched = await readStylesheetText({ page, href, fetchStylesheet, fetchNode });
      text = fetched.text;
      fetchedUrl = fetched.fetchedUrl || href;
      const cssomFailure = (inventory.unreadableSheets || []).find((sheet) => sheet.href === href);
      if (fetched.unavailable) {
        const entry = { url: sanitizeStylesheetUrl(href), reason: 'all-fetch-attempts-failed', attempts: fetched.attempts };
        fetchFailures.push(entry);
        if (isFontOnlyStylesheetUrl(href)) excludedSheets.push({ ...entry, relevance: 'excluded', exclusionReason: 'font-face-only-host' });
        else unreadableSheets.push({ ...entry, relevance: 'unknown-could-contain-instance-rule' });
      }
      else if (fetched.attempts.length || cssomFailure) {
        recoveredFetches.push({ url: sanitizeStylesheetUrl(href),
          recoveryReason: cssomFailure ? 'cssom-read-recovered-by-stylesheet-fetch' : 'transport-retry-succeeded',
          ...(cssomFailure ? { cssomReason: cssomFailure.reason } : {}), attempts: fetched.attempts });
      }
    }
    const url = sanitizeStylesheetUrl(href);
    sheets.push({ source, url, fetchedUrl: sanitizeStylesheetUrl(fetchedUrl), text });
    for (const importUrl of importUrls(text, href)) {
      imported.add(importUrl);
      if (!visited.has(importUrl)) queue.push(importUrl);
    }
    if (text && source.startsWith('external-')) {
      const selectors = cssRuleSelectors(text);
      if (!selectors.length) {
        if (isOnlyFontOrImportMetadata(text)) excludedSheets.push({ url: sanitizeStylesheetUrl(href), reason: 'font-or-import-only-css' });
        else unreadableSheets.push({ url: sanitizeStylesheetUrl(href), reason: 'stylesheet-rules-unparseable',
          relevance: 'unknown-could-contain-instance-rule' });
        continue;
      }
      const selectorMatches = await scopedCssMatches(page, rootSelector, selectors.map((selector) => ({
        selector, selectors: [selector], declarations: [{ property: '__selector_probe', value: '' }], source,
        sheetUrl: sanitizeStylesheetUrl(href), fetchedUrl: sanitizeStylesheetUrl(fetchedUrl),
      })));
      if (!selectorMatches.length) excludedSheets.push({ url: sanitizeStylesheetUrl(href), reason: 'no-selector-matches-instance' });
    }
  }
  const evidenceById = {};
  const externalSheets = sheets.filter((sheet) => sheet.source.startsWith('external-'));
  const inlineStyleSheets = sheets.filter((sheet) => sheet.source.startsWith('inline-') && !sheet.source.startsWith('inline-attr-'));
  const inlineAttributeSheets = sheets.filter((sheet) => sheet.source.startsWith('inline-attr-'));
  const externalRuleCount = externalSheets.reduce((sum, sheet) => sum + countCssRules(sheet.text), 0);
  const inlineStyleRuleCount = inlineStyleSheets.reduce((sum, sheet) => sum + countCssRules(sheet.text), 0);
  const inlineAttributeRuleCount = inlineAttributeSheets.reduce((sum, sheet) => sum + countCssRules(sheet.text), 0);
  for (const item of values) {
    const declarations = sheets.flatMap((sheet) => cssColorDeclarations(sheet.text, item.value)
      .map((declaration) => ({ ...declaration, source: sheet.source, sheetUrl: sheet.url, fetchedUrl: sheet.fetchedUrl })));
    const scoped = await scopedCssMatches(page, rootSelector, declarations);
    const serializedRules = scoped.map((rule) => ({ selector: rule.selector, matchedSelectors: rule.matchedSelectors,
      declarations: rule.declarations, properties: rule.declarations.map((entry) => entry.property), source: rule.source,
      sheetUrl: rule.sheetUrl, fetchedUrl: rule.fetchedUrl }));
    evidenceById[item.id] = { sheetCount: externalSheets.length,
      linkedStylesheetCount: (inventory.links || []).length, preloadStyleCount: (inventory.preloads || []).length,
      importedStylesheetCount: imported.size,
      inlineStyleTagCount: (inventory.inline || []).length, inlineAttributeCount: (inventory.inlineRules || []).length,
      ruleCount: externalRuleCount, inlineStyleRuleCount, inlineAttributeRuleCount,
      fetchFailureCount: fetchFailures.length, recoveredFetchCount: recoveredFetches.length,
      fetchFailures, recoveredFetches, unreadableSheetCount: unreadableSheets.length, unreadableSheets, excludedSheets,
      matchCount: scoped.length, rules: serializedRules };
  }
  return { evidenceById, sheetCount: externalSheets.length,
    ruleCount: externalRuleCount, inlineStyleRuleCount, inlineAttributeRuleCount,
    fetchFailureCount: fetchFailures.length, recoveredFetchCount: recoveredFetches.length,
    fetchFailures, recoveredFetches, unreadableSheets, excludedSheets,
    linkedStylesheetCount: (inventory.links || []).length, preloadStyleCount: (inventory.preloads || []).length,
    importedStylesheetCount: imported.size };
}

export async function runWrittenColorStylesheetSearch(options = {}) {
  const scan = await scanWrittenColorStylesheets(options);
  const settingsReport = options.settingsReport;
  return extractWrittenColorValues(settingsReport).flatMap((item) => {
    const evidence = scan.evidenceById[item.id];
    if (!evidence?.matchCount) return [];
    return [{ id: item.id, name: '本次写入颜色前台回读', status: 'record',
      classification: 'instance-scoped-css-only', expected: item.value,
      actual: { outcome: 'instance-scoped-css-only', ...evidence },
      detail: '颜色已保存，但只在匹配目标实例的 CSS 规则中出现；不计为通过。',
      reason: { stage: 'front', code: 'instance-scoped-css-only', expectedSource: 'run-report.currentValues' } }];
  });
}

export function countInstanceColorMatches(snapshot, expected) {
  const expectedColor = normalizeDesignColor(expected);
  const styles = snapshot?.styles || [];
  const colorProperties = ['color', 'backgroundColor', 'borderColor', 'fill', 'stroke', 'outlineColor'];
  const compositeProperties = ['boxShadow', 'backgroundImage'];
  return styles.filter((style) => [style, style?.before, style?.after].filter(Boolean).some((computed) =>
    colorProperties.some((property) => normalizeDesignColor(computed?.[property]) === expectedColor)
      || compositeProperties.some((property) => cssColors(computed?.[property])
        .some((color) => normalizeDesignColor(color) === expectedColor)))).length;
}

const TYPOGRAPHY_PROPERTIES = Object.freeze(['fontSize', 'fontWeight', 'lineHeight']);

function normalizedTypographyValue(property, value) {
  if (property === 'fontWeight') {
    const text = String(value ?? '').trim().toLowerCase();
    const named = text.match(/\b(extralight|ultralight|light|regular|normal|medium|semibold|demibold|bold|extrabold|black)\b/);
    if (named) return ({ ultralight: 200, extralight: 200, light: 300, regular: 400, normal: 400,
      medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, black: 900 })[named[1]];
    const numeric = Number.parseInt(text, 10);
    return Number.isFinite(numeric) ? numeric : text.replace(/\s+/g, '');
  }
  if (property === 'fontSize') return normalizedFontSize(value);
  const text = String(value ?? '').trim().toLowerCase();
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : text.replace(/\s+/g, '');
}

function compareTypographyRequirement(expectedInput, mappedActual) {
  const expected = Object.fromEntries(TYPOGRAPHY_PROPERTIES
    .filter((property) => expectedInput?.[property] !== undefined)
    .map((property) => [property, expectedInput[property]]));
  const actualRows = (mappedActual || []).flatMap((entry) => Array.isArray(entry.actual)
    ? entry.actual : entry.actual && typeof entry.actual === 'object' ? [entry.actual]
      : TYPOGRAPHY_PROPERTIES.some((property) => entry?.[property] !== undefined) ? [entry] : []);
  const actual = {};
  const missingProperties = [];
  let mismatch = false;
  for (const property of Object.keys(expected)) {
    const values = actualRows.map((row) => row?.[property]).filter((value) => value !== undefined && value !== null);
    actual[property] = values;
    if (!values.length) missingProperties.push(property);
    else if (!values.every((value) => normalizedTypographyValue(property, value)
      === normalizedTypographyValue(property, expected[property]))) mismatch = true;
  }
  if (mismatch) return { status: 'fail', expected, actual,
    reason: { code: 'design-typography-mismatch', propertiesChecked: Object.keys(expected) } };
  if (!Object.keys(expected).length || missingProperties.length) return { status: 'na', expected, actual,
    reason: { code: 'design-typography-properties-unavailable', missingProperties,
      propertiesChecked: Object.keys(actual).filter((key) => actual[key].length) } };
  return { status: 'pass', expected, actual,
    reason: { code: 'design-typography-matched', propertiesChecked: Object.keys(expected) } };
}

async function readTypographyByFeatures(page, rootSelector, requirement, profile) {
  if (!page || !rootSelector) return [];
  const tokens = sourceTextTokens(requirement.sourceText);
  const declaredIds = requirement.params?.styleCheckIds || (requirement.params?.styleCheckId ? [requirement.params.styleCheckId] : []);
  const learnedSelectors = (profile?.capabilities || []).flatMap((capability) => capability.styleSpec?.items || [])
    .filter((item) => declaredIds.includes(item.id) || declaredIds.includes(`bss-${item.id}`))
    .flatMap((item) => Object.values(item.learnedSelectors || {}).flatMap((entries) =>
      (Array.isArray(entries) ? entries : []).map((entry) => entry?.selector).filter(Boolean)));
  const featureRequirement = { ...requirement, params: { ...requirement.params,
    selectorCandidates: [...new Set([...(requirement.params?.selectorCandidates || []), ...learnedSelectors])] } };
  return page.evaluate(({ rootSelector, requirement, tokens }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return [];
    const params = requirement.params || {};
    const selectors = [...new Set([params.selector, params.learnedSelector, ...(params.selectorCandidates || [])].filter(Boolean))];
    let nodes = [];
    for (const selector of selectors) {
      try { nodes.push(...root.querySelectorAll(selector)); } catch {}
    }
    const semantic = /当前|选中|selected|current/i.test(requirement.sourceText || '');
    if (!selectors.length) nodes = [...root.querySelectorAll('*')].filter((node) => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') return false;
      const text = [node.innerText, node.value, node.getAttribute('placeholder'), node.getAttribute('aria-label'), node.title]
        .filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
      const textMatch = tokens.some((token) => text.includes(token));
      const roleMatch = params.role && (node.getAttribute('role') === params.role || node.tagName.toLowerCase() === params.role);
      const structureMatch = (params.structureTags || []).includes(node.tagName.toLowerCase());
      const stateMatch = semantic && (node.getAttribute('aria-current') === 'page'
        || node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-checked') === 'true');
      return textMatch || roleMatch || structureMatch || stateMatch;
    });
    return [...new Set(nodes)].filter((node) => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).slice(0, 100).map((node) => ({
      label: String(node.innerText || node.value || node.getAttribute('aria-label') || node.title || '').trim().slice(0, 80),
      role: node.getAttribute('role') || node.tagName.toLowerCase(),
      fontSize: getComputedStyle(node).fontSize,
      fontWeight: getComputedStyle(node).fontWeight,
      lineHeight: getComputedStyle(node).lineHeight,
    }));
  }, { rootSelector, requirement: featureRequirement, tokens });
}

function requirementResult(requirement, status, expected, actual, reasonCode, detail) {
  return checkResult(requirement, status, { expected, actual, detail,
    reason: { code: reasonCode, ...(status === 'na' ? { humanReviewRequired: true } : {}) } });
}

async function checkTextTruncation(requirement, page, rootSelector) {
  const selectorCandidates = [...new Set([requirement.params?.selector, ...(requirement.params?.selectorCandidates || [])].filter(Boolean))];
  const expectedLines = Number(requirement.expected?.maxLines);
  if (!Number.isFinite(expectedLines) || expectedLines < 1) return requirementResult(requirement, 'na', requirement.expected, null,
    'text-truncation-expected-lines-unavailable', '清单没有提供有效的最大行数，需人工复核。');
  const actual = await page.evaluate(({ rootSelector, selectorCandidates }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return { rootFound: false, elements: [] };
    let nodes = [];
    for (const selector of selectorCandidates) { try { nodes.push(...root.querySelectorAll(selector)); } catch {} }
    if (!selectorCandidates.length) nodes = [...root.querySelectorAll('*')].filter((node) => {
      const s = getComputedStyle(node);
      return Number.parseInt(s.webkitLineClamp, 10) > 0 || (s.overflow === 'hidden' && node.scrollHeight > node.clientHeight);
    });
    return { rootFound: true, elements: [...new Set(nodes)].filter((node) => {
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    }).map((node) => { const s = getComputedStyle(node); const lineClamp = Number.parseInt(s.webkitLineClamp, 10) || null; return { lineClamp,
      overflow: s.textOverflow, ellipsized: lineClamp > 0 || s.textOverflow === 'ellipsis', display: s.display, overflowY: s.overflowY,
      clipped: node.scrollHeight > node.clientHeight, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }; }) };
  }, { rootSelector, selectorCandidates });
  if (!actual.rootFound || !actual.elements.length) return requirementResult(requirement, 'na', requirement.expected, actual,
    'text-truncation-elements-unresolved', '目标文本元素无法从实例内可靠识别，需人工复核。');
  const pass = actual.elements.every((item) => item.lineClamp === expectedLines
    && (requirement.expected?.overflow !== 'ellipsis' || item.ellipsized));
  return requirementResult(requirement, pass ? 'pass' : 'fail', requirement.expected, actual,
    pass ? 'text-truncation-matched' : 'text-truncation-mismatch', pass ? '文本行数限制符合清单。' : '文本行数限制与清单不一致。');
}

async function checkImageRatio(requirement, page, rootSelector) {
  const ratioText = String(requirement.expected?.ratio || '');
  const parts = ratioText.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!parts) return requirementResult(requirement, 'na', requirement.expected, null,
    'image-ratio-expected-unavailable', '清单没有提供可解析的宽高比，需人工复核。');
  const expectedRatio = Number(parts[1]) / Number(parts[2]);
  const selectorCandidates = [...new Set([requirement.params?.selector, ...(requirement.params?.selectorCandidates || [])].filter(Boolean))];
  const actual = await page.evaluate(({ rootSelector, selectorCandidates }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return { rootFound: false, images: [] };
    let images = [];
    for (const selector of selectorCandidates) { try { images.push(...root.querySelectorAll(selector)); } catch {} }
    if (!selectorCandidates.length) images = [...root.querySelectorAll('img')];
    return { rootFound: true, images: [...new Set(images)].filter((img) => {
      const r = img.getBoundingClientRect(); return r.width > 0 && r.height > 0 && img.complete && img.naturalWidth > 0;
    }).map((img) => { const r = img.getBoundingClientRect(), s = getComputedStyle(img); return {
      ratio: r.width / r.height, objectPosition: s.objectPosition, centered: /center/i.test(s.objectPosition),
    }; }) };
  }, { rootSelector, selectorCandidates });
  if (!actual.rootFound || !actual.images.length) return requirementResult(requirement, 'na', requirement.expected, actual,
    'image-ratio-elements-unresolved', '实例中没有可测量的图片，需人工复核。');
  const tolerance = Number(requirement.params?.ratioTolerance ?? 0);
  const pass = actual.images.every((image) => Math.abs(image.ratio - expectedRatio) <= tolerance
    && (!requirement.expected.centered || image.centered));
  return requirementResult(requirement, pass ? 'pass' : 'fail', requirement.expected, actual,
    pass ? 'image-ratio-matched' : 'image-ratio-mismatch', pass ? '图片比例与清单一致。' : '图片比例或对齐与清单不一致。');
}

async function checkDefaultExpand(requirement, page, rootSelector) {
  const level = Number(requirement.expected?.level);
  if (!Number.isInteger(level) || level < 1) return requirementResult(requirement, 'na', requirement.expected, null,
    'default-expand-level-unavailable', '清单没有提供有效的默认展开层级，需人工复核。');
  const selectorCandidates = [...new Set([requirement.params?.selector, ...(requirement.params?.selectorCandidates || [])].filter(Boolean))];
  const actual = await page.evaluate(({ rootSelector, selectorCandidates }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return { rootFound: false, levels: [], collapsedLevels: [] };
    let nodes = [];
    for (const selector of selectorCandidates) { try { nodes.push(...root.querySelectorAll(selector)); } catch {} }
    if (!nodes.length) nodes = [...root.querySelectorAll('[aria-level],[aria-expanded],details')];
    nodes = [...new Set(nodes)].filter((node) => { const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; });
    const levelOf = (node) => {
      const raw = node.getAttribute('aria-level');
      if (raw) return Number(raw);
      let depth = 1, parent = node.parentElement;
      while (parent && parent !== root) { if (parent.matches('[role="treeitem"],li,details')) depth += 1; parent = parent.parentElement; }
      return depth;
    };
    const levels = nodes.map(levelOf).filter(Number.isFinite);
    const collapsedLevels = nodes.filter((node) => node.getAttribute('aria-expanded') === 'false'
      || (node.tagName.toLowerCase() === 'details' && !node.open)).map(levelOf).filter(Number.isFinite);
    return { rootFound: true, levels, maxVisibleLevel: levels.length ? Math.max(...levels) : null,
      collapsedLevels, collapsedLevelCount: collapsedLevels.length };
  }, { rootSelector, selectorCandidates });
  if (!actual.rootFound || actual.maxVisibleLevel === null) return requirementResult(requirement, 'na', requirement.expected, actual,
    'default-expand-hierarchy-unresolved', '实例中没有可读取的层级结构，需人工复核。');
  const collapsedLevel = Number(requirement.expected?.collapsedLevel);
  const collapsedMatches = !Number.isInteger(collapsedLevel) || actual.collapsedLevels?.includes(collapsedLevel);
  const pass = actual.maxVisibleLevel === level && collapsedMatches;
  return requirementResult(requirement, pass ? 'pass' : 'fail', requirement.expected, actual,
    pass ? 'default-expand-level-matched' : 'default-expand-level-mismatch', pass ? '默认展开层级符合清单。' : '默认展开层级与清单不一致。');
}

async function checkMobileLayout(requirement, page, rootSelector) {
  const expected = requirement.expected || {};
  const supported = ['visible', 'display', 'flexDirection', 'columns', 'width', 'maxWidth', 'fontSize', 'fontWeight', 'lineHeight']
    .filter((key) => expected[key] !== undefined);
  if (!supported.length) return requirementResult(requirement, 'na', expected, null,
    'mobile-layout-expected-unstructured', '移动端要求没有可比较的结构化值，需人工复核。');
  const params = requirement.params || {};
  const selectorCandidates = [...new Set([params.selector, ...(params.selectorCandidates || [])].filter(Boolean))];
  const actual = await page.evaluate(({ rootSelector, selectorCandidates, params }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return { rootFound: false, elements: [] };
    let nodes = [];
    for (const selector of selectorCandidates) { try { nodes.push(...root.querySelectorAll(selector)); } catch {} }
    if (!nodes.length && params.role) {
      try { nodes = [...root.querySelectorAll(`[role="${CSS.escape(params.role)}"]`)]; } catch {}
    }
    if (!nodes.length && params.structureTags?.length) {
      for (const tag of params.structureTags) { try { nodes.push(...root.querySelectorAll(tag)); } catch {} }
    }
    return { rootFound: true, elements: [...new Set(nodes)].map((node) => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return { visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        display: style.display, flexDirection: style.flexDirection,
        columns: style.display.includes('grid') ? style.gridTemplateColumns.split(/\\s+/).length : null,
        width: rect.width, maxWidth: style.maxWidth, fontSize: style.fontSize, fontWeight: style.fontWeight,
        lineHeight: style.lineHeight };
    }) };
  }, { rootSelector, selectorCandidates, params });
  if (!actual.rootFound || !actual.elements.length) return requirementResult(requirement, 'na', expected, actual,
    'mobile-layout-scope-unresolved', '无法在目标实例内唯一建立清单要求的移动端范围，需人工复核。');
  const pass = actual.elements.every((row) => supported.every((key) => {
    if (key === 'columns') return row.columns === Number(expected.columns);
    if (key === 'width' || key === 'maxWidth') return normalizedTypographyValue('fontSize', row[key]) === normalizedTypographyValue('fontSize', expected[key]);
    if (key === 'fontWeight') return normalizedTypographyValue(key, row[key]) === normalizedTypographyValue(key, expected[key]);
    if (key === 'fontSize') return normalizedTypographyValue(key, row[key]) === normalizedTypographyValue(key, expected[key]);
    if (key === 'lineHeight') return normalizedTypographyValue(key, row[key]) === normalizedTypographyValue(key, expected[key]);
    return String(row[key]) === String(expected[key]);
  }));
  return requirementResult(requirement, pass ? 'pass' : 'fail', expected, actual,
    pass ? 'mobile-layout-matched' : 'mobile-layout-mismatch', pass ? '移动端布局符合清单。' : '移动端布局与清单不一致。');
}

export async function checkDesignRequirementFront(requirement, { profile, page, rootSelector, frontChecks = [], settingsReport = null } = {}) {
  const override = overrideFor(profile?.designSpec, requirement.id);
  if (override) return checkResult(requirement, 'na', { classification: 'known-exception',
    detail: `已知例外：${override.reason}`, reason: { code: 'waived', reason: override.reason } });
  if (!['front', 'both'].includes(requirement.checkStage)) return null;
  if (requirement.checkType === 'color-scope' || requirement.checkType === 'typography') {
    const scopeOverride = requirement.checkType === 'color-scope' ? scopeOverrideFor(profile?.designSpec, requirement.id) : null;
    let mapped = mappedFrontCheck(requirement, frontChecks);
    const mappedHasTypography = mapped?.actual?.some?.((row) => TYPOGRAPHY_PROPERTIES.some((property) => row?.[property] != null));
    if (requirement.checkType === 'typography' && (!mapped || mapped.status === 'na' || !mappedHasTypography) && page && rootSelector) {
      const observations = await readTypographyByFeatures(page, rootSelector, requirement, profile).catch(() => []);
      if (observations.length) mapped = { status: 'pass', actual: observations,
        reason: { code: 'instance-text-role-or-learned-scope', matchedCount: observations.length } };
    }
    if (!mapped) return checkResult(requirement, 'na', { displayName: scopeOverride?.resolvedScope,
      detail: '规范范围尚未映射到本区块的功能检查。',
      reason: { code: 'scope-unmapped', ...(scopeOverride ? { resolvedScope: scopeOverride.resolvedScope,
        mappingReason: scopeOverride.reason } : {}) } });
    let status = mapped.status;
    let actual = mapped.actual;
    let expected = requirement.expected;
    let reason = mapped.reason;
    if (requirement.checkType === 'typography') {
      const typography = compareTypographyRequirement(requirement.expected, mapped.actual);
      status = typography.status;
      actual = { ...typography.actual, functionalChecks: mapped.actual };
      expected = typography.expected;
      reason = { ...typography.reason, expectedSource: 'designSpec.requirement.expected typography properties',
        mappedCheck: mapped.reason };
    }
    return checkResult(requirement, status, { displayName: scopeOverride?.resolvedScope, expected,
      detail: status === 'na'
      ? '本区块没有可执行的对应样式结果，需人工复核。' : requirement.checkType === 'typography' && requirement.expected?.fontSize
        ? status === 'pass' ? '前台字体大小符合设计规范。' : '前台字体大小与设计规范不一致。'
        : '按本区块画像中映射的功能样式检查执行。',
    actual, reason: { ...reason, ...(scopeOverride ? { resolvedScope: scopeOverride.resolvedScope,
      mappingReason: scopeOverride.reason } : {}) } });
  }
  if (requirement.checkType === 'color-default') {
    if (!page || !rootSelector) return checkResult(requirement, 'na', { detail: '目标区块实例根节点不可用。', reason: { code: 'instance-root-unavailable' } });
    const defaultColor = requirement.expected?.value;
    const written = writtenPaletteColorValues(settingsReport);
    const differentWrittenColors = written.filter((item) => normalizeDesignColor(item.value) !== normalizeDesignColor(defaultColor));
    if (differentWrittenColors.length) return checkResult(requirement, 'na', {
      detail: '本次运行改写了配色；默认值检查不适用于当前实例。',
      reason: { code: 'palette-default-overridden-this-run', expectedSource: 'designSpec.requirement.expected.value',
        writtenValueCount: differentWrittenColors.length, writtenValueCheckIds: differentWrittenColors.map((item) => item.id),
        writtenValueVerifiedBy: 'run-written-color-presence' },
    });
    const snapshot = await readInstanceColorSnapshot(page, rootSelector);
    const actual = { rootCount: snapshot.rootCount, elementCount: snapshot.styles.length,
      matches: countInstanceColorMatches(snapshot, defaultColor) };
    const pass = actual.rootCount === 1 && actual.matches > 0;
    return checkResult(requirement, pass ? 'pass' : 'fail', { detail: pass
      ? '目标区块实例中至少一个元素呈现规范颜色。' : '目标区块实例中没有元素呈现规范颜色。', actual,
    reason: { code: pass ? 'expected-color-found-in-instance' : 'expected-color-not-found-in-instance',
      expectedSource: 'designSpec.requirement.expected.value', propertiesChecked: ['color', 'backgroundColor', 'borderColor'] } });
  }
  if (!page || !rootSelector) return checkResult(requirement, 'na', { detail: '目标区块实例根节点不可用。', reason: { code: 'instance-root-unavailable' } });
  if (requirement.checkType === 'text-truncation') return checkTextTruncation(requirement, page, rootSelector);
  if (requirement.checkType === 'image-ratio') return checkImageRatio(requirement, page, rootSelector);
  if (requirement.checkType === 'default-expand') return checkDefaultExpand(requirement, page, rootSelector);
  if (requirement.checkType === 'mobile-layout') return checkMobileLayout(requirement, page, rootSelector);
  return checkResult(requirement, 'na', { detail: '该检查类型尚无安全的自动化 oracle。',
    reason: { code: 'unsupported-requirement-human-review', checkType: requirement.checkType, humanReviewRequired: true } });
}

export function extractWrittenColorValues(settingsReport) {
  const values = settingsReport?.block?.currentValues || settingsReport?.currentValues || [];
  const colors = [];
  const seen = new Set();
  for (const item of values) {
    const isColorRegion = item.region === 'right-rail-color' || item.section === '区块配色'
      || String(item.controlIdentity || '').startsWith('rail:color-scheme:');
    if (!isColorRegion || typeof item.value !== 'string') continue;
    if (!/^(?:#[0-9a-f]{3,8}(?:\s*@\s*\d+(?:\.\d+)?%)?|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\))$/i.test(item.value.trim())) continue;
    const key = item.value.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    colors.push({ id: `written-color-${colors.length + 1}`, value: item.value.trim(), controlIndex: item.controlIndex ?? null });
  }
  return colors;
}

function writtenPaletteColorValues(settingsReport) {
  const paletteValues = extractWrittenColorValues(settingsReport);
  const checkValues = (settingsReport?.checks || []).filter((check) => ['pass', 'fail'].includes(check.status)
      && check.setting && check.value !== undefined && check.expected !== undefined)
    .filter((check) => normalizeDesignColor(check.value) && normalizeDesignColor(check.expected)
      && /^rgba?\(/.test(normalizeDesignColor(check.value)) && /^rgba?\(/.test(normalizeDesignColor(check.expected)))
    .filter((check) => paletteValues.some((item) => normalizeDesignColor(item.value) === normalizeDesignColor(check.value)))
    .map((check) => ({ value: check.value, expected: check.expected }));
  return checkValues;
}

export async function runWrittenColorFrontChecks(options = {}) {
  const { page, rootSelector, settingsReport } = options;
  const values = extractWrittenColorValues(settingsReport);
  if (!values.length || !page || !rootSelector) return runWrittenColorFrontChecksForRoot(options);

  let effectiveRootSelector = rootSelector;
  let recoveryMarker = null;
  let rootCount = null;
  try {
    const root = page.locator(rootSelector);
    if (typeof root?.count === 'function') rootCount = await root.count();
  } catch {}
  if (rootCount === 0 && settingsReport?.blockId && settingsReport?.block?.settingId) {
    try {
      recoveryMarker = await markUniqueFrontInstance(page, { blockId: settingsReport.blockId,
        settingId: settingsReport.block.settingId, markerValue: `written-color-${Date.now()}` });
      effectiveRootSelector = recoveryMarker.selector;
      rootCount = recoveryMarker.rootCount === 1 ? 1 : recoveryMarker.rootCount;
    } catch { /* returned as a machine-readable inconclusive result below */ }
  }
  if (rootCount !== null && rootCount !== 1) {
    try { await recoveryMarker?.clear(); } catch {}
    const code = rootCount === 0 ? 'instance-root-missing' : 'instance-root-not-unique';
    return values.map((item) => ({ id: item.id, name: '本次写入颜色前台回读', status: 'record',
      classification: code, expected: item.value,
      actual: { rootCount, stylesheetScan: 'not-run', stateExercise: 'not-run' },
      detail: rootCount === 0 ? '目标区块实例根节点不可用，颜色结果无法判为 absent。'
        : '目标区块实例根节点不唯一，颜色结果无法判定。',
      reason: { stage: 'front', code, expectedSource: 'run-report.currentValues', controlIndex: item.controlIndex } }));
  }
  try { return await runWrittenColorFrontChecksForRoot({ ...options, rootSelector: effectiveRootSelector }); }
  finally { try { await recoveryMarker?.clear(); } catch {} }
}

async function runWrittenColorFrontChecksForRoot({ page, rootSelector, settingsReport, includeStylesheets = true,
  fetchStylesheet, fetchNode, stateExercise = false }) {
  const values = extractWrittenColorValues(settingsReport);
  if (!values.length) return [{ id: 'written-color-presence', name: '本次写入颜色前台回读', status: 'na',
    detail: '运行报告没有可验证的颜色设置当前值。', reason: { stage: 'front', code: 'no-written-color-values' } }];
  if (!page || !rootSelector) return values.map((item) => ({ id: item.id, name: '本次写入颜色前台回读', status: 'na',
    expected: item.value, detail: '目标区块前台实例不可达。', reason: { stage: 'front', code: 'instance-root-unavailable',
      expectedSource: 'run-report.currentValues', controlIndex: item.controlIndex } }));
  const checks = [];
  const emptyExerciseCounts = { eligibleCandidates: 0, attempted: 0, opened: 0, restored: 0, toggleCandidates: 0, togglesOpened: 0,
    tabCandidates: 0, tabsSelected: 0, detailsCandidates: 0, detailsOpened: 0 };
  const stateEvidence = stateExercise
    ? await exerciseWrittenColorStates(page, rootSelector, values).catch((error) => ({ states: [], candidateCount: 0,
      disclosureCount: 0, exerciseCounts: emptyExerciseCounts, revealed: {}, error: { class: error?.name || 'Error', code: 'state-exercise-unavailable' } }))
    : { states: [], candidateCount: 0, disclosureCount: 0, exerciseCounts: emptyExerciseCounts, revealed: {} };
  // Fetch/parse linked CSS before assigning an absent verdict. Cross-origin
  // CSSOM failures are retried through the page context's request client.
  const stylesheetScan = includeStylesheets
    ? await scanWrittenColorStylesheets({ page, rootSelector, settingsReport, fetchStylesheet, fetchNode })
    : { evidenceById: {}, sheetCount: 0, ruleCount: 0, fetchFailureCount: 0, fetchFailures: [], unreadableSheets: [] };
  for (const item of values) {
    const snapshot = await readInstanceColorSnapshot(page, rootSelector);
    const stateMatch = stateEvidence.revealed[item.id];
    const matches = countInstanceColorMatches(snapshot, item.value);
    const cssEvidence = stylesheetScan.evidenceById[item.id] || { sheetCount: stylesheetScan.sheetCount,
      ruleCount: stylesheetScan.ruleCount, fetchFailureCount: stylesheetScan.fetchFailureCount,
      recoveredFetchCount: stylesheetScan.recoveredFetchCount || 0,
      unreadableSheetCount: stylesheetScan.unreadableSheets?.length || 0,
      linkedStylesheetCount: stylesheetScan.linkedStylesheetCount || 0,
      preloadStyleCount: stylesheetScan.preloadStyleCount || 0,
      importedStylesheetCount: stylesheetScan.importedStylesheetCount || 0,
      inlineStyleRuleCount: stylesheetScan.inlineStyleRuleCount || 0,
      inlineAttributeRuleCount: stylesheetScan.inlineAttributeRuleCount || 0,
      fetchFailures: stylesheetScan.fetchFailures || [], unreadableSheets: stylesheetScan.unreadableSheets || [],
      recoveredFetches: stylesheetScan.recoveredFetches || [], excludedSheets: stylesheetScan.excludedSheets || [],
      matchCount: 0, rules: [] };
    const foundOnElement = snapshot.rootCount === 1 && (matches > 0 || Boolean(stateMatch));
    const cssOnly = !foundOnElement && cssEvidence.matchCount > 0;
    // A terminal fetch failure matters only while the sheet could still hold a
    // selector for this instance. Successfully fetched non-matching sheets and
    // known font-only resources are explicitly excluded from the color oracle.
    const stylesheetIncomplete = cssEvidence.unreadableSheetCount > 0;
    const outcome = snapshot.rootCount !== 1 ? 'instance-root-missing'
      : foundOnElement ? 'found-on-element' : cssOnly ? 'instance-scoped-css-only'
      : stylesheetIncomplete ? 'inconclusive-stylesheet-unavailable' : 'absent';
    const actual = { rootCount: snapshot.rootCount, elementCount: snapshot.styles.length,
      matches: matches || stateMatch?.matches || 0,
      stylesheetEvidence: { sheetCount: cssEvidence.sheetCount, ruleCount: cssEvidence.ruleCount,
        fetchFailureCount: cssEvidence.fetchFailureCount, recoveredFetchCount: cssEvidence.recoveredFetchCount || 0,
        matchCount: cssEvidence.matchCount,
        unreadableSheetCount: cssEvidence.unreadableSheetCount,
        linkedStylesheetCount: cssEvidence.linkedStylesheetCount || 0,
        preloadStyleCount: cssEvidence.preloadStyleCount || 0,
        importedStylesheetCount: cssEvidence.importedStylesheetCount || 0,
        inlineStyleRuleCount: cssEvidence.inlineStyleRuleCount || 0,
        inlineAttributeRuleCount: cssEvidence.inlineAttributeRuleCount || 0,
        inlineStyleTagCount: cssEvidence.inlineStyleTagCount || 0,
        inlineAttributeCount: cssEvidence.inlineAttributeCount || 0,
        fetchFailures: cssEvidence.fetchFailures || [], unreadableSheets: cssEvidence.unreadableSheets || [],
        recoveredFetches: cssEvidence.recoveredFetches || [], excludedSheets: cssEvidence.excludedSheets || [],
        ...(cssEvidence.matchCount ? { rules: cssEvidence.rules } : {}) },
      stateExercise: { enabled: Boolean(stateExercise), states: stateEvidence.states,
        candidateCount: stateEvidence.candidateCount, disclosureCount: stateEvidence.disclosureCount,
        exerciseCounts: stateEvidence.exerciseCounts || { eligibleCandidates: 0, attempted: 0, opened: 0, restored: 0,
          toggleCandidates: 0, togglesOpened: 0, tabCandidates: 0, tabsSelected: 0,
          detailsCandidates: stateEvidence.disclosureCount || 0, detailsOpened: 0 },
        revealedBy: stateMatch?.state || null,
        ...(stateEvidence.error ? { error: stateEvidence.error } : {}) } };
    checks.push({ id: item.id, name: '本次写入颜色前台回读', status: outcome === 'found-on-element' ? 'pass'
      : ['instance-scoped-css-only', 'inconclusive-stylesheet-unavailable', 'instance-root-missing'].includes(outcome) ? 'record' : 'fail',
      classification: outcome, expected: item.value, actual,
      detail: outcome === 'found-on-element' ? '目标区块内存在呈现本次写入颜色的元素。'
        : outcome === 'instance-scoped-css-only' ? '已保存的颜色只出现在目标实例相关 CSS 规则中，未在计算样式中呈现。'
          : outcome === 'inconclusive-stylesheet-unavailable' ? '样式表未能完整读取，颜色结果无法判为 absent。'
            : outcome === 'instance-root-missing' ? '目标区块实例根节点不可用，颜色结果无法判为 absent。'
              : '已保存的颜色未在目标实例前台呈现。',
      reason: { stage: 'front', code: outcome,
        expectedSource: 'run-report.currentValues', controlIndex: item.controlIndex,
        propertiesChecked: ['color', 'backgroundColor', 'borderColor', 'fill', 'stroke', 'outlineColor', 'boxShadow',
          'backgroundImage', '::before', '::after'],
        ...(stateMatch ? { revealedByState: stateMatch.state } : {}) } });
  }
  return checks;
}

export function isSafeStateExerciseTarget(info = {}) {
  return info.visible === true && info.tag !== 'a' && info.hasHref !== true
    && info.insideForm !== true && info.submitControl !== true
    && Boolean(info.hasExplicitToggle || info.semantic || info.nativeButton || info.pointerAction || info.hasClickHandler);
}

export async function exerciseWrittenColorStates(page, rootSelector, values, { maxElements = 200 } = {}) {
  const root = page.locator(rootSelector);
  const candidates = root.locator('*');
  const count = Math.min(await candidates.count(), maxElements);
  const revealed = {};
  const states = new Set();
  const exerciseCounts = { eligibleCandidates: 0, attempted: 0, opened: 0, restored: 0, toggleCandidates: 0, togglesOpened: 0,
    tabCandidates: 0, tabsSelected: 0, detailsCandidates: 0, detailsOpened: 0 };
  const scan = async (state) => {
    const snapshot = await readInstanceColorSnapshot(page, rootSelector);
    for (const value of values) {
      const matches = countInstanceColorMatches(snapshot, value.value);
      if (!revealed[value.id] && matches > 0) revealed[value.id] = { state, matches };
    }
  };
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    try { await candidate.hover({ timeout: 1500 }); states.add('hover'); await scan('hover'); } catch {}
    try { await candidate.focus({ timeout: 1500 }); states.add('focus'); await scan('focus'); } catch {}
    try {
      const tagName = await candidate.evaluate((element) => element.tagName);
      if (String(tagName).toUpperCase() === 'SELECT') {
        exerciseCounts.attempted += 1;
        const opened = await candidate.evaluate((element) => {
          if (typeof element.showPicker !== 'function') return false;
          element.showPicker();
          return true;
        });
        if (!opened) continue;
        exerciseCounts.opened += 1;
        states.add('select-open');
        await scan('select-open');
        await candidate.press('Escape', { timeout: 1000 });
        exerciseCounts.restored += 1;
      }
    } catch {}
    try { await page.mouse?.move(0, 0); } catch {}
  }

  // Open only controls rooted in this instance. Never activate links, submit
  // controls, or anything inside a form. Pointer-only elements are eligible
  // only when they cannot navigate or submit.
  const stateControls = root.locator('*');
  const stateCount = Math.min(await stateControls.count(), maxElements);
  const selectedTabs = [];
  for (let index = 0; index < stateCount; index += 1) {
    const control = stateControls.nth(index);
    let info;
    try { info = await control.evaluate((element) => {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role');
      const type = element.getAttribute('type');
      const insideForm = Boolean(element.closest('form') || element.form);
      const isTab = role === 'tab';
      const hasExplicitToggle = element.hasAttribute('aria-expanded') || element.hasAttribute('aria-haspopup');
      const semantic = ['button', 'tab', 'combobox'].includes(role);
      const nativeButton = tag === 'button' && !['submit', 'reset'].includes(type) && !insideForm;
      const pointerAction = getComputedStyle(element).cursor === 'pointer';
      const hasClickHandler = typeof element.onclick === 'function' || element.hasAttribute('onclick');
      const hiddenSiblingIndexes = [...(element.parentElement?.children || [])].map((sibling, index) => ({ sibling, index }))
        .filter(({ sibling }) => {
        if (sibling === element) return false;
        const siblingStyle = getComputedStyle(sibling);
        return sibling.hidden || sibling.getAttribute('aria-hidden') === 'true'
          || siblingStyle.display === 'none' || siblingStyle.visibility === 'hidden';
      }).map(({ index }) => index);
      const submitControl = (tag === 'button' || tag === 'input') && ['submit', 'reset', 'image'].includes(type);
      const style = getComputedStyle(element);
      const visible = element.getClientRects().length > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
      return { tag, visible, hasHref: element.hasAttribute('href'), insideForm, submitControl,
        hasExplicitToggle, semantic, nativeButton, hasClickHandler, hiddenSiblingIndexes, isTab, isSelect: tag === 'select',
        isDetails: tag === 'details' || tag === 'summary', pointerAction,
        expanded: element.getAttribute('aria-expanded'), hasPopup: element.hasAttribute('aria-haspopup'),
        selected: element.getAttribute('aria-selected'), type };
    }); } catch { continue; }
    info.safe = isSafeStateExerciseTarget(info);
    if (!info.safe) continue;
    exerciseCounts.eligibleCandidates += 1;
    if (info.isSelect || info.isDetails) continue; // handled without choosing/changing a value below
    if (info.isTab) {
      exerciseCounts.tabCandidates += 1;
      if (info.selected === 'true') { selectedTabs.push(control); continue; }
      try {
        exerciseCounts.attempted += 1;
        await control.click({ timeout: 1500 });
        exerciseCounts.opened += 1;
        states.add('tab-selected'); exerciseCounts.tabsSelected += 1;
        await scan('tab-selected');
      } catch {}
      continue;
    }
    exerciseCounts.toggleCandidates += 1;
    try {
      if (info.expanded === 'true') { await scan('category-expanded'); continue; }
      exerciseCounts.attempted += 1;
      await control.click({ timeout: 1500 });
      const expanded = await control.getAttribute('aria-expanded');
      const siblingPanelOpened = (info.hiddenSiblingIndexes || []).length > 0 && await control.evaluate((element, indexes) => {
        const siblings = [...(element.parentElement?.children || [])];
        return indexes.some((index) => {
          const sibling = siblings[index];
          if (!sibling) return false;
          const style = getComputedStyle(sibling);
          return !sibling.hidden && sibling.getAttribute('aria-hidden') !== 'true'
            && style.display !== 'none' && style.visibility !== 'hidden';
        });
      }, info.hiddenSiblingIndexes).catch(() => false);
      if (expanded === 'true' || info.expanded !== expanded || siblingPanelOpened) {
        exerciseCounts.opened += 1;
        states.add('category-expanded'); exerciseCounts.togglesOpened += 1;
        await scan('category-expanded');
        if (expanded === 'true' || siblingPanelOpened) await control.click({ timeout: 1500 });
        else await control.press('Escape', { timeout: 1000 });
        const after = await control.getAttribute('aria-expanded');
        const panelRestored = siblingPanelOpened ? await control.evaluate((element, indexes) => {
          const siblings = [...(element.parentElement?.children || [])];
          return indexes.every((index) => {
            const sibling = siblings[index];
            if (!sibling) return true;
            const style = getComputedStyle(sibling);
            return sibling.hidden || sibling.getAttribute('aria-hidden') === 'true'
              || style.display === 'none' || style.visibility === 'hidden';
          });
        }, info.hiddenSiblingIndexes).catch(() => false) : true;
        if (panelRestored && (after === info.expanded || (info.expanded === null && after === null))) exerciseCounts.restored += 1;
      }
    } catch {}
  }
  for (const selected of selectedTabs) try {
    await selected.click({ timeout: 1500 });
    exerciseCounts.restored += 1;
  } catch {}

  const details = root.locator('details');
  const detailsCount = Math.min(await details.count(), maxElements);
  exerciseCounts.detailsCandidates = detailsCount;
  for (let index = 0; index < detailsCount; index += 1) {
    const item = details.nth(index);
    try {
      const state = await item.evaluate((element) => ({ open: element.open,
        visible: getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden' }));
      if (!state.visible || state.open) continue;
      await item.evaluate((element) => { element.open = true; });
      states.add('disclosure-open');
      exerciseCounts.detailsOpened += 1;
      exerciseCounts.attempted += 1;
      exerciseCounts.opened += 1;
      await scan('disclosure-open');
      await item.evaluate((element) => { element.open = false; });
      if (!(await item.evaluate((element) => element.open))) exerciseCounts.restored += 1;
    } catch { try { await item.evaluate((element) => { element.open = false; }); } catch {} }
  }
  try { await page.evaluate(() => document.activeElement?.blur?.()); } catch {}
  return { states: [...states], candidateCount: count, disclosureCount: detailsCount, exerciseCounts, revealed };
}

export async function runDesignSpecEditorChecks(profile, inventory) {
  return (profile?.designSpec?.requirements || []).map((requirement) =>
    checkDesignRequirementEditor(requirement, { profile, inventory })).filter(Boolean);
}

export async function runDesignSpecFrontChecks(profile, context) {
  const viewportLabel = context?.viewport?.label;
  const requirements = (profile?.designSpec?.requirements || []).filter((requirement) => {
    const declared = requirement.params?.viewport;
    if (requirement.checkType === 'mobile-layout' && viewportLabel && viewportLabel !== 'mobile') return false;
    return !declared || !viewportLabel || declared === viewportLabel;
  });
  return Promise.all(requirements.map((requirement) => checkDesignRequirementFront(requirement, { ...context, profile })));
}
