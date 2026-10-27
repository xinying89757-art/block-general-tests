// Capture a block's baseline from its current configuration on its home
// page and write it into the profile's `baseline` field.
//
//   node scripts/capture-baseline.mjs [BLOCK_ID]
//
// BLOCK_ID defaults to the .env value; TARGET_PAGE overrides the profile's
// target page for this run. Read-only: dialogs are opened, snapshotted and
// cancelled without saving, so nothing on the site changes.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, ensureTargetPage, resolveTargetPage } from '../src/editor.mjs';
import { captureBaseline } from '../src/baseline.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[2]) process.env.BLOCK_ID = process.argv[2];
const config = loadConfig();
const profilePath = path.resolve(projectRoot, config.profile || `profiles/${config.blockId}.json`);
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);

const session = await launchSession(config);
try {
  await openEditor(session.page, config);
  const { frame: canvas } = await ensureTargetPage(session.page, config);
  const steps = await captureBaseline({ page: session.page, canvas, config, blockId: config.blockId });
  profile.baseline = steps;
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
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
  console.log(`基线已写进 ${profilePath}`);
} finally {
  await session.browser.close();
}
