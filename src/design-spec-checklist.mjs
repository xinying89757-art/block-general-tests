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
  return { id: `design-${requirement.id}`, name: waived ? '已知例外' : displayName || requirement.sourceText,
    status, classification: classification || null,
    sourceText: requirement.sourceText, expected: expected ?? requirement.expected,
    ...(actual === undefined ? {} : { actual }), detail,
    reason: { stage: requirement.checkStage, checkType: requirement.checkType, ...reason } };
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

function mappedFrontCheck(requirement, frontChecks) {
  const ids = requirement.params?.styleCheckIds || (requirement.params?.styleCheckId ? [requirement.params.styleCheckId] : []);
  if (!ids.length) return null;
  const found = ids.map((id) => frontChecks.find((item) => item.id === id || item.id === `bss-${id}`)).filter(Boolean);
  if (!found.length) return { status: 'na', reason: { code: 'mapped-style-check-unavailable', mappedCount: ids.length, resultCount: 0 } };
  const judged = found.filter((item) => ['pass', 'fail'].includes(item.status));
  if (!judged.length) return { status: 'na', reason: { code: 'mapped-style-check-not-asserted', statuses: found.map((item) => item.status) } };
  return { status: judged.every((item) => item.status === 'pass') ? 'pass' : 'fail',
    actual: judged.map((item) => ({ id: item.id, status: item.status,
      expected: item.reason?.expected ?? item.expected,
      actual: item.reason?.actual ?? item.actual ?? item.evidence?.elements })),
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
  // CSSOM is not available for cross-origin stylesheets. Parse ordinary rules
  // from fetched text and preserve only selector/property evidence, never URLs.
  for (const rule of String(cssText || '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    const properties = [];
    for (const declaration of rule[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 1) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).replace(/!important\s*$/i, '').trim();
      if (cssColors(value).some((candidate) => opaqueColorKey(candidate) === expectedKey)) properties.push(property);
    }
    if (properties.length) matches.push({ selector, selectors: splitCssSelectorList(selector), properties: [...new Set(properties)] });
  }
  return matches;
}

function countCssRules(cssText) {
  return [...String(cssText || '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => !match[1].trim().startsWith('@')).length;
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

async function scopedCssMatches(page, rootSelector, declarations, { blockId, settingId } = {}) {
  if (!declarations.length) return [];
  return page.evaluate(({ rootSelector, declarations, blockId, settingId }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return [];
    const rootClasses = [...root.classList];
    const identities = [...new Set([root.id, settingId, `siteblocks-setting-wrap-${settingId}`,
      ...rootClasses.filter((name) => blockId && name.includes(String(blockId))), ...rootClasses].filter(Boolean))];
    const hasIdentity = (selector) => identities.some((identity) =>
      selector.includes(`#${identity}`) || selector.includes(`.${identity}`)
      || selector.includes(`="${identity}"`) || selector.includes(`='${identity}'`));
    return declarations.flatMap((declaration) => {
      const matchedSelectors = declaration.selectors.filter((selector) => {
        const base = selector.replace(/::(?:before|after|marker|placeholder)\b/g, '')
          .replace(/:(?:hover|focus|focus-visible|active|checked|open)\b/g, '');
        try {
          if (root.matches(base) || root.querySelector(base)) return true;
          if (!hasIdentity(base)) return false;
          const identityMatches = identities.map((identity) => ({ identity, tokenIndex: Math.max(
            base.indexOf(`.${identity}`), base.indexOf(`#${identity}`), base.indexOf(`="${identity}"`), base.indexOf(`='${identity}'`)) }))
            .filter((item) => item.tokenIndex >= 0).sort((a, b) => b.tokenIndex - a.tokenIndex);
          for (const item of identityMatches) {
            const token = base.slice(item.tokenIndex).match(/^(?:\.[\w-]+|#[\w-]+|=["'][^"']+["'])/);
            if (!token) continue;
            let tail = base.slice(item.tokenIndex + token[0].length).replace(/^\s*[>+~]?\s*/, '').trim();
            if (!tail) return true;
            try { if (root.querySelector(tail)) return true; } catch {}
          }
          return false;
        } catch { return false; }
      });
      return matchedSelectors.length ? [{ ...declaration, matchedSelectors }] : [];
    });
  }, { rootSelector, declarations, blockId: String(blockId || ''), settingId: String(settingId || '') });
}

async function scanWrittenColorStylesheets({ page, rootSelector, settingsReport, fetchStylesheet } = {}) {
  const values = extractWrittenColorValues(settingsReport);
  if (!page || !rootSelector || !values.length) return { evidenceById: {}, sheetCount: 0, ruleCount: 0, fetchFailureCount: 0 };
  const inventory = await page.evaluate(({ rootSelector }) => {
    const links = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((item) => item.href);
    const inline = [...document.querySelectorAll('style')].map((item) => item.textContent || '');
    const linkRules = [];
    let crossOriginUnreadableCount = 0;
    for (const sheet of [...document.styleSheets]) {
      const href = sheet.href;
      if (!href) continue;
      try { linkRules.push({ href, text: [...sheet.cssRules].map((rule) => rule.cssText).join('\n') }); }
      catch { crossOriginUnreadableCount += 1; }
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
    return { links, inline, inlineRules, linkRules, crossOriginUnreadableCount };
  }, { rootSelector });
  const sheets = [...inventory.inline.map((text, index) => ({ source: `inline-${index}`, text }))];
  for (const [index, item] of (inventory.inlineRules || []).entries())
    sheets.push({ source: `inline-attr-${index}`, text: `${item.selector}{${item.text}}` });
  const alreadyRead = new Map((inventory.linkRules || []).map((item) => [item.href, item.text]));
  for (const [index, href] of inventory.links.entries()) {
    if (alreadyRead.has(href)) { sheets.push({ source: `linked-${index}`, text: alreadyRead.get(href) }); continue; }
    try {
      const request = page.context?.()?.request || page.request;
      if (!fetchStylesheet && !request?.get) throw new Error('stylesheet-fetch-unavailable');
      const text = fetchStylesheet ? await fetchStylesheet(href) : await (async () => {
        const response = await request.get(href, { timeout: 20000 });
        if (!response.ok()) throw new Error(`stylesheet-http-${response.status()}`);
        return response.text();
      })();
      sheets.push({ source: `linked-${index}`, text });
    } catch {
      sheets.push({ source: `linked-${index}`, text: '', unavailable: true });
    }
  }
  const evidenceById = {};
  for (const item of values) {
    const declarations = sheets.flatMap((sheet) => cssColorDeclarations(sheet.text, item.value)
      .map((declaration) => ({ ...declaration, source: sheet.source })));
    const scoped = await scopedCssMatches(page, rootSelector, declarations,
      { blockId: settingsReport?.blockId, settingId: settingsReport?.block?.settingId });
    evidenceById[item.id] = { sheetCount: sheets.length, ruleCount: sheets.reduce((sum, sheet) => sum + countCssRules(sheet.text), 0),
      fetchFailureCount: sheets.filter((sheet) => sheet.unavailable).length,
      cssRulesUnreadableCount: inventory.crossOriginUnreadableCount || 0,
      matchCount: scoped.length, rules: scoped };
  }
  return { evidenceById, sheetCount: sheets.length,
    ruleCount: sheets.reduce((sum, sheet) => sum + countCssRules(sheet.text), 0),
    fetchFailureCount: sheets.filter((sheet) => sheet.unavailable).length };
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
    ? entry.actual : entry.actual && typeof entry.actual === 'object' ? [entry.actual] : []);
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

export async function checkDesignRequirementFront(requirement, { profile, page, rootSelector, frontChecks = [], settingsReport = null } = {}) {
  const override = overrideFor(profile?.designSpec, requirement.id);
  if (override) return checkResult(requirement, 'na', { classification: 'known-exception',
    detail: `已知例外：${override.reason}`, reason: { code: 'waived', reason: override.reason } });
  if (!['front', 'both'].includes(requirement.checkStage)) return null;
  if (requirement.checkType === 'color-scope' || requirement.checkType === 'typography') {
    const scopeOverride = requirement.checkType === 'color-scope' ? scopeOverrideFor(profile?.designSpec, requirement.id) : null;
    const mapped = mappedFrontCheck(requirement, frontChecks);
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
      ? '本区块没有可执行的对应样式结果。' : requirement.checkType === 'typography' && requirement.expected?.fontSize
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
  return checkResult(requirement, 'na', { detail: '该检查类型尚无安全的自动化 oracle。',
    reason: { code: 'front-checker-unavailable', checkType: requirement.checkType } });
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

export async function runWrittenColorFrontChecks({ page, rootSelector, settingsReport, includeStylesheets = true,
  fetchStylesheet, stateExercise = false }) {
  const values = extractWrittenColorValues(settingsReport);
  if (!values.length) return [{ id: 'written-color-presence', name: '本次写入颜色前台回读', status: 'na',
    detail: '运行报告没有可验证的颜色设置当前值。', reason: { stage: 'front', code: 'no-written-color-values' } }];
  if (!page || !rootSelector) return values.map((item) => ({ id: item.id, name: '本次写入颜色前台回读', status: 'na',
    expected: item.value, detail: '目标区块前台实例不可达。', reason: { stage: 'front', code: 'instance-root-unavailable',
      expectedSource: 'run-report.currentValues', controlIndex: item.controlIndex } }));
  const checks = [];
  const stateEvidence = stateExercise
    ? await exerciseWrittenColorStates(page, rootSelector, values).catch((error) => ({ states: [], candidateCount: 0,
      disclosureCount: 0, revealed: {}, error: { class: error?.name || 'Error', code: 'state-exercise-unavailable' } }))
    : { states: [], candidateCount: 0, disclosureCount: 0, revealed: {} };
  // Fetch/parse linked CSS before assigning an absent verdict. Cross-origin
  // CSSOM failures are retried through the page context's request client.
  const stylesheetScan = includeStylesheets
    ? await scanWrittenColorStylesheets({ page, rootSelector, settingsReport, fetchStylesheet })
    : { evidenceById: {}, sheetCount: 0, ruleCount: 0, fetchFailureCount: 0 };
  for (const item of values) {
    const snapshot = await readInstanceColorSnapshot(page, rootSelector);
    const stateMatch = stateEvidence.revealed[item.id];
    const matches = countInstanceColorMatches(snapshot, item.value);
    const cssEvidence = stylesheetScan.evidenceById[item.id] || { sheetCount: stylesheetScan.sheetCount,
      ruleCount: stylesheetScan.ruleCount, fetchFailureCount: stylesheetScan.fetchFailureCount,
      cssRulesUnreadableCount: 0, matchCount: 0, rules: [] };
    const foundOnElement = snapshot.rootCount === 1 && (matches > 0 || Boolean(stateMatch));
    const cssOnly = !foundOnElement && cssEvidence.matchCount > 0;
    const outcome = foundOnElement ? 'found-on-element' : cssOnly ? 'instance-scoped-css-only' : 'absent';
    const actual = { rootCount: snapshot.rootCount, elementCount: snapshot.styles.length,
      matches: matches || stateMatch?.matches || 0,
      stylesheetEvidence: { sheetCount: cssEvidence.sheetCount, ruleCount: cssEvidence.ruleCount,
        fetchFailureCount: cssEvidence.fetchFailureCount, matchCount: cssEvidence.matchCount,
        ...(cssEvidence.cssRulesUnreadableCount ? { cssRulesUnreadableCount: cssEvidence.cssRulesUnreadableCount } : {}),
        ...(cssEvidence.matchCount ? { rules: cssEvidence.rules } : {}) },
      stateExercise: { enabled: Boolean(stateExercise), states: stateEvidence.states,
        candidateCount: stateEvidence.candidateCount, disclosureCount: stateEvidence.disclosureCount,
        revealedBy: stateMatch?.state || null,
        ...(stateEvidence.error ? { error: stateEvidence.error } : {}) } };
    checks.push({ id: item.id, name: '本次写入颜色前台回读', status: outcome === 'found-on-element' ? 'pass'
      : outcome === 'instance-scoped-css-only' ? 'record' : 'fail',
      classification: outcome, expected: item.value, actual,
      detail: outcome === 'found-on-element' ? '目标区块内存在呈现本次写入颜色的元素。'
        : outcome === 'instance-scoped-css-only' ? '已保存的颜色只出现在目标实例相关 CSS 规则中，未在计算样式中呈现。'
          : '已保存的颜色未在目标实例前台呈现。',
      reason: { stage: 'front', code: outcome,
        expectedSource: 'run-report.currentValues', controlIndex: item.controlIndex,
        propertiesChecked: ['color', 'backgroundColor', 'borderColor', 'fill', 'stroke', 'outlineColor', 'boxShadow',
          'backgroundImage', '::before', '::after'],
        ...(stateMatch ? { revealedByState: stateMatch.state } : {}) } });
  }
  return checks;
}

export async function exerciseWrittenColorStates(page, rootSelector, values, { maxElements = 80 } = {}) {
  const root = page.locator(rootSelector);
  const candidates = root.locator('a,button,[role="button"],[role="link"],[role="option"],[role="menuitem"],[role="tab"],[aria-haspopup],summary,details,input,select,textarea');
  const count = Math.min(await candidates.count(), maxElements);
  const revealed = {};
  const states = new Set();
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
        await candidate.evaluate((element) => element.showPicker?.());
        states.add('select-open');
        await scan('select-open');
        await candidate.press('Escape', { timeout: 1000 });
      }
    } catch {}
    try { await page.mouse?.move(0, 0); } catch {}
  }
  const details = root.locator('details');
  const detailsCount = Math.min(await details.count(), maxElements);
  for (let index = 0; index < detailsCount; index += 1) {
    const item = details.nth(index);
    try {
      const wasOpen = await item.evaluate((element) => element.open);
      if (wasOpen) continue;
      await item.evaluate((element) => { element.open = true; });
      states.add('disclosure-open');
      await scan('disclosure-open');
      await item.evaluate((element) => { element.open = false; });
    } catch { try { await item.evaluate((element) => { element.open = false; }); } catch {} }
  }
  try { await page.evaluate(() => document.activeElement?.blur?.()); } catch {}
  return { states: [...states], candidateCount: count, disclosureCount: detailsCount, revealed };
}

export async function runDesignSpecEditorChecks(profile, inventory) {
  return (profile?.designSpec?.requirements || []).map((requirement) =>
    checkDesignRequirementEditor(requirement, { profile, inventory })).filter(Boolean);
}

export async function runDesignSpecFrontChecks(profile, context) {
  return Promise.all((profile?.designSpec?.requirements || []).map((requirement) =>
    checkDesignRequirementFront(requirement, { ...context, profile })));
}
