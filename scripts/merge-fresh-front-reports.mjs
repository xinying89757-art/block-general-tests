import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeFreshFrontReports, summarizeFreshFrontMerge } from '../src/fresh-front-merge.mjs';

const [boxPath, frontPath, requestedOutput] = process.argv.slice(2);
if (!boxPath || !frontPath) throw new Error('Usage: node scripts/merge-fresh-front-reports.mjs <box.json> <front.json> [output.json]');
const box = JSON.parse(await fs.readFile(boxPath, 'utf8'));
const front = JSON.parse(await fs.readFile(frontPath, 'utf8'));
const merged = mergeFreshFrontReports(box, front);
const output = requestedOutput || boxPath.replace(/\.json$/i, '-merged.json');
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(merged, null, 2)}\n`);
const summaryPath = output.replace(/\.json$/i, '-zh.md');
await fs.writeFile(summaryPath, summarizeFreshFrontMerge(merged));
console.log(`[fresh-merge] report: ${output}`);
console.log(`[fresh-merge] summary: ${summaryPath}`);
