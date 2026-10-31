// Capture a block's baseline from its current configuration on its home
// page and write it into the profile's `baseline` field.
//
//   node scripts/capture-baseline.mjs [BLOCK_ID]
//
// BLOCK_ID defaults to the .env value; TARGET_PAGE overrides the profile's
// target page for this run. Read-only: dialogs are opened, snapshotted and
// cancelled without saving, so nothing on the site changes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { resolveTargetPage } from '../src/editor.mjs';
import { launchTargetEditor } from '../src/site-editor-session.mjs';
import { captureBaseline } from '../src/baseline.mjs';
import { readSiteBaseline, writeSiteBaseline } from '../src/site-baseline.mjs';
import { waitForStable } from '../src/ui-waits.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[2]) process.env.BLOCK_ID = process.argv[2];
const config = loadConfig();
const profilePath = path.resolve(projectRoot, config.profile || `profiles/${config.blockId}.json`);
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);

const { session, page, canvas } = await launchTargetEditor(config);
try {
  const steps = await captureBaseline({ page, canvas, config, blockId: config.blockId });
  const readInstances = () => canvas.locator('body').evaluate((body, blockId) => {
    const blocks = [...body.querySelectorAll('.siteblocks-setting-wrap[data-appid]')];
    return blocks.flatMap((node, index) => {
      if (node.getAttribute('data-appid') !== blockId) return [];
      const rect = node.getBoundingClientRect();
      const settingAttr = [...node.attributes].find((attr) => /setting.?id/i.test(attr.name));
      const nested = [...node.querySelectorAll('*')].flatMap((child) => [...child.attributes]
        .filter((attr) => /setting.?id/i.test(attr.name)).map((attr) => attr.value))[0];
      return [{ index, position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, settingId: settingAttr?.value || nested || null }];
    });
  }, String(config.blockId));
  const instances = await waitForStable(readInstances, (items) => items.length > 0, {
    timeout: Number(process.env.CANVAS_RENDER_TIMEOUT_MS) || 45_000,
    stableMs: Number(process.env.CANVAS_RENDER_STABLE_MS) || 8_000,
  });
  if (!instances.length) throw new Error(`区块 ${config.blockId} 不在目标页，拒绝捕获空基线。`);
  const prior = await readSiteBaseline(projectRoot, config.siteDomain, config.blockId);
  const fixture = prior.baseline?.fixtureRefs || profile.fixture || {};
  const fixtureRefs = {
    ...fixture,
  };
  const { file: baselineFile } = await writeSiteBaseline(projectRoot, config.siteDomain, config.blockId, steps, {
    capturedAt: new Date().toISOString(),
    instance: { selection: 'first-in-dom-order', ...instances[0], instanceCount: instances.length },
    fixtureRefs,
  });
  for (const step of steps) {
    if (step.skipped) {
      console.log(`- [跳过] ${step.type} #${step.wrapIndex}：${step.skipped}`);
    } else {
      const extra = [
        step.skippedDisabled ? `跳过 ${step.skippedDisabled} 个 disabled 控件` : '',
        step.skippedNoLabel ? `跳过 ${step.skippedNoLabel} 个无标签控件` : '',
      ].filter(Boolean).join('；');
      console.log(`- ${step.title}（${step.type} #${step.wrapIndex}）：${step.want.length} 项${extra ? `（${extra}）` : ''}`);
    }
  }
  console.log(`首实例：${JSON.stringify({ ...instances[0], instanceCount: instances.length })}`);
  console.log(`站点基线已写入 ${baselineFile}`);
} finally {
  await session.browser.close();
}
