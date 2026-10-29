// Probe v6: find the 重复确认 UI precisely. Real label click + real save
// click, wait for similarityJudge, then dump every element (any tag) whose
// text contains 重复 — smallest first — with tag/class/visibility/buttons
// and outerHTML. Also capture the similarityJudge request payload.
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
  const sim = [];
  cms.on('request', (req) => {
    if (/similarityJudge/.test(req.url())) {
      sim.push({ url: req.url().slice(0, 120), payload: (req.postData() || '').slice(0, 600) });
    }
  });
  cms.on('response', async (res) => {
    if (/similarityJudge/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 400); } catch { body = '<unreadable>'; }
      sim.push({ response: res.url().slice(0, 120), status: res.status(), body });
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
  await cms.locator('a.topBts_menu_save').first().click({ timeout: 10_000 });
  await cms.waitForTimeout(8_000);
  out.steps.similarityJudge = sim;
  out.steps.repeatConfirmHosts = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const all = [...document.querySelectorAll('body *')]
      .filter((el) => el.getClientRects().length && /重复/.test(norm(el.innerText || '')));
    // Smallest (innermost) hosts first.
    all.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    return all.slice(0, 6).map((el) => ({
      tag: el.tagName, cls: norm(el.className && el.className.baseVal !== undefined ? '' : el.className).slice(0, 100),
      id: el.id || '', text: norm(el.innerText).slice(0, 200),
      html: el.outerHTML.slice(0, 400),
      buttons: [...el.querySelectorAll('button, a, input[type="button"]')]
        .map((b) => ({ tag: b.tagName, text: norm(b.innerText || b.value).slice(0, 40), cls: norm(b.className).slice(0, 60) })),
    }));
  });
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save6-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
