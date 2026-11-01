import fs from 'node:fs';
import path from 'node:path';
import { DESIGN_CHECK_TYPES, validateDesignSpec } from '../src/design-spec-checklist.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const directory = path.join(root, 'profiles');
const errors = [];
const schemaPath = path.join(root, 'schemas/design-checklist.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const schemaTypes = schema.properties?.requirements?.items?.properties?.checkType?.enum || [];
if (JSON.stringify(schemaTypes) !== JSON.stringify(DESIGN_CHECK_TYPES)) {
  errors.push({ profileId: '(schema)', path: 'checkType.enum', message: 'does not match the fixed checker catalog' });
}
for (const name of fs.readdirSync(directory).filter((item) => item.endsWith('.json')).sort()) {
  const profilePath = path.join(directory, name);
  let profile;
  try { profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')); }
  catch (error) { console.error(`${name}: invalid JSON (${error.message})`); process.exitCode = 1; continue; }
  if (profile.designSpec !== undefined) errors.push(...validateDesignSpec(profile.designSpec, path.basename(name, '.json')));
}
if (errors.length) {
  for (const error of errors) console.error(`${error.profileId}: ${error.path} ${error.message}`);
  process.exitCode = 1;
} else console.log('Design checklists OK.');
