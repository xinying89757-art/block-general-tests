// Restore a block to its profile baseline, then verify the saved state in a
// fresh browser session. Unlike check-baseline.mjs, this script writes values.
//   node scripts/restore-baseline.mjs [BLOCK_ID]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, ensureTargetPage, resolveTargetPage } from '../src/editor.mjs';
import { guardBaseline } from '../src/baseline-guard.mjs';

const blockId = process.argv[2] || process.env.BLOCK_ID;
if (!blockId) throw new Error('请提供区块 ID：node scripts/restore-baseline.mjs <区块 ID>');
process.env.BLOCK_ID = String(blockId);
const config = loadConfig();
const root = fileURLToPath(new URL('../', import.meta.url));
const profilePath = path.resolve(root, config.profile || `profiles/${blockId}.json`);
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
if (String(profile.blockId) !== String(blockId)) throw new Error(`画像区块 ID 与请求不匹配：${profile.blockId} != ${blockId}`);
if (!Array.isArray(profile.baseline) || !profile.baseline.length) throw new Error(`画像 ${profilePath} 没有可恢复的 baseline。`);
config.resolvedTarget = resolveTargetPage(config, profile);

const session = await launchSession(config);
try {
  session.page = (await openEditor(session.page, config)).page;
  const { frame: canvas } = await ensureTargetPage(session.page, config);
  const result = await guardBaseline({ page: session.page, canvas, config, baseline: profile.baseline });
  console.log(JSON.stringify({ blockId, result }, null, 2));
  if (result.residue && !result.verifiedFresh) process.exitCode = 1;
} catch (error) {
  console.error(`基线恢复失败：${error.message}`);
  process.exitCode = 1;
} finally {
  await session.browser.close();
}
