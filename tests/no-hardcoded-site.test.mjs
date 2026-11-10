import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patterns = ['47948', 'wiKlpCRWyerd', 'BIAUYnyOREPZ', 'en-site79106751', 'AUTOTEST-47948'];

test('tracked src/ and scripts/ do not hardcode the 47948 site identity', () => {
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', 'src', 'scripts'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    tracked = [];
  }
  const generic = ['scripts/collect-filter-evidence.mjs', 'scripts/collect-filter-evidence-front.mjs', 'scripts/fixture-baseline.mjs',
    'scripts/restore-autotest-filter-fields.mjs', 'src/filter-evidence.mjs', 'src/fixture-state.mjs', 'src/fixture-data-ops.mjs'];
  const files = [...new Set([...tracked, ...generic])].filter((file) => fs.existsSync(path.join(root, file)) && /\.(mjs|js|sh|json)$/.test(file));
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const pattern of patterns) if (text.includes(pattern)) hits.push(`${file}: ${pattern}`);
  }
  assert.deepEqual(hits, []);
});
