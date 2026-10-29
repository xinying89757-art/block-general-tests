import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDirs = ['src', 'scripts', 'tests'];

function listModules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return listModules(filename);
    return entry.isFile() && entry.name.endsWith('.mjs') ? [filename] : [];
  });
}

let failed = false;
for (const directory of sourceDirs) {
  for (const filename of listModules(path.join(root, directory))) {
    const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    if (result.status === 0) continue;
    failed = true;
    process.stderr.write(`${path.relative(root, filename)}: syntax check failed\n`);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${result.error.message}\n`);
  }
}

if (failed) process.exitCode = 1;
else console.log(`Syntax OK: all .mjs files under ${sourceDirs.join(', ')}`);
