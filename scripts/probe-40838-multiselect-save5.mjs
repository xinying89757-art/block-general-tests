// Probe v5: do it the way a human does — real mouse clicks on the label and
// on 保存, precise dialog handling, and capture EVERY POST (method/URL/
// payload snippet/response) for 60s after the save click. Then re-read.
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
  const posts = [];
  cms.on('request', (req) => {
    if (req.method() === 'POST') {
      const data = req.postData() || '';
      posts.push({ url: req.url().slice(0, 140), len: data.length,
        hasOption: /option_911698/.test(data),
        snippet: (data.match(/option_911698[^&]{0,30}/g) || []).join('|').slice(0, 120),
        tail: data.slice(-120) });
    }
  });
  cms.on('response', async (res) => {
    if (res.request().method() === 'POST' && /prod/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 200); } catch { body = '<unreadable>'; }
      posts.push({ responseFor: res.url().slice(0, 140), status: res.status(), body });
    }
  });
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  // Real mouse click on the label (native label behavior + real events).
  const label = cms.locator('label', { hasText: '多选4-10' }).first();
  out.steps.labelCount = await cms.locator('label', { hasText: '多选4-10' }).count();
  await label.click({ timeout: 10_000 });
  out.steps.checkedAfterLabelClick = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const input = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    return input.checked;
  });
  posts.length = 0;
  const t0 = Date.now();
  await cms.locator('a.topBts_menu_save').first().click({ timeout: 10_000 });
  // Watch 60s for the repeat-confirm text; click the button inside the
  // element that contains it (any markup, not just .layui-layer).
  let dialogAction = null;
  for (let i = 0; i < 120; i++) {
    await cms.waitForTimeout(500);
    dialogAction = await cms.evaluate(() => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const host = [...document.querySelectorAll('div, section, form')]
        .filter((el) => el.getClientRects().length && /重复确认/.test(norm(el.innerText))
          && ![...el.children].some((child) => /重复确认/.test(norm(child.innerText))));
      if (!host.length) return null;
      const btn = [...host[0].querySelectorAll('button, a')]
        .find((b) => /^(确定|确认)$/.test(norm(b.innerText)));
      if (!btn) return { hostFound: true, btnFound: false, hostText: norm(host[0].innerText).slice(0, 200) };
      btn.click();
      return { hostFound: true, btnFound: true, btnText: norm(btn.innerText), hostText: norm(host[0].innerText).slice(0, 200) };
    });
    if (dialogAction?.btnFound) break;
    if (dialogAction && !dialogAction.btnFound) break;
  }
  out.steps.dialogAction = { ...dialogAction, at: ((Date.now() - t0) / 1000).toFixed(1) + 's' };
  await cms.waitForTimeout(15_000);
  out.steps.posts = posts;
  out.steps.afterSave = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return { url: location.href, hasRepeatConfirm: /重复确认/.test(norm(document.body.innerText)) };
  });
  await cms.waitForTimeout(30_000);
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  out.steps.reread = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((i) => ['多选4-10', '多选8-10'].includes(norm([...(i.labels || [])].map((l) => l.innerText).join(' '))));
    return inputs.map((i) => ({ label: norm([...(i.labels || [])].map((l) => l.innerText).join(' ')), checked: i.checked }));
  });
  writeFileSync('hidden/probe-40838-multiselect-save5-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
