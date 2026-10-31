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

export function siteBaselinePath(root, siteHost, blockId) {
  const host = normalizeSiteHost(siteHost);
  if (!/^\d+$/.test(String(blockId))) throw new Error(`Invalid block ID for site baseline: ${blockId}`);
  return path.join(root, 'sites', host, `${blockId}.baseline.json`);
}

export function validateSiteBaseline(baseline, { siteHost, blockId }) {
  const expectedHost = normalizeSiteHost(siteHost);
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) throw new Error('Invalid site baseline document.');
  if (baseline.siteHost !== expectedHost) throw new Error(`Site baseline host mismatch: file=${baseline.siteHost} current=${expectedHost}`);
  if (String(baseline.blockId) !== String(blockId)) throw new Error(`Site baseline block mismatch: file=${baseline.blockId} current=${blockId}`);
  if (baseline.version !== 1 || !Array.isArray(baseline.steps)) throw new Error('Unsupported site baseline format.');
  return baseline;
}

export async function readSiteBaseline(root, siteHost, blockId) {
  const file = siteBaselinePath(root, siteHost, blockId);
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(file, 'utf8')); }
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
  return { file, baseline: validateSiteBaseline(parsed, { siteHost, blockId }) };
}

export async function writeSiteBaseline(root, siteHost, blockId, steps, metadata = {}) {
  const host = normalizeSiteHost(siteHost);
  const file = siteBaselinePath(root, host, blockId);
  const document = validateSiteBaseline({ version: 1, siteHost: host, blockId: String(blockId), ...metadata, steps }, { siteHost: host, blockId });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { file, baseline: document };
}

// Collection lists are CMS data, not stable setting identities. Capture only
// AUTOTEST entries; any other CMS item is deliberately ignored by policy.
export function makeFixtureSelectionRule(controls) {
  const items = (controls || []).filter((control) => control.type === 'checkbox'
    && /^AUTOTEST-/i.test(String(control.label || '')))
    .map((control) => ({ label: control.label, type: 'checkbox', selected: Boolean(control.checked) }));
  return { kind: 'fixture-selection', items, otherItemsPolicy: 'ignored' };
}

export function fixtureSelectionDiff(rule, controls) {
  const actual = (controls || []).filter((control) => control.type === 'checkbox'
    && /^AUTOTEST-/i.test(String(control.label || '')))
    .map((control) => ({ label: control.label, type: 'checkbox', selected: Boolean(control.checked) }));
  const key = (item) => JSON.stringify([item.label, item.type]);
  const expectedByKey = new Map((rule.items || []).map((item) => [key(item), item]));
  const actualByKey = new Map(actual.map((item) => [key(item), item]));
  const diffs = [];
  for (const [itemKey, expected] of expectedByKey) {
    const found = actualByKey.get(itemKey);
    if (!found) diffs.push({ label: expected.label, expected: expected.selected, actual: null, reason: 'missing-fixture-item' });
    else if (found.selected !== expected.selected) diffs.push({ label: expected.label, expected: expected.selected, actual: found.selected, reason: 'fixture-selection-mismatch' });
  }
  for (const [itemKey, found] of actualByKey) if (!expectedByKey.has(itemKey)) {
    diffs.push({ label: found.label, expected: null, actual: found.selected, reason: 'unexpected-fixture-item' });
  }
  return diffs;
}
