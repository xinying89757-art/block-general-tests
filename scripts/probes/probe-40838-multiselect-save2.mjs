// Probe v2 (writes ONE value to ONE existing fixture product): capture the
// save at the network level. Check 多选4-10, click 保存, record every
// request/response for 30s (URL/method/status), capture any toast/layer
// text, then re-read after 60s. Determines whether the save request fires,
// what the server says, and whether the value lands late.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const PROD_ID = 'ENULQuzRFljy'; // 测试产品A
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await session.context.newPage();
  const traffic = [];
  cms.on('request', (req) => {
    if (/prod|save|update/i.test(req.url())) traffic.push({ t: Date.now(), dir: 'req', method: req.method(), url: req.url().slice(0, 160) });
  });
  cms.on('response', (res) => {
    if (/prod|save|update/i.test(res.url())) traffic.push({ t: Date.now(), dir: 'res', status: res.status(), url: res.url().slice(0, 160) });
  });
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  traffic.length = 0;
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const input = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    if (!input.checked) input.click();
  });
  out.steps.clickedChecked = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const input = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    return input.checked;
  });
  const t0 = Date.now();
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    [...document.querySelectorAll('button, a, input[type="submit"], input[type="button"]')]
      .find((node) => node.getClientRects().length && /^(保存|提交)$/.test(norm(node.innerText || node.value)))?.click();
  });
  // Watch 30s: network + any toast/layer/dialog text.
  for (let i = 0; i < 60; i++) {
    await cms.waitForTimeout(500);
    const overlay = await cms.evaluate(() => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const layers = [...document.querySelectorAll('.layui-layer, [class*="layer"], [class*="toast"], [class*="msg"]')]
        .filter((el) => el.getClientRects().length)
        .map((el) => norm(el.innerText).slice(0, 120)).filter(Boolean);
      return { layers, hasRepeatConfirm: /重复确认/.test(norm(document.body.innerText)) };
    });
    if (overlay.layers.length || overlay.hasRepeatConfirm) {
      out.steps.overlayAt = { t: ((Date.now() - t0) / 1000).toFixed(1) + 's', ...overlay };
      break;
    }
  }
  out.steps.traffic = traffic.map((row) => ({ ...row, t: ((row.t - t0) / 1000).toFixed(1) + 's' }));
  out.steps.afterSave = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return { url: location.href, hasRepeatConfirm: /重复确认/.test(norm(document.body.innerText)) };
  });
  // Re-read after 60s (covers the known CMS sync delay).
  await cms.waitForTimeout(60_000);
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  out.steps.reread = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((i) => ['多选4-10', '多选8-10'].includes(norm([...(i.labels || [])].map((l) => l.innerText).join(' '))));
    return inputs.map((i) => ({ label: norm([...(i.labels || [])].map((l) => l.innerText).join(' ')), checked: i.checked }));
  });
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save2-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
