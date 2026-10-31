import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { planDeclaredFreshSettings } from '../src/fresh-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = loadConfig();
const profilePath = path.resolve(root, 'profiles', `${config.blockId}.json`);
const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
if (String(profile.blockId) !== String(config.blockId)) throw new Error('Profile block identity does not match BLOCK_ID.');
const output = [];
for (const capability of profile.capabilities || []) {
  const modulePath = pathToFileURL(path.join(root, 'src', 'capabilities', `${capability.id}.mjs`)).href;
  const module = await import(modulePath);
  const definition = module.freshSettings;
  if (definition?.status !== 'adapted') {
    output.push({ capability: capability.id, status: 'not-adapted', reason: definition?.reason || 'No freshSettings definition.' });
    continue;
  }
  output.push({ capability: capability.id, status: 'adapted', ...planDeclaredFreshSettings({
    settingKeys: definition.settingKeys || Object.keys(definition.metadata || {}), metadata: definition.metadata || {},
  }) });
}
console.log(JSON.stringify({ blockId: config.blockId, dryRun: true,
  note: 'Declared dependency topology only; actual controls and plan are logged after fresh-instance inspection.', capabilities: output }, null, 2));
