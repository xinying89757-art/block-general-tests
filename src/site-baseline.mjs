import fs from 'node:fs/promises';
import path from 'node:path';

export function normalizeSiteHost(siteDomain) {
  if (!siteDomain) throw new Error('SITE_DOMAIN is required to resolve a site baseline.');
  let url;
  try { url = new URL(/^https?:\/\//i.test(siteDomain) ? siteDomain : `https://${siteDomain}`); }
  catch { throw new Error(`Invalid SITE_DOMAIN for baseline identity: ${siteDomain}`); }
  if (!url.hostname) throw new Error('SITE_DOMAIN must contain a host.');
  return url.host.toLowerCase();
}

/** @typedef {{pageKind?: string, pageId?: string|number}} BaselinePage */

/**
 * Resolve a page-scoped baseline when both page identity fields are supplied.
 * @param {string} root Repository root.
 * @param {string} siteHost Site URL or host.
 * @param {string|number} blockId Numeric block identity.
 * @param {BaselinePage} [page] Optional page identity; omitted preserves the legacy path.
 * @returns {string} Baseline filename.
 */
export function siteBaselinePath(root, siteHost, blockId, { pageKind, pageId } = {}) {
  const host = normalizeSiteHost(siteHost);
  if (!/^\d+$/.test(String(blockId))) throw new Error(`Invalid block ID for site baseline: ${blockId}`);
  if (pageKind != null && pageId != null) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(pageKind)) || !/^[a-zA-Z0-9_-]+$/.test(String(pageId))) {
      throw new Error('Invalid page identity for site baseline.');
    }
    return path.join(root, 'sites', host, `${pageKind}-${pageId}`, `${blockId}.baseline.json`);
  }
  return path.join(root, 'sites', host, `${blockId}.baseline.json`);
}

/**
 * Validate site/block and, for documents declaring a page, exact page identity.
 * Legacy documents without page metadata remain readable.
 * @param {Object} baseline Parsed baseline document.
 * @param {{siteHost: string, blockId: string|number, pageKind?: string, pageId?: string|number}} identity Expected identity.
 * @returns {Object} Validated document.
 * @throws {Error} On format or identity mismatch.
 */
export function validateSiteBaseline(baseline, { siteHost, blockId, pageKind, pageId }) {
  const expectedHost = normalizeSiteHost(siteHost);
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) throw new Error('Invalid site baseline document.');
  if (baseline.siteHost !== expectedHost) throw new Error(`Site baseline host mismatch: file=${baseline.siteHost} current=${expectedHost}`);
  if (String(baseline.blockId) !== String(blockId)) throw new Error(`Site baseline block mismatch: file=${baseline.blockId} current=${blockId}`);
  if (Object.hasOwn(baseline, 'page') && (!baseline.page || pageKind == null || pageId == null
    || baseline.page.pageKind !== pageKind || String(baseline.page.pageId) !== String(pageId))) {
    throw new Error('Site baseline page mismatch.');
  }
  if (baseline.version !== 1 || !Array.isArray(baseline.steps)) throw new Error('Unsupported site baseline format.');
  return baseline;
}

const warnedLegacyPaths = new Set();

/**
 * Prefer a page-scoped baseline; fall back to a legacy document with one warning per path.
 * @param {string} root Repository root.
 * @param {string} siteHost Site URL or host.
 * @param {string|number} blockId Block identity.
 * @param {BaselinePage} [page] Optional expected page identity.
 * @returns {Promise<{file: string, baseline: Object|null}>} Resolved path and validated document.
 */
