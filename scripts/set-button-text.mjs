import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, ensureTargetPage, resolveTargetPage } from '../src/editor.mjs';
import { readButtonPopover, writeButtonPopover } from '../src/capabilities/button-link.mjs';

const text = process.argv.slice(2).join(' ');
if (!text) throw new Error('用法：node scripts/set-button-text.mjs <TEXT>');
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
  const before = await readButtonPopover({ page: session.page, canvas, config });
  const want = before.want.map((item) => item.label === '按钮文本' ? { ...item, to: text } : item);
  const result = await writeButtonPopover({ page: session.page, canvas, config, want });
  console.log(`按钮文本已保存并回读：${result.values.text}`);
} finally { await session.browser.close(); }
