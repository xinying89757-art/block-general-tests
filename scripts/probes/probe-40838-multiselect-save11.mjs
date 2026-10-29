// Probe v11: replicate the RUNNER's exact clicks for 小何2 (NmKqGFoHbPJy)
// — DOM input.click() on the checkbox + DOM click on the save button via
// evaluateAll (same as src/cms.mjs productFields/saveProduct) — with FULL
// request capture (all methods) and a post-click state dump. Decides
// whether the runner's DOM clicks trigger the save flow at all.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const PROD_ID = 'NmKqGFoHbPJy'; // 测试产品小何2
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await session.context.newPage();
  const reqs = [];
  cms.on('request', (req) => {
    if (/prod/.test(req.url())) {
      reqs.push({ at: new Date().toISOString(), method: req.method(), url: req.url().slice(0, 130),
        len: (req.postData() || '').length, hasOption: /option_911698/.test(req.postData() || '') });
    }
  });
  cms.on('response', async (res) => {
    if (/verify|similarityJudge|doUpdate/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 200); } catch { body = '<unreadable>'; }
      reqs.push({ at: new Date().toISOString(), responseFor: res.url().slice(0, 130), status: res.status(), body });
    }
  });
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  // Runner-exact checkbox set: DOM input.click() (productFields logic).
  const setState = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((i) => ['多选4-10', '多选8-10'].includes(norm([...(i.labels || [])].map((l) => l.innerText).join(' '))));
    const target = inputs.find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    for (const input of inputs) if (input.checked !== (input === target)) input.click();
    return inputs.map((i) => ({ label: norm([...(i.labels || [])].map((l) => l.innerText).join(' ')), checked: i.checked }));
  });
  out.steps.checkedAfterDomClick = setState;
  reqs.length = 0;
  // Runner-exact save click: evaluateAll, exactly one 保存/提交 control.
  const saveClick = await cms.locator('button, a, input[type="submit"], input[type="button"]').filter({ visible: true })
    .evaluateAll((nodes) => {
      const found = nodes.filter((node) => /^(保存|提交)$/.test((node.innerText || node.value || '').trim()));
      if (found.length !== 1) return { found: found.length };
      found[0].click();
      return { found: 1, tag: found[0].tagName, cls: (found[0].className || '').slice(0, 60) };
    });
  out.steps.saveClick = saveClick;
  await cms.waitForTimeout(12_000);
  out.steps.afterSaveClick = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return { hasRepeatConfirm: /重复确认/.test(norm(document.body.innerText)),
      dialogPresent: document.querySelectorAll('#popupLayer_sysConfirmPop').length };
  });
  out.steps.reqs = reqs;
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save11-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
