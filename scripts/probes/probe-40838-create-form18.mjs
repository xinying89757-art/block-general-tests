// Probe v18: the 添加产品 entry. Lists every [action=prod_new_add] /
// [data-action=prod_new_add] element, then clicks the one clickAction would
// pick (void(0) sidebar link when there are two) via DOM click, reports
// URL/page; if still on the list, retries with a real mouse click, then
// tries the other link. Also watches for popups/new pages.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';
import { openProdPage } from '../../src/cms.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await openProdPage(session.context);
  const popups = [];
  session.context.on('page', (p) => popups.push(p.url()));
  const listEntries = () => cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('[action="prod_new_add"], [data-action="prod_new_add"]')].map((el) => ({
      tag: el.tagName, href: el.getAttribute('href') || '', action: el.getAttribute('action') || el.getAttribute('data-action') || '',
      text: norm(el.innerText).slice(0, 40), visible: el.getClientRects().length > 0,
      rect: el.getClientRects().length ? [Math.round(el.getClientRects()[0].x), Math.round(el.getClientRects()[0].y)] : null,
    }));
  });
  out.entries = await listEntries();
  const state = () => cms.evaluate(() => ({
    url: location.href,
    head: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 150),
  }));
  // Click the void(0) one (clickAction's pick when there are two).
  out.domClick = await cms.evaluate(() => {
    const els = [...document.querySelectorAll('[action="prod_new_add"], [data-action="prod_new_add"]')]
      .filter((el) => el.getClientRects().length > 0);
    const target = els.find((el) => (el.getAttribute('href') || '') === 'javascript:void(0)') || els[0];
    if (!target) return { found: 0 };
    target.click();
    return { found: els.length, clickedHref: target.getAttribute('href') || '', text: (target.innerText || '').trim().slice(0, 30) };
  });
  await cms.waitForTimeout(8000);
  out.afterDomClick = await state();
  out.popupsAfterDom = popups.slice();
  if (/prod$|prod\?/.test(out.afterDomClick.url) && !/add|new/.test(out.afterDomClick.url)) {
    // Still on the list: try a real mouse click on the same element.
    out.mouseClick = await cms.evaluate(() => {
      const els = [...document.querySelectorAll('[action="prod_new_add"], [data-action="prod_new_add"]')]
        .filter((el) => el.getClientRects().length > 0);
      const target = els.find((el) => (el.getAttribute('href') || '') === 'javascript:void(0)') || els[0];
      if (!target) return { found: 0 };
      const r = target.getClientRects()[0];
      return { found: els.length, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (out.mouseClick.x) {
      await cms.mouse.click(out.mouseClick.x, out.mouseClick.y);
      await cms.waitForTimeout(8000);
      out.afterMouseClick = await state();
      out.popupsAfterMouse = popups.slice();
    }
  }
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-create-form18-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
