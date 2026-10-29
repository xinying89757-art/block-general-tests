// Probe v9: same as v8 but for 小何2 (NmKqGFoHbPJy). De-risks the full
// re-run: if the runner's set works here, the suite's fixture-prep only
// has 产品4 creation left; if it fails, the traffic log diagnoses it
// without burning a 13-minute suite run.
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
  const posts = [];
  cms.on('request', (req) => {
    if (req.method() === 'POST' && /prod/.test(req.url())) {
      const data = req.postData() || '';
      posts.push({ at: new Date().toISOString(), url: req.url().slice(0, 110), len: data.length,
        hasOption: /option_911698/.test(data),
        optionSnippet: (data.match(/option_911698[^&]{0,30}/g) || []).join('|').slice(0, 80) });
    }
  });
  cms.on('response', async (res) => {
    if (res.request().method() === 'POST' && /prod\/new\/doUpdate/.test(res.url())) {
      let body = null;
      try { body = (await res.text()).slice(0, 150); } catch { body = '<unreadable>'; }
      posts.push({ at: new Date().toISOString(), responseFor: res.url().slice(0, 110), status: res.status(), body });
    }
  });
  out.steps.before = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  try {
    const after = await setProductFieldValues(cms, PROD_ID, { 'AUTOTEST-多选': '多选4-10' });
    out.steps.setResult = { ok: true, after };
  } catch (error) {
    out.steps.setResult = { ok: false, error: error.message };
  }
  out.steps.posts = posts;
  out.steps.after = await readProductFieldValues(cms, PROD_ID, ['AUTOTEST-多选']);
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save9-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
