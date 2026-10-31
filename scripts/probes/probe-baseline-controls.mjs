import fs from 'node:fs/promises';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { ensureTargetPage, openEditor, resolveTargetPage } from '../../src/editor.mjs';
import { matchControl } from '../../src/baseline-identity.mjs';
import { widgetSession } from '../../src/capabilities/shared.mjs';

const config = loadConfig();
const profile = JSON.parse(await fs.readFile(config.profile || `profiles/${config.blockId}.json`, 'utf8'));
config.resolvedTarget = resolveTargetPage(config, profile);
const session = await launchSession(config);
const output = { at: new Date().toISOString(), blockId: config.blockId, steps: [] };
try {
  session.page = (await openEditor(session.page, config)).page;
  const { frame: canvas } = await ensureTargetPage(session.page, config);
  for (const definition of profile.baseline || []) {
    if (definition.skipped || definition.kind === 'button-popover') continue;
    const dialog = widgetSession({ page: session.page, canvas, config, type: definition.type,
      title: definition.title, wrapIndex: definition.wrapIndex });
    try {
      await dialog.open();
      const controls = await dialog.read();
      const missing = definition.want.filter((wanted) => {
        try { return !matchControl(controls, wanted); } catch { return true; }
      });
      output.steps.push({ title: definition.title, expected: definition.want.length, observed: controls.length,
        matched: definition.want.length - missing.length, missing: missing.map(({ label, type, value }) => ({ label, type, value })) ,
        examples: controls.slice(0, 20).map(({ label, type, value, checked }) => ({ label, type, value, checked })) });
    } finally { await dialog.cancel(); }
  }
} finally { await session.browser.close().catch(() => {}); }
await fs.mkdir('drafts', { recursive: true });
await fs.writeFile('drafts/baseline-controls-probe.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
