// Probe 9: after 选取, dump EVERYTHING: all dialogs (visible or not),
// overlay, URL, canvas content, current page name in the top bar.
// Then close leftover dialogs and list custom pages (visibility-filtered).
import fs from "node:fs";
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import { writeFile } from "node:fs/promises";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { steps: [] };
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(`--- ${step}`, JSON.stringify(data).slice(0, 2500)); };
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
  await page.waitForTimeout(8000);
  log("state-after-confirm", await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    return {
      url: location.href,
      dialogs: [...document.querySelectorAll(".backstage-dialog")].map((d) => ({
        cls: d.className, visible: d.offsetParent !== null, text: norm(d.innerText || "").slice(0, 150),
      })),
      overlays: [...document.querySelectorAll(".backstage-dialog-overlay")].map((el) => el.className),
      topBar: norm(document.querySelector(".backstage-topToolbar")?.innerText || "").slice(0, 200),
    };
  }));
  // Canvas content: what page is the editor showing now?
  const frame = page.frameLocator("iframe.backstage-pc-proview");
  log("canvas", { bodyText: (await frame.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300) });
  // Close any leftover dialog via its close button, then list pages.
  const closer = page.locator(".backstage-dialog:visible .backstage-dialog-close").first();
  if (await closer.isVisible().catch(() => false)) { await closer.click({ force: true }).catch(() => {}); await page.waitForTimeout(2000); }
  log("after-close", await page.evaluate(() => ({
    overlays: [...document.querySelectorAll(".backstage-dialog-overlay")].map((el) => el.className),
    visibleDialogs: [...document.querySelectorAll(".backstage-dialog")].filter((d) => d.offsetParent !== null).length,
  })));
  await page.getByText("页面:", { exact: true }).first().click({ timeout: 10000 }).catch(async () => {
    await page.getByText("页面:", { exact: true }).first().click({ force: true });
  });
  await page.waitForTimeout(2500);
  log("custom-list-after", await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const panel = document.querySelector(".backstage-topToolbar-pageBox");
    const visible = panel && panel.offsetParent !== null;
    return { panelVisible: visible, items: [...document.querySelectorAll(".backstage-topToolbar-pageBox ul.backstage-topToolbar-menusubUl li a.name")].filter((a) => a.offsetParent !== null).map((a) => ({ name: norm(a.textContent), href: a.getAttribute("data-href") })) };
  }));
  fs.mkdirSync('hidden', { recursive: true });
  await writeFile("hidden/probe-pages9.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
