import { readFileSync, readdirSync } from 'node:fs';

export function profileWithSiteData(id) {
  const profile = JSON.parse(readFileSync(new URL(`../../profiles/${id}.json`, import.meta.url)));
  const siteData = siteDataFor(id);
  if (siteData?.fixtureRefs) profile.fixture = siteData.fixtureRefs;
  return profile;
}

export function siteDataFor(id) {
  const files = new URL('../../sites/', import.meta.url);
  const hosts = readdirSync(files, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const matches = hosts.map((host) => {
    try { return JSON.parse(readFileSync(new URL(`../../sites/${host.name}/${id}.baseline.json`, import.meta.url))); }
    catch { return null; }
  }).filter(Boolean);
  if (matches.length > 1) throw new Error(`Multiple site fixture records for ${id}; specify host in test.`);
  return matches[0] || null;
}
