// Local format migration only; this script never opens a browser or touches the site.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { writeSiteBaseline } from '../src/site-baseline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const blockId = process.argv[2];
if (!blockId) throw new Error('Usage: node scripts/migrate-site-baselines.mjs <BLOCK_ID>');
const config = loadConfig();
const profilePath = path.join(root, 'profiles', `${blockId}.json`);
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
if (String(profile.blockId) !== String(blockId) || !Array.isArray(profile.baseline)) throw new Error(`No legacy baseline for block ${blockId}.`);
const fixtureRefs = structuredClone(profile.fixture || {});
const fields = (fixtureRefs.fields || []).map(({ name }) => name);
const displayFields = (fixtureRefs.displayFields?.fields || []).map(({ name }) => name);
const steps = profile.baseline.map((step) => {
  const dynamic = step.type === 'phoenix_blocks_filterStyle'
    || (step.type === 'phoenix_blocks_gallery' && /分类|产品列表|选取数据/.test(step.title || ''));
  if (!dynamic) return step;
  const names = step.type === 'phoenix_blocks_filterStyle' ? fields
    : /分类/.test(step.title || '') ? [] : displayFields;
  const items = names.map((label) => {
    const old = step.want.find((item) => item.type === 'checkbox' && item.label === label);
    return { label, type: 'checkbox', selected: Boolean(old?.to) };
  });
  const want = step.want.filter((item) => item.type !== 'checkbox' || item.identity === 'select-all');
  return { ...step, want, fixtureSelection: { kind: 'fixture-selection', items, otherItemsPolicy: 'ignored' } };
});
const { file } = await writeSiteBaseline(root, config.siteDomain, blockId, steps, {
  migratedAt: new Date().toISOString(), fixtureRefs,
});
delete profile.baseline;
delete profile.fixture;
await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
console.log(`Migrated ${blockId} to ${file}; profile baseline removed.`);
