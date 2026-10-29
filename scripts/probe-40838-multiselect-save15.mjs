// Probe v15: replicate v11's manual flow (which worked) for 小何2, but with
// wrappers installed on the page's own save chain BEFORE the save click:
// prodSubmit, getFieldSetting, doSaveProdContent, SMT.ajax, $.openPopupConfirmLayer.
// The wrappers log every call into window.__probeLog. If the chain dies
// again, the log shows the exact last function that ran.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';
import { openProdPage, readProductFieldValues } from '../src/cms.mjs';

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
  out.steps.before = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  // Open the edit page fresh (like v11), wait, check the multi-select box.
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`, { waitUntil: 'domcontentloaded' });
  await cms.waitForTimeout(3000);
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
    const target = inputs.find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    if (!target) throw new Error('multi-select checkbox not found');
    target.click();
  });
  out.steps.checked = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
    const target = inputs.find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    return target ? target.checked : null;
  });
  // Install wrappers on the page's own save chain.
  out.steps.wrapped = await cms.evaluate(() => {
    window.__probeLog = [];
    const log = (name, extra) => window.__probeLog.push({ at: new Date().toISOString(), name, extra: extra || '' });
    const installed = {};
    if (typeof window.prodSubmit === 'function') {
      const orig = window.prodSubmit;
      window.prodSubmit = function () { log('prodSubmit'); return orig.apply(this, arguments); };
      installed.prodSubmit = true;
    }
    if (typeof window.getFieldSetting === 'function') {
      const orig = window.getFieldSetting;
      window.getFieldSetting = function () { log('getFieldSetting'); return orig.apply(this, arguments); };
      installed.getFieldSetting = true;
    }
    if (typeof window.doSaveProdContent === 'function') {
      const orig = window.doSaveProdContent;
      window.doSaveProdContent = function () { log('doSaveProdContent'); return orig.apply(this, arguments); };
      installed.doSaveProdContent = true;
    }
    if (window.SMT && typeof window.SMT.ajax === 'function') {
      const orig = window.SMT.ajax;
      window.SMT.ajax = function (cfg) { log('SMT.ajax', (cfg && cfg.url) || JSON.stringify(cfg).slice(0, 80)); return orig.apply(this, arguments); };
      installed['SMT.ajax'] = true;
    }
    if (window.SMT && typeof window.SMT.func === 'function') {
      const orig = window.SMT.func;
      window.SMT.func = function (cfg) { log('SMT.func', (cfg && cfg.func && cfg.func.name) || JSON.stringify(Object.keys(cfg || {})).slice(0, 80)); return orig.apply(this, arguments); };
      installed['SMT.func'] = true;
    }
    if (window.jQuery && typeof window.jQuery.openPopupConfirmLayer === 'function') {
      const orig = window.jQuery.openPopupConfirmLayer;
      window.jQuery.openPopupConfirmLayer = function (opts) { log('openPopupConfirmLayer', (opts && (opts.titleInfo || '')) + ' | ' + ((opts && opts.textInfo) || '').slice(0, 80)); return orig.apply(this, arguments); };
      installed.openPopupConfirmLayer = true;
    }
    return installed;
  });
  // Click save (DOM click, like v11 and the runner).
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, a, input[type="submit"], input[type="button"]')]
      .filter((el) => el.offsetParent !== null && /保存|提交/.test(norm(el.innerText || el.value || '')));
    if (candidates.length !== 1) throw new Error('save candidates: ' + candidates.length);
    candidates[0].click();
  });
  await cms.waitForTimeout(15000);
  out.steps.probeLog = await cms.evaluate(() => window.__probeLog || []);
  out.steps.dialog = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const layers = [...document.querySelectorAll('[id^="popupLayer"], [id="popWin"]')]
      .filter((el) => el.getClientRects().length)
      .map((el) => ({ id: el.id, text: norm(el.innerText).slice(0, 120) }));
    return layers;
  });
  out.steps.reqs = reqs;
  out.steps.after = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  writeFileSync('hidden/probe-40838-multiselect-save15-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
