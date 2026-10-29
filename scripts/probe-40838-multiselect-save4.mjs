// Probe v4: capture the /prod/new/update POST payload + response body, and
// click the repeat-confirm dialog's OWN button (inside the layer that
// contains 重复确认). Then re-read. Decides: client serialization vs server.
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
  const updates = [];
  cms.on('request', (req) => {
    if (/new\/update/.test(req.url())) {
      const data = req.postData() || '';
      updates.push({ url: req.url().slice(0, 120), method: req.method(),
        hasOption911698: /option_911698/.test(data),
        optionSnippet: (data.match(/option_911698[^&]{0,40}/g) || []).slice(0, 4),
        payloadLen: data.length, payloadTail: data.slice(-300) });
    }
  });
  cms.on('response', async (res) => {
    if (/new\/update/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 400); } catch { body = '<unreadable>'; }
      updates.push({ responseFor: res.url().slice(0, 120), status: res.status(), body });
    }
  });
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const input = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    if (!input.checked) input.click();
  });
  const t0 = Date.now();
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    [...document.querySelectorAll('button, a, input[type="submit"], input[type="button"]')]
      .find((node) => node.getClientRects().length && /^(保存|提交)$/.test(norm(node.innerText || node.value)))?.click();
  });
  // Wait for the dialog that contains 重复确认, then click ITS button.
  let clicked = null;
  for (let i = 0; i < 60; i++) {
    await cms.waitForTimeout(500);
    clicked = await cms.evaluate(() => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const layer = [...document.querySelectorAll('.layui-layer')]
        .find((el) => el.getClientRects().length && /重复确认/.test(norm(el.innerText)));
      if (!layer) return null;
      const btn = [...layer.querySelectorAll('button, a')]
        .find((b) => /^(确定|确认)$/.test(norm(b.innerText)));
      if (!btn) return { layerFound: true, btnFound: false, layerText: norm(layer.innerText).slice(0, 200) };
      btn.click();
      return { layerFound: true, btnFound: true, btnText: norm(btn.innerText), layerText: norm(layer.innerText).slice(0, 200) };
    });
    if (clicked?.btnFound) break;
    if (clicked && !clicked.btnFound) break;
  }
  out.steps.dialogClick = { ...clicked, at: ((Date.now() - t0) / 1000).toFixed(1) + 's' };
  await cms.waitForTimeout(10_000);
  out.steps.updates = updates;
  out.steps.afterSave = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return { url: location.href, hasRepeatConfirm: /重复确认/.test(norm(document.body.innerText)),
      dialogOpen: [...document.querySelectorAll('.layui-layer')].some((el) => el.getClientRects().length && /重复确认/.test(norm(el.innerText))) };
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
  writeFileSync('hidden/probe-40838-multiselect-save4-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
