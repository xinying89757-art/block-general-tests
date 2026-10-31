// Read-only proof that a stuck button editor can be discarded by reloading,
// then read back unchanged before a final cleanup reload. Never saves.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.mjs';
import { resolveTargetPage } from '../../src/editor.mjs';
import { launchTargetEditor } from '../../src/site-editor-session.mjs';
import { readButtonPopover } from '../../src/capabilities/button-link.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const blockId = process.argv[2]?.trim();
if (blockId) process.env.BLOCK_ID = blockId;
const config = loadConfig();
const profile = JSON.parse(await readFile(path.resolve(root, config.profile || `profiles/${config.blockId}.json`), 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const { session, page, canvas } = await launchTargetEditor(config);
try {
  const result = await readButtonPopover({ page, canvas, config });
  if (result.dismissal !== 'reload-discard') {
    throw new Error(`期望通过重载丢弃弹窗状态，实际方式：${result.dismissal}`);
  }
  console.log('只读重载探针通过：重载后按钮字段回读一致；随后再次重载清理 UI；没有调用保存。');
} finally {
  await session.browser.close();
}
