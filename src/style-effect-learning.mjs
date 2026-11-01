/**
 * Learns front selector scopes from the editor canvas after a setting is
 * applied. Paths are relative to the uniquely identified instance and never
 * include generated block-number classes or element ids.
 */
const GENERATED_CLASS = /^blockCon\d+$/i;

export function stableRelativeSelectorPath(descriptors = []) {
  if (!Array.isArray(descriptors) || !descriptors.length) return null;
  return descriptors.map((node) => {
    const tag = String(node.tag || '').toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error('Selector path contains an invalid element tag.');
    const classes = [...new Set((node.classes || []).map(String))]
      .filter((name) => name && !GENERATED_CLASS.test(name) && /^[a-zA-Z_][\w-]*$/.test(name))
      .sort();
    const suffix = classes.map((name) => `.${name}`).join('');
    const nth = Number.isInteger(node.nthOfType) && node.nthOfType > 0 ? `:nth-of-type(${node.nthOfType})` : '';
    return `${tag}${suffix}${nth}`;
  }).join(' > ');
}

export function normalizeStyleValue(property, value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  if (/(color)$/i.test(property) || property === 'color' || property === 'backgroundColor') {
    const rgb = text.match(/^rgba?\(([^)]+)\)$/);
    if (rgb) {
      const channels = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
      if (channels.length >= 3 && channels.slice(0, 3).every(Number.isFinite)) {
        return `rgb(${channels.slice(0, 3).map((part) => Math.round(part)).join(',')})`;
      }
    }
    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3) digits = [...digits].map((part) => part + part).join('');
      return `rgb(${[0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16)).join(',')})`;
    }
  }
  return text;
}

export function deriveStyleEffectPaths(before = [], after = [], styleEffect = {}) {
  const properties = [...new Set(styleEffect.properties || [])];
  if (!properties.length) return { status: 'na', reason: 'no-style-properties-declared', effects: [] };
  if (styleEffect.expectedValues === null) return { status: 'na', reason: 'written-style-value-not-mapped', effects: [] };
  const expectedValues = styleEffect.expectedValues || {};
  const beforeByPath = new Map(before.map((item) => [item.path, item]));
  const effects = [];
  let anyChanged = false;
  for (const current of after) {
    const prior = beforeByPath.get(current.path);
    if (!prior) continue;
    const changedProperties = properties.filter((property) => {
      const oldValue = normalizeStyleValue(property, prior.styles?.[property]);
      const newValue = normalizeStyleValue(property, current.styles?.[property]);
      const expected = Object.hasOwn(expectedValues, property)
        ? normalizeStyleValue(property, expectedValues[property]) : undefined;
      const changed = oldValue !== null && newValue !== null && oldValue !== newValue;
      if (changed) anyChanged = true;
      return changed && (expected === undefined || newValue === expected);
    });
    if (!changedProperties.length) continue;
    const selector = current.pathFeatures?.length ? stableRelativeSelectorPath(current.pathFeatures) : ':scope';
    if (!selector) continue;
    for (const property of changedProperties) effects.push({ selector, property,
      expectedValue: current.styles[property], previousValue: prior.styles[property] });
  }
  const unique = new Map(effects.map((item) => [`${item.property}\u0000${item.selector}`, item]));
  const result = [...unique.values()];
  return result.length
    ? { status: 'learned', effects: result }
    : { status: 'na', reason: anyChanged ? 'changed-style-did-not-match-written-value'
      : 'no-computed-style-property-changed', effects: [] };
}

export function resolveSettingStyleEffect(setting) {
  const effect = setting?.styleEffect;
  if (!effect) return null;
  if (effect.valueSource === 'alternateValue') {
    return { ...effect, expectedValues: Object.fromEntries(effect.properties.map((property) => [property, setting.alternateValue])) };
  }
  if (effect.valueMap && typeof effect.valueMap === 'object') {
    const expectedValues = effect.valueMap[JSON.stringify(setting.alternateValue)];
    return { ...effect, expectedValues: expectedValues && typeof expectedValues === 'object' ? expectedValues : null };
  }
  throw new Error(`Setting ${setting.id} styleEffect must declare valueSource=alternateValue or a valueMap.`);
}

/** Convert one browser snapshot into profile-owned selectors and diagnostics. */
export function applyLearnedStyleEffects(profile, styleEffect, learned, { capturedAt = new Date().toISOString() } = {}) {
  const checks = new Map((styleEffect?.checks || []).map((item) => [`${item.property}\u0000${item.checkId}`, item]));
  const applied = [];
  for (const effect of learned.effects || []) {
    const matching = [...checks.values()].filter((item) => item.property === effect.property);
    for (const target of matching) {
      const styleItem = (profile?.capabilities || []).flatMap((capability) => capability.styleSpec?.items || [])
        .find((item) => item.id === target.checkId);
      if (!styleItem) continue;
      styleItem.learnedSelectors ||= {};
      styleItem.learnedSelectors[effect.property] = [{ selector: effect.selector, expectedValue: effect.expectedValue,
        source: 'editor-computed-style-diff', capturedAt }];
      applied.push({ checkId: target.checkId, property: effect.property, expectedValue: effect.expectedValue });
    }
  }
  let candidateCount = 0;
  if (!applied.length) {
    const candidates = [...new Map([...(styleEffect?.candidateSelectors || []), ...(learned.candidateSelectors || [])]
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((selector) => [selector, selector])).values()];
    for (const target of styleEffect?.checks || []) {
      const item = (profile?.capabilities || []).flatMap((capability) => capability.styleSpec?.items || [])
        .find((entry) => entry.id === target.checkId);
      if (!item || !candidates.length) continue;
      item.selectorCandidates = [...new Set([...(item.selectorCandidates || []), ...candidates])];
      candidateCount = Math.max(candidateCount, item.selectorCandidates.length);
    }
  }
  return { status: applied.length ? 'learned' : 'na', reason: applied.length ? null
    : (learned.reason || 'no-profile-check-mapping-for-changed-style'), applied, candidateCount };
}

