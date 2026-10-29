// Probe 8: after creating a blank page, inspect the lingering overlay and
// list custom pages (force-click the menu if the overlay still intercepts).
// Creates ONE page on the test site if the previous attempt did not; it stays.
import fs from "node:fs";
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import { writeFile } from "node:fs/promises";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { steps: [] };
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(`--- ${step}`, JSON.stringify(data).slice(0, 2000)); };
try {
  ({ page } = await openEditor(page, config));
  await page.getByText("页面:", { exact: true }).first().click();
  await page.waitForTimeout(2000);
  await page.locator(".backstage-topToolbar-pageBox").locator("text=新建页面").last().click();
  await page.waitForTimeout(2500);
  const dlg = page.locator(".backstage-dialog:visible", { hasText: "新建页面" }).first();
  await dlg.locator("text=网页编辑器3.0").first().click();
  await page.waitForTimeout(2500);
  const tpl = page.locator(".backstage-dialog:visible", { hasText: "新建页面" }).first();
  await tpl.locator("text=添加空白页").first().click();
  await page.waitForTimeout(1500);
  await tpl.locator("text=选取").first().click({ timeout: 5000 });
  await page.waitForTimeout(15000);
  log("overlay-state", await page.evaluate(() => {
    const cs = (el) => { const s = getComputedStyle(el); return { display: s.display, visibility: s.visibility, opacity: s.opacity, pointerEvents: s.pointerEvents }; };
    return {
      overlays: [...document.querySelectorAll(".backstage-dialog-overlay")].map((el) => ({ cls: el.className, ...cs(el) })),
      visibleDialogs: [...document.querySelectorAll(".backstage-dialog")].filter((d) => d.offsetParent !== null).map((d) => d.className),
      pageLabelClickable: (() => { const el = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "页面:"); if (!el) return null; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return top ? `${top.tagName}.${top.className}` : null; })(),
    };
  }));
  // Open the menu with a force click (overlay is a transparent leftover).
  await page.getByText("页面:", { exact: true }).first().click({ force: true, timeout: 10000 });
  await page.waitForTimeout(2500);
  log("custom-list-after", await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll(".backstage-topToolbar-pageBox ul.backstage-topToolbar-menusubUl li a.name")]
      .map((a) => ({ name: norm(a.textContent), title: a.getAttribute("title"), pageurl: a.getAttribute("pageurl"), href: a.getAttribute("data-href") }));
  }));
  fs.mkdirSync('hidden', { recursive: true });
  await writeFile("hidden/probe-pages8.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
