// Probe v20: reproduce the 10-19 run's fixture-prep sequence with the
// runner's own functions, polling every 500ms for #popupLayerScreenLocker
// and any popup dialog text. Finds which step leaves the screen locker
// open (it blocked findProduct's search click for AUTOTEST-产品4).
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage, listCustomFields, readCustomFieldOptions, findProduct, readProductFieldValues } from '../../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await openProdPage(session.context, config);
  const events = [];
  let stop = false;
  const poller = (async () => {
    let last = '';
    while (!stop) {
      const s = await cms.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const locker = document.querySelector('#popupLayerScreenLocker');
        const layers = [...document.querySelectorAll('[id^="popupLayer"], [id="popWin"]')]
          .filter((el) => el.getClientRects().length)
          .map((el) => ({ id: el.id, text: norm(el.innerText).slice(0, 100) }));
        return { locker: locker ? locker.getClientRects().length > 0 : false, layers, url: location.href.slice(0, 90) };
      }).catch(() => ({ locker: false, layers: [], url: '<eval failed>' }));
      const key = JSON.stringify([s.locker, s.layers]);
      if (key !== last) { events.push({ at: new Date().toISOString().slice(11, 19), ...s }); last = key; }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { const r = await fn(); out.steps[name] = { ok: true, ms: Date.now() - t0, result: JSON.stringify(r)?.slice(0, 200) }; }
    catch (e) { out.steps[name] = { ok: false, ms: Date.now() - t0, error: e.message.slice(0, 300) }; throw e; }
  };
  try {
    await step('listCustomFields', () => listCustomFields(cms));
    for (const f of ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选']) {
      await step('readOptions:' + f, () => readCustomFieldOptions(cms, f));
    }
    for (const [name, id] of [['测试产品A', 'ENULQuzRFljy'], ['测试产品小何1', 'ApUgGkomaTfn'], ['测试产品小何2', 'NmKqGFoHbPJy']]) {
      await step('find:' + name, () => findProduct(cms, name));
      await step('read:' + name, () => readProductFieldValues(cms, id, ['测试单选按钮A', '测试下拉列表', 'AUTOTEST-多选']));
    }
    await step('find:AUTOTEST-产品4', () => findProduct(cms, 'AUTOTEST-产品4'));
  } catch (e) { out.steps.abortedAt = e.message.slice(0, 200); }
  stop = true;
  await poller;
  out.steps.lockerEvents = events;
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-screen-locker-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
