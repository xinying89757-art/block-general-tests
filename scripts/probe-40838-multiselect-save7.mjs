// Probe v7 (decisive): full save flow the right way. Real label click,
// real save click, wait for #popupLayer_sysConfirmPop, click #confirmYes,
// capture the save POST payload (does it carry option_911698?) and its
// response, then re-read. If the value lands, the runner's bug is the 5s
// confirm poll (or its targeting); if the payload lacks the value, the
// checkbox state/serialization is the bug.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const PROD_ID = 'ENULQuzRFljy'; // 测试产品A
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await session.context.newPage();
  const saves = [];
  cms.on('request', (req) => {
    if (req.method() === 'POST' && /prod/.test(req.url()) && !/related|searchKeyword|similarityJudge/.test(req.url())) {
      const data = req.postData() || '';
      saves.push({ url: req.url().slice(0, 120), len: data.length,
        hasOption: /option_911698/.test(data),
        optionSnippet: (data.match(/option_911698[^&]{0,30}/g) || []).join('|').slice(0, 120) });
    }
  });
  cms.on('response', async (res) => {
    if (res.request().method() === 'POST' && /prod/.test(res.url()) && !/related|searchKeyword|similarityJudge/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 300); } catch { body = '<unreadable>'; }
      saves.push({ responseFor: res.url().slice(0, 120), status: res.status(), body });
    }
  });
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  await cms.locator('label', { hasText: '多选4-10' }).first().click({ timeout: 10_000 });
  out.steps.checked = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('input[type="checkbox"]')]
      .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10').checked;
  });
  const t0 = Date.now();
  await cms.locator('a.topBts_menu_save').first().click({ timeout: 10_000 });
  // Wait up to 30s for the confirm dialog, then click its #confirmYes.
  let dialogAt = null;
  for (let i = 0; i < 60; i++) {
    await cms.waitForTimeout(500);
    const found = await cms.locator('#popupLayer_sysConfirmPop').count();
    if (found) { dialogAt = ((Date.now() - t0) / 1000).toFixed(1) + 's'; break; }
  }
  out.steps.dialogAt = dialogAt;
  if (dialogAt) {
    await cms.locator('#confirmYes').click({ timeout: 10_000 });
    out.steps.confirmClickedAt = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    await cms.waitForTimeout(10_000);
  }
  out.steps.saves = saves;
  out.steps.afterSave = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return { url: location.href, hasRepeatConfirm: /重复确认/.test(norm(document.body.innerText)),
      dialogStillThere: document.querySelectorAll('#popupLayer_sysConfirmPop').length };
  });
  await cms.waitForTimeout(20_000);
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  out.steps.reread = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((i) => ['多选4-10', '多选8-10'].includes(norm([...(i.labels || [])].map((l) => l.innerText).join(' '))));
    return inputs.map((i) => ({ label: norm([...(i.labels || [])].map((l) => l.innerText).join(' ')), checked: i.checked }));
  });
  writeFileSync('hidden/probe-40838-multiselect-save7-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
