// Probe v10: manual flow for 小何2 (NmKqGFoHbPJy), like v7 which worked
// for A. Real label click + real save click, capture EVERY /prod/ request
// (all methods) and the verify response, then dump page state after the
// save click (dialogs, toasts, errors, checkbox state). Decides whether
// the save flow even starts for 小何2, and if not, what stops it.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';

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
      try { body = (await res.text()).slice(0, 300); } catch { body = '<unreadable>'; }
      reqs.push({ at: new Date().toISOString(), responseFor: res.url().slice(0, 130), status: res.status(), body });
    }
  });
  cms.on('pageerror', (err) => reqs.push({ at: new Date().toISOString(), pageerror: String(err).slice(0, 200) }));
  cms.on('console', (msg) => { if (msg.type() === 'error') reqs.push({ at: new Date().toISOString(), consoleError: msg.text().slice(0, 200) }); });
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  out.steps.before = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((i) => ['多选4-10', '多选8-10'].includes(norm([...(i.labels || [])].map((l) => l.innerText).join(' '))));
    return inputs.map((i) => ({ label: norm([...(i.labels || [])].map((l) => l.innerText).join(' ')), checked: i.checked,
      cls: norm(i.className).slice(0, 60), visible: !!i.getClientRects().length,
      parentHtml: i.parentElement?.outerHTML.slice(0, 300) }));
  });
  await cms.locator('label', { hasText: '多选4-10' }).first().click({ timeout: 10_000 });
  out.steps.checkedAfterLabelClick = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('input[type="checkbox"]')]
      .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10').checked;
  });
  reqs.length = 0;
  const t0 = Date.now();
  await cms.locator('a.topBts_menu_save').first().click({ timeout: 10_000 });
  await cms.waitForTimeout(12_000);
  out.steps.afterSaveClick = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const bodyText = norm(document.body.innerText);
    return { hasRepeatConfirm: /重复确认/.test(bodyText),
      dialogPresent: document.querySelectorAll('#popupLayer_sysConfirmPop').length,
      bodyTail: bodyText.slice(-400) };
  });
  out.steps.reqs = reqs;
  out.steps.elapsed = ((Date.now() - t0) / 1000).toFixed(1) + 's';
  writeFileSync('hidden/probe-40838-multiselect-save10-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
