// 只读：打印区块按钮浮层当前的按钮文本、链接、新窗口值（不保存）。
//   node scripts/read-button-state.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, ensureTargetPage, resolveTargetPage } from '../src/editor.mjs';
import { readButtonPopover } from '../src/capabilities/button-link.mjs';

const config = loadConfig();
const root = fileURLToPath(new URL('../', import.meta.url));
let profile = {};
try { profile = JSON.parse(await readFile(path.resolve(root, config.profile || `profiles/${config.blockId}.json`), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
config.resolvedTarget = resolveTargetPage(config, profile);
const session = await launchSession(config);
try {
  session.page = (await openEditor(session.page, config)).page;
  const { frame: canvas } = await ensureTargetPage(session.page, config);
  const state = await readButtonPopover({ page: session.page, canvas, config });
  console.log(JSON.stringify(state.values ?? state, null, 2));
} finally { await session.browser.close(); }
