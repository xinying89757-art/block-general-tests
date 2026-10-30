// Put a block on its target page and save the page (no settings change).
//   node scripts/add-block.mjs <BLOCK_ID>
// Uses the same editor path as src/run.mjs (openEditor → ensureTargetPage →
// addBlockIfNeeded → savePage). No-op when the block is already there.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, ensureTargetPage, addBlockIfNeeded, savePage, resolveTargetPage } from '../src/editor.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[2]) process.env.BLOCK_ID = process.argv[2];
const config = loadConfig();
let profile = null;
try { profile = JSON.parse(await readFile(path.resolve(root, config.profile || `profiles/${config.blockId}.json`), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
config.resolvedTarget = resolveTargetPage(config, profile);
const session = await launchSession(config);
try {
  console.log('[add-block] 打开编辑器…');
  session.page = (await openEditor(session.page, config)).page;
  const { frame } = await ensureTargetPage(session.page, config);
  const added = await addBlockIfNeeded(session.page, frame, config);
  console.log(`[add-block] ${JSON.stringify(added)}`);
  if (added.added) { await savePage(session.page); console.log('[add-block] 已保存页面'); }
  else console.log('[add-block] 区块已在页面上，未保存');
} finally { await session.browser.close(); }
