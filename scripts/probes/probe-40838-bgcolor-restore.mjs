// Probe v32: restore the 40838 filter background color to the baseline
// rgb(139,0,0). The 11-58 run's in-session restore reads said
// rgb(139,0,0), but a fresh session reads rgb(1,2,3) — the restore did
// not persist. Mirror the background probe's restore (Spectrum set +
// dialog save + page save), then read back in-session. Persistence is
// verified separately with a fresh-session probe.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, resolveTargetPage, ensureTargetPage, savePage } from '../../src/editor.mjs';
import { widgetSession } from '../../src/capabilities/shared.mjs';
import { readFileSync } from 'node:fs';

const ORIGINAL = 'rgb(139, 0, 0)';
const config = loadConfig();
const profile = JSON.parse(readFileSync('./profiles/40838.json', 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const out = { at: new Date().toISOString(), blockId: config.blockId };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const canvas = (await ensureTargetPage(page, config)).frame;
  const ws = widgetSession({ page, canvas, config, type: 'phoenix_blocks_filterStyle', title: '设置自定义字段筛选' });
  await ws.open();
  out.before = await ws.root.locator('#customOnBgColor').inputValue();
  const set = await ws.root.locator('#customOnBgColor').evaluate((node, value) => {
    const win = node.ownerDocument.defaultView, jq = win.jQuery || win.$;
    if (typeof jq?.fn?.spectrum !== 'function') return false;
    jq(node).spectrum('set', value); jq(node).trigger('change'); return true;
  }, ORIGINAL);
  out.spectrumSet = set;
  out.afterSet = await ws.root.locator('#customOnBgColor').inputValue();
  await ws.save();
  await savePage(page);
  await new Promise((r) => setTimeout(r, 2000));
  await ws.open();
  out.afterRestore = await ws.root.locator('#customOnBgColor').inputValue();
  await ws.cancel();
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-bgcolor-restore-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
