// Probe v16: the RUNNER's setProductFieldValues for 小何2, with the v15
// wrappers installed via addInitScript so they survive the runner's gotos
// (init script runs on every navigation; it polls for the page's save-chain
// functions and wraps them once per load). A concurrent poller drains
// window.__probeLog into Node every 500ms so the log survives the re-read
// loop's navigations. This distinguishes: verify callback not running /
// prodSubmit not called / prodSubmit early-return / getFieldSetting throwing
// / SMT.ajax(similarityJudge) never invoked.
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
  const cms = await openProdPage(session.context, config);
  await cms.addInitScript(() => {
    window.__probeLog = [];
    window.__wrapped = false;
    const log = (name, extra) => window.__probeLog.push({ at: new Date().toISOString(), name, extra: extra || '' });
    const tryWrap = () => {
      if (window.__wrapped) return;
      if (typeof window.prodSubmit !== 'function' || !window.SMT || typeof window.SMT.ajax !== 'function') return;
      const origSubmit = window.prodSubmit;
      window.prodSubmit = function () { log('prodSubmit'); return origSubmit.apply(this, arguments); };
      if (typeof window.getFieldSetting === 'function') {
        const orig = window.getFieldSetting;
        window.getFieldSetting = function () { log('getFieldSetting'); return orig.apply(this, arguments); };
      }
      if (typeof window.doSaveProdContent === 'function') {
        const orig = window.doSaveProdContent;
        window.doSaveProdContent = function () { log('doSaveProdContent'); return orig.apply(this, arguments); };
      }
      const origAjax = window.SMT.ajax;
      window.SMT.ajax = function (cfg) { log('SMT.ajax', (cfg && cfg.url) || ''); return origAjax.apply(this, arguments); };
      const origFunc = window.SMT.func;
      window.SMT.func = function (cfg) { log('SMT.func'); return origFunc.apply(this, arguments); };
      if (window.jQuery && typeof window.jQuery.openPopupConfirmLayer === 'function') {
        const orig = window.jQuery.openPopupConfirmLayer;
        window.jQuery.openPopupConfirmLayer = function (opts) { log('openPopupConfirmLayer', (opts && opts.titleInfo) || ''); return orig.apply(this, arguments); };
      }
      window.__wrapped = true;
      log('wrappers-installed');
    };
    setInterval(tryWrap, 100);
  });
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
  const drained = [];
  let seen = 0;
  let stop = false;
  const poller = (async () => {
    while (!stop) {
      const log = await cms.evaluate(() => (window.__probeLog || []).slice()).catch(() => []);
      for (let i = seen; i < log.length; i++) drained.push(log[i]);
      seen = log.length;
      await new Promise((r) => setTimeout(r, 500));
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
  out.steps.probeLog = drained;
  out.steps.reqs = reqs;
  out.steps.after = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save16-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