export async function readSiteBaseline(root, siteHost, blockId, { pageKind, pageId } = {}) {
  let file = siteBaselinePath(root, siteHost, blockId, { pageKind, pageId });
  const legacyFile = siteBaselinePath(root, siteHost, blockId);
  let parsed;
  try {
    let source;
    try { source = await fs.readFile(file, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT' || file === legacyFile) throw error;
      source = await fs.readFile(legacyFile, 'utf8');
      if (!warnedLegacyPaths.has(legacyFile)) {
        console.warn(`[baseline] Page baseline unavailable; using legacy baseline: ${legacyFile}`);
        warnedLegacyPaths.add(legacyFile);
      }
      file = legacyFile;
    }
    parsed = JSON.parse(source);
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      const sitesDir = path.join(root, 'sites');
      const directories = await fs.readdir(sitesDir, { withFileTypes: true }).catch(() => []);
      const otherHosts = [];
      for (const entry of directories) {
        if (!entry.isDirectory() || entry.name === normalizeSiteHost(siteHost)) continue;
        try { await fs.access(path.join(sitesDir, entry.name, `${blockId}.baseline.json`)); otherHosts.push(entry.name); }
        catch {}
      }
      if (otherHosts.length) throw new Error(`Site host mismatch: block ${blockId} has baseline(s) for ${otherHosts.join(', ')}, current host is ${normalizeSiteHost(siteHost)}.`);
      return { file, baseline: null };
    }
    throw error;
  }
  return { file, baseline: validateSiteBaseline(parsed, { siteHost, blockId, pageKind, pageId }) };
}

/**
 * Write a baseline to its page-scoped or legacy path according to metadata.page.
 * @param {string} root Repository root.
 * @param {string} siteHost Site URL or host.
 * @param {string|number} blockId Block identity.
 * @param {Object[]} steps Captured baseline operations.
 * @param {Object & {page?: BaselinePage}} [metadata] Serializable capture metadata.
 * @returns {Promise<{file: string, baseline: Object}>} Written document and path.
 */
export async function writeSiteBaseline(root, siteHost, blockId, steps, metadata = {}) {
  const host = normalizeSiteHost(siteHost);
  const page = metadata.page || {};
  const file = siteBaselinePath(root, host, blockId, page);
  const document = validateSiteBaseline({ version: 1, siteHost: host, blockId: String(blockId), ...metadata, steps }, { siteHost: host, blockId, ...page });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { file, baseline: document };
}

// Collection lists are CMS data, not stable setting identities. Capture only
// AUTOTEST entries; any other CMS item is deliberately ignored by policy.
export function makeFixtureSelectionRule(controls) {
  const groups = new Map();
  for (const control of (controls || []).filter((item) => item.type === 'checkbox'
    && /^AUTOTEST-/i.test(String(item.label || '')))) {
    groups.set(control.label, [...(groups.get(control.label) || []), Boolean(control.checked)]);
  }
  const items = [...groups].map(([label, states]) => {
    if (states.some((state) => state !== states[0])) throw new Error(`AUTOTEST 列表副本状态不一致：${label}`);
    return { label, type: 'checkbox', selected: states[0] };
  });
  return { kind: 'fixture-selection', items, otherItemsPolicy: 'ignored' };
}

export function fixtureSelectionDiff(rule, controls) {
  const groups = new Map();
  for (const control of (controls || []).filter((item) => item.type === 'checkbox'
    && /^AUTOTEST-/i.test(String(item.label || '')))) {
    groups.set(control.label, [...(groups.get(control.label) || []), Boolean(control.checked)]);
  }
  const key = (item) => JSON.stringify([item.label, item.type]);
  const expectedByKey = new Map((rule.items || []).map((item) => [key(item), item]));
  const diffs = [];
  for (const [itemKey, expected] of expectedByKey) {
    const states = groups.get(expected.label);
    if (!states?.length) diffs.push({ label: expected.label, expected: expected.selected, actual: null, reason: 'missing-fixture-item' });
    else if (states.some((selected) => selected !== expected.selected)) diffs.push({ label: expected.label, expected: expected.selected, actual: states, reason: 'fixture-selection-mismatch' });
  }
  for (const [label, states] of groups) if (!expectedByKey.has(key({ label, type: 'checkbox' }))) {
    diffs.push({ label, expected: null, actual: states, reason: 'unexpected-fixture-item' });
  }
  return diffs;
}
