import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['scripts', 'src'];
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (entry.isFile() && fullPath.endsWith('.mjs')) files.push(fullPath);
  }
}

for (const root of roots) collect(path.join(projectRoot, root));

const importPattern = /(?:\bfrom\s*|\bimport\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g;
const missing = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2];
    const target = path.resolve(path.dirname(file), specifier);
    if (!fs.existsSync(target)) {
      const line = source.slice(0, match.index).split('\n').length;
      missing.push(`${path.relative(projectRoot, file)}:${line} -> ${specifier}`);
    }
  }
}

if (missing.length) {
  console.error(`Missing relative import targets (${missing.length}):\n${missing.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} modules; all relative import targets exist.`);
}
