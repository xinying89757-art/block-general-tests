import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceDeferredChecks } from '../src/front-results.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const usage = '用法：node scripts/merge-front-results.mjs <front-*.tar.gz>';

async function allFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await allFiles(file)); else out.push(file);
  }
  return out;
}

function blockId(report) { return String(report?.config?.blockId ?? report?.profile?.blockId ?? report?.blockId ?? ''); }

function capabilitySet(report) {
  const all = (report?.profile?.capabilities || []).map((item) => item?.id).filter(Boolean).map(String);
  const filter = report?.capabilityFilter;
  if ((filter === null || filter === undefined || filter === '') && all.length) return [...new Set(all)].sort().join(',');
  if (filter === null || filter === undefined || filter === '') return '*';
  const values = Array.isArray(filter) ? filter : String(filter).split(',');
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort().join(',');
}

async function latestBoxReport(id, frontReport) {
  const dir = path.join(root, 'reports');
  const names = (await readdir(dir)).filter((name) => name.startsWith(`report-${id}-`) && name.endsWith('.json')
    && !name.includes('-front-merged-'))
    .sort().reverse();
  for (const name of names) {
    try {
      const report = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
      if (capabilitySet(report) === capabilitySet(frontReport)) return path.join(dir, name);
    } catch { /* ignore malformed or unrelated JSON files */ }
  }
  throw new Error(`没有区块 ${id} 且能力筛选集为“${capabilitySet(frontReport)}”的盒子端报告。`);
}

async function main() {
  const archive = process.argv[2];
  if (!archive) throw new Error(usage);
  const absoluteArchive = path.resolve(archive);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extractDir = path.join(root, 'reports', 'front', stamp);
  await mkdir(extractDir, { recursive: true });
  const extracted = spawnSync('tar', ['-xzf', absoluteArchive, '-C', extractDir], { encoding: 'utf8' });
  if (extracted.status !== 0) throw new Error(extracted.stderr || '无法解压前台结果包。');
  const files = await allFiles(extractDir);
  const frontReports = [];
  for (const file of files.filter((name) => name.endsWith('.json') && path.basename(name).startsWith('report-'))) {
    try {
      const report = JSON.parse(await readFile(file, 'utf8'));
      if (blockId(report) && Array.isArray(report.checks)) frontReports.push({ file, report });
    } catch { /* ignore non-report JSON artifacts */ }
  }
  if (!frontReports.length) throw new Error('压缩包里没有可用的前台 JSON 报告。');
  const groups = new Map();
  for (const item of frontReports) groups.set(blockId(item.report), item);
  for (const [id, frontItem] of groups) {
    const basePath = await latestBoxReport(id, frontItem.report);
    const base = JSON.parse(await readFile(basePath, 'utf8'));
    const front = frontItem.report;
    const remap = async (value) => {
      if (typeof value !== 'string') return value;
      const candidate = files.find((file) => path.basename(file) === path.basename(value));
      if (!candidate) return value;
      try { await access(candidate); return candidate; } catch { return value; }
    };
    for (const check of front.checks) if (check.screenshot) check.screenshot = await remap(check.screenshot);
    for (const key of Object.keys(front.screenshots || {})) front.screenshots[key] = await remap(front.screenshots[key]);
    const patched = replaceDeferredChecks(base, front);
    const patchedPath = path.join(extractDir, `patched-${id}-${stamp}.json`);
    await writeFile(patchedPath, `${JSON.stringify(patched, null, 2)}\n`, 'utf8');
    const outPath = path.join(root, 'reports', `report-${id}-front-merged-${stamp}.json`);
    const merged = spawnSync(process.execPath, [path.join(root, 'scripts', 'merge-reports.mjs'), basePath, patchedPath, outPath],
      { cwd: root, encoding: 'utf8' });
    if (merged.status !== 0) throw new Error(merged.stderr || merged.stdout || `合并区块 ${id} 报告失败。`);
    const htmlPath = outPath.replace(/\.json$/, '.html');
    const rendered = spawnSync(process.execPath, [path.join(root, 'scripts', 'report-html.mjs'), outPath, htmlPath],
      { cwd: root, encoding: 'utf8' });
    if (rendered.status !== 0) throw new Error(rendered.stderr || rendered.stdout || `生成区块 ${id} HTML 报告失败。`);
    console.log(`区块 ${id}：${outPath}；${htmlPath}`);
  }
  console.log(`前台结果已解压：${extractDir}`);
}

main().catch((error) => { console.error(`[merge-front-results] ${error.message}`); process.exitCode = 1; });
