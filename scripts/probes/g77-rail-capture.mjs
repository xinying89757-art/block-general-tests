// Read-only rail capture: hover/click-select instances only. Never saves,
// publishes, adds or deletes. Output is sanitized (no attribute values that
// look like tokens; text truncated).
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, gotoFreshTargetPage } from '../../src/editor.mjs';
import { RAIL } from '../../src/capabilities/rail.mjs';

const config = loadConfig();
const out = path.resolve(process.env.G77_OUT || 'reports/editor-capture-g77');
const targets = JSON.parse(process.env.G77_TARGETS); // [{blockId,settingId}]
await fs.mkdir(out, { recursive: true });
const session = await launchSession(config);
const result = { capturedAt: new Date().toISOString(), readOnly: true, targets: [] };
const sanitizeFn = (root) => {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script,style,svg,img[src^="data:"]').forEach((n) => n.remove());
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /token|cookie|auth|jwt|session/i.test(a.name + a.value)) el.removeAttribute(a.name);
      else if (a.name === 'style' || a.value.length > 200) el.setAttribute(a.name, a.value.slice(0, 200));
    }
    for (const t of [...el.childNodes]) if (t.nodeType === 3 && t.textContent.length > 80) t.textContent = t.textContent.slice(0, 80);
  }
  return clone.outerHTML;
};
async function snap(frame, page, t, phase) {
  const wraps = frame.locator(RAIL.wrap(t.blockId));
  const info = await wraps.evaluateAll((nodes, { settingId, sanitize, sels }) => {
    const fn = new Function('return ' + sanitize)();
    const has = (el) => [el, ...el.querySelectorAll('*')].some((n) => [...n.attributes].some((a) => /setting.?id/i.test(a.name) && a.value === settingId));
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return { visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none', rect: [r.x, r.y, r.width, r.height].map(Math.round), display: s.display, visibility: s.visibility, opacity: s.opacity }; };
    const w = nodes.find(has); if (!w) return { found: false, wrapCount: nodes.length };
    const rails = [...w.querySelectorAll(sels.rail)];
    const m = (sel) => [...w.querySelectorAll(sel)].map((e) => ({ cls: e.className?.toString?.() || '', tag: e.tagName, ...vis(e) }));
    return { found: true, wrapCount: nodes.length, wrapState: vis(w), wrapClass: w.className, railCount: rails.length,
      rails: rails.map((r) => ({ ...vis(r), html: fn(r).slice(0, 20000) })),
      matches: { colorPreferred: m(sels.colorIcon), widthPreferred: m(sels.widthIcon),
        widthFallback: m('[class*="telescopic"], [data-action*="width"], [aria-label*="宽度"], [title*="宽度"]'),
        colorFallback: m('[class*="operateColor"], [data-action*="color"], [aria-label*="配色"], [title*="配色"]'),
        colorPanel: m(sels.colorPanel), widthPanel: m(sels.widthPanel) },
      wrapHtml: fn(w).slice(0, 60000) };
  }, { settingId: t.settingId, sanitize: sanitizeFn.toString(), sels: { ...RAIL, wrap: undefined } });
  await page.screenshot({ path: path.join(out, `${t.blockId}-${phase}.png`) }).catch(() => {});
  return info;
}
try {
  const { page } = await openEditor(session.page, config);
  const sel = await gotoFreshTargetPage(page, { kind: 'system', id: process.env.G77_PAGE_ID, url: process.env.G77_PAGE_URL, blockId: targets[0].blockId });
  const frame = sel.frame;
  for (const t of targets) {
    const rec = { ...t, phases: {} };
    rec.phases.before = await snap(frame, page, t, 'before');
    const wrap = frame.locator(RAIL.wrap(t.blockId)).filter({ has: frame.locator(`[setting-id="${t.settingId}"],[data-setting-id="${t.settingId}"],[settingid="${t.settingId}"]`) });
    let target = (await wrap.count()) === 1 ? wrap : null;
    if (!target) { // fallback: find index via evaluate
      const idx = await frame.locator(RAIL.wrap(t.blockId)).evaluateAll((ns, id) => ns.findIndex((el) => [el, ...el.querySelectorAll('*')].some((n) => [...n.attributes].some((a) => /setting.?id/i.test(a.name) && a.value === id))), t.settingId);
      target = idx >= 0 ? frame.locator(RAIL.wrap(t.blockId)).nth(idx) : null;
    }
    if (target) {
      await target.scrollIntoViewIfNeeded({ timeout: 10000 }).catch((e) => { rec.scrollError = e.message; });
      await target.hover({ timeout: 10000 }).catch((e) => { rec.hoverError = e.message; });
      await page.waitForTimeout(800);
      rec.phases.hover = await snap(frame, page, t, 'hover');
      await target.click({ timeout: 10000, position: { x: 20, y: 20 } }).catch((e) => { rec.clickError = e.message; });
      await page.waitForTimeout(1200);
      rec.phases.selected = await snap(frame, page, t, 'selected');
    }
    result.targets.push(rec);
  }
} finally { await session.browser.close(); }
await fs.writeFile(path.join(out, 'capture.json'), JSON.stringify(result, null, 2));
console.log('written', path.join(out, 'capture.json'));
