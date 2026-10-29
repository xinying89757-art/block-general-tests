// Probe v13: call the REAL runner setProductFieldValues for 小何2 with the
// NEW code (openProduct waits 'load', in-DOM check) while a background
// poller records a timeline (dialog presence + checkbox state every 500ms)
// and a request listener records all /prod/ traffic with timestamps.
// This pins down exactly where the runner's set fails for 小何2.
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
    if (/prod/.test(req.url())) {
      reqs.push({ at: new Date().toISOString(), method: req.method(), url: req.url().slice(0, 120),
        len: (req.postData() || '').length, hasOption: /option_911698/.test(req.postData() || '') });
    }
  });
  cms.on('response', async (res) => {
    if (/verify|similarityJudge|doUpdate/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 200); } catch { body = '<unreadable>'; }
      reqs.push({ at: new Date().toISOString(), responseFor: res.url().slice(0, 120), status: res.status(), body });
    }
  });
  out.steps.before = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  const timeline = [];
  let stop = false;
  const t0 = Date.now();
  const poller = (async () => {
    while (!stop) {
      const state = await cms.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const input = [...document.querySelectorAll('input[type="checkbox"]')]
          .find((i) => norm([...(i.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
        return { dialog: document.querySelectorAll('#popupLayer_sysConfirmPop').length,
          checked: input ? input.checked : null, url: location.href.slice(0, 100) };
      }).catch(() => ({ dialog: -1, checked: null, url: '<evaluate failed>' }));
      timeline.push({ at: ((Date.now() - t0) / 1000).toFixed(1) + 's', ...state });
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
  out.steps.timeline = timeline;
  out.steps.reqs = reqs;
  out.steps.after = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save13-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
