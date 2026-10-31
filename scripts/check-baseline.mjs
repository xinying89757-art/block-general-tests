// 只读：在新会话中读取区块当前值并与画像基线比对，打印差异（不恢复、不保存）。
//   node scripts/check-baseline.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, ensureTargetPage, resolveTargetPage } from '../src/editor.mjs';
import { readCurrentState, diffAgainstBaseline } from '../src/baseline-guard.mjs';
import { readSiteBaseline } from '../src/site-baseline.mjs';

const config = loadConfig();
const requestedBlockId = process.argv[2]?.trim();
if (requestedBlockId) config.blockId = requestedBlockId;
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = JSON.parse(await readFile(path.resolve(root, config.profile || `profiles/${config.blockId}.json`), 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const { baseline: siteBaseline, file: baselineFile } = await readSiteBaseline(root, config.siteDomain, config.blockId);
if (!siteBaseline) throw new Error(`Site baseline not found: ${baselineFile}`);
const baseline = siteBaseline.steps;
console.log(`[baseline] BLOCK_ID=${config.blockId}`);
const session = await launchSession(config);
try {
  session.page = (await openEditor(session.page, config)).page;
  const { frame: canvas } = await ensureTargetPage(session.page, config);
  const current = await readCurrentState({ page: session.page, canvas, config, baseline });
  const diffs = diffAgainstBaseline(baseline, current);
  console.log(diffs.length ? `残留 ${diffs.length} 项：\n${diffs.map((d) => `${d.type} / ${d.label}: ${JSON.stringify(d.actual)} ≠ ${JSON.stringify(d.expected)}（${d.reason}）`).join('\n')}` : '与基线一致：无残留');
  process.exitCode = diffs.length ? 1 : 0;
} finally { await session.browser.close(); }
