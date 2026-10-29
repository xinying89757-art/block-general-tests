// Fresh-session read: what is the persisted #customOnBgColor value right now?
// The last validation run's background checks verified the restore in-session,
// but the background probe found rgb(1,2,3) still persisted afterwards.
// This probe reads the value in a brand-new session (no writes).
import { readFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, ensureTargetPage, resolveTargetPage } from '../../src/editor.mjs';
import { widgetSession } from '../../src/capabilities/shared.mjs';

const config = loadConfig();
const profile = JSON.parse(readFileSync(`profiles/${config.blockId}.json`, 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const canvas = (await ensureTargetPage(page, config)).frame;
  const ws = widgetSession({ page, canvas, config, type: 'phoenix_blocks_filterStyle', title: '设置自定义字段筛选' });
  await ws.open();
  const value = await ws.root.locator('#customOnBgColor').inputValue();
  console.log(JSON.stringify({ at: new Date().toISOString(), persistedBgColor: value }));
  await ws.cancel();
} finally {
  await session.browser.close().catch(() => {});
}
