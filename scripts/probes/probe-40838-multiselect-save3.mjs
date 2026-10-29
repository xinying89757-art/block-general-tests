// Probe v3: what does /prod/doUpdate/verify return, and what does the page
// do after it? Captures the verify response body, console errors, and a
// 60s watch for the repeat-confirm dialog (polling, no early break).
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
  const consoleErrors = [];
  cms.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)); });
  cms.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));
  cms.on('response', async (res) => {
    if (/doUpdate\/verify/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 500); } catch { body = '<unreadable>'; }
      traffic.push({ status: res.status(), url: res.url().slice(0, 160), body });
    } else if (/prod/.test(res.url()) && res.request().method() !== 'GET') {
      traffic.push({ status: res.status(), method: res.request().method(), url: res.url().slice(0, 160) });
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
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    await cms.waitForTimeout(500);
    const state = await cms.evaluate(() => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const text = norm(document.body.innerText);
      const dialog = [...document.querySelectorAll('.layui-layer-dialog, .layui-layer')]
        .filter((el) => el.getClientRects().length)
        .map((el) => norm(el.innerText).slice(0, 150)).filter(Boolean);
      return { hasRepeatConfirm: /重复确认/.test(text), dialog };
    });
    const key = JSON.stringify(state);
    if (!seen.has(key)) {
      seen.add(key);
      out.steps[`watch_${((Date.now() - t0) / 1000).toFixed(1)}s`] = state;
    }
    if (state.hasRepeatConfirm) {
      await cms.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const btn = [...document.querySelectorAll('.layui-layer-btn0, button, a')]
          .find((b) => b.getClientRects().length && /^(确定|确认)$/.test(norm(b.innerText)));
        btn?.click();
      });
      out.steps.confirmClickedAt = ((Date.now() - t0) / 1000).toFixed(1) + 's';
      break;
    }
  }
  await cms.waitForTimeout(10_000);
  out.steps.traffic = traffic;
  out.steps.consoleErrors = consoleErrors.slice(0, 10);
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
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save3-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