export function clearLearnedStyleEffects(profile, styleEffect) {
  let cleared = 0;
  for (const target of styleEffect?.checks || []) {
    const item = (profile?.capabilities || []).flatMap((capability) => capability.styleSpec?.items || [])
      .find((entry) => entry.id === target.checkId);
    if (item?.learnedSelectors?.[target.property]) {
      delete item.learnedSelectors[target.property];
      cleared += 1;
    }
  }
  return cleared;
}

/** Browser-evaluated snapshot: identify by block number + settingId, then inspect its descendants. */
export async function snapshotInstanceComputedStyles(canvas, { blockId, settingId, properties, timeoutMs = 10_000 } = {}) {
  if (!canvas?.locator || !blockId || !settingId || !Array.isArray(properties) || !properties.length) {
    throw new Error('Computed-style snapshot requires canvas, blockId, settingId, and properties.');
  }
  const snapshot = await canvas.locator('body').evaluate(({ blockId, settingId, properties }) => {
    const isIdentity = (element) => [...element.attributes].some((attribute) => (/setting.?id/i.test(attribute.name)
      || (attribute.name === 'data-id' && String(attribute.value).startsWith('siteblocks-setting-wrap-')))
      && String(attribute.value).replace(/^siteblocks-setting-wrap-/, '') === String(settingId).replace(/^siteblocks-setting-wrap-/, ''));
    const roots = [...document.querySelectorAll('[data-appid]')].filter((element) =>
      String(element.getAttribute('data-appid')) === String(blockId)
      && (isIdentity(element) || [...element.querySelectorAll('*')].some(isIdentity)));
    if (roots.length !== 1) return { status: 'unavailable', reason: 'target-instance-identity-not-unique', matchCount: roots.length, elements: [] };
    const root = roots[0];
    const all = [root, ...root.querySelectorAll('*')];
    const pathFeatures = (element) => {
      const parts = [];
      let node = element;
      while (node && node !== root) {
        const parent = node.parentElement;
        if (!parent) return [];
        const sameType = [...parent.children].filter((sibling) => sibling.tagName === node.tagName);
        parts.unshift({ tag: node.tagName.toLowerCase(), classes: [...node.classList], nthOfType: sameType.indexOf(node) + 1 });
        node = parent;
      }
      if (element === root) return [];
      return parts;
    };
    const elements = all.map((element) => {
      const computed = getComputedStyle(element);
      const ancestry = [];
      for (let node = element; node && node !== root; node = node.parentElement) ancestry.push(node);
      const classFeatures = ancestry.flatMap((node) => [...node.classList]);
      const role = element.getAttribute('role') || '';
      const hasLink = element.tagName === 'A' && Boolean(element.getAttribute('href'));
      const pagination = role === 'navigation' || element.tagName === 'NAV'
        || classFeatures.some((name) => /pagination|pager/i.test(name));
      const hasText = Boolean((element.textContent || '').replace(/\s+/g, ' ').trim());
      return { pathFeatures: pathFeatures(element), features: { link: hasLink, pagination, text: hasText },
        styles: Object.fromEntries(properties.map((property) => [property, computed[property] || null])) };
    });
    return { status: 'ok', elements };
  }, { blockId: String(blockId), settingId: String(settingId), properties }, { timeout: timeoutMs });
  if (snapshot?.status !== 'ok') return snapshot;
  return { ...snapshot, elements: (snapshot.elements || []).map((entry) => ({ ...entry,
    path: entry.pathFeatures?.length ? stableRelativeSelectorPath(entry.pathFeatures) : ':scope' })) };
}

export function deriveSelectorCandidatesFromDom(nodes = []) {
  // Candidates are ranked from strongest generic structural evidence to the
  // broader feature selector. No candidate is borrowed from another profile.
  const candidates = [];
  for (const node of nodes) {
    const path = stableRelativeSelectorPath(node.pathFeatures || []);
    const features = node.features || { [node.feature]: true };
    if (path && features.pagination) candidates.push({ selector: path, feature: 'pagination-structure' });
    if (path && features.link) candidates.push({ selector: path, feature: 'link-hierarchy' });
    if (path && features.text) candidates.push({ selector: path, feature: 'text-hierarchy' });
  }
  return [...new Map(candidates.map((item) => [`${item.selector}`, item])).values()];
}

export function chooseSelectorCandidate(candidates = [], matchCounts = []) {
  for (let index = 0; index < candidates.length; index += 1) {
    if (Number(matchCounts[index]) > 0) return { status: 'resolved', index, matchCount: Number(matchCounts[index]) };
  }
  return { status: 'unresolved', reason: 'no-profile-selector-candidate-matched', attemptedCount: candidates.length };
}
