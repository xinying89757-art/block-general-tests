// Probe v14: reproduce the v13 failure (runner setProductFieldValues for
// 小何2) while a background poller snapshots the page state every 1s:
// ALL popup layers (any id, not just sysConfirmPop), loading overlay,
// visible inline validation hints, warn-word globals, page errors.
// If prodSubmit() early-returns on a validation, its inline hint stays
// visible and this catches which one. If a non-sysConfirmPop dialog is
// waiting, this catches it too.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage, setProductFieldValues, readProductFieldValues } from '../../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const PROD_ID = 'NmKqGFoHbPJy'; // 测试产品小何2
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await openProdPage(session.context);
  const reqs = [];
  cms.on('request', (req) => {
    if (/verify|similarityJudge|doUpdate/.test(req.url())) {
      reqs.push({ at: new Date().toISOString(), method: req.method(), url: req.url().slice(0, 110) });
    }
  });
  cms.on('response', async (res) => {
    if (/verify|similarityJudge|doUpdate/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 120); } catch { body = '<unreadable>'; }
      reqs.push({ at: new Date().toISOString(), responseFor: res.url().slice(0, 110), status: res.status(), body });
    }
  });
  cms.on('pageerror', (err) => reqs.push({ at: new Date().toISOString(), pageerror: String(err).slice(0, 250) }));
  cms.on('console', (msg) => { if (msg.type() === 'error') reqs.push({ at: new Date().toISOString(), consoleError: msg.text().slice(0, 250) }); });
  out.steps.before = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  const snaps = [];
  let stop = false;
  const t0 = Date.now();
  const poller = (async () => {
    while (!stop) {
      const snap = await cms.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        const layers = [...document.querySelectorAll('[id^="popupLayer"], [id="popWin"], .layui-layer')]
          .filter(vis).map((el) => ({ id: el.id || el.className, text: norm(el.innerText).slice(0, 120) }));
        const hints = [...document.querySelectorAll('.skuNotNull, .skuNotNUMOne, .skuNotNum, .skuNotNUMLimit, .skuNotMorePrice, .wholesale_price_table_wrong, .wrong2')]
          .filter(vis).map((el) => ({ cls: norm(el.className).slice(0, 40), text: norm(el.innerText).slice(0, 80) }));
        const loading = [...document.querySelectorAll('.backstage-loading-effect, .backstage-dialog-overlay')]
          .filter(vis).map((el) => norm(el.className));
        let warns = null;
        try { warns = { w: (window.warnWordArray || []).length, a: (window.warnWordArrayA || []).length, b: (window.warnWordArrayB || []).length }; } catch { warns = 'n/a'; }
        const input = [...document.querySelectorAll('input[type="checkbox"]')]
          .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
        return { layers, hints, loading, warns, checked: input ? input.checked : null };
      }).catch(() => ({ layers: [], hints: [], loading: [], warns: 'eval-failed', checked: null }));
      snaps.push({ at: ((Date.now() - t0) / 1000).toFixed(1) + 's', ...snap });
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  try {
    const after = await setProductFieldValues(cms, PROD_ID, { 'AUTOTEST-多选': '多选4-10' });
    out.steps.setResult = { ok: true, after };
  } catch (error) {
    out.steps.setResult = { ok: false, error: error.message };
  } finally {
    stop = true;
    await poller;
  }
  out.steps.snaps = snaps;
  out.steps.reqs = reqs;
  out.steps.after = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save14-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
