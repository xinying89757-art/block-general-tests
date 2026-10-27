// Probe 7: create a blank custom page, clicking the right template card.
// Dumps the template dialog structure first, then selects the blank-page
// card ("空白 + 添加空白页"), confirms with 选取, and checks the new page.
// Creates ONE page on the test site; it stays as a fixture.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
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
  log("template-cards", await tpl.evaluate((root) => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    // Template cards: elements containing 添加空白页 / template names.
    return [...root.querySelectorAll("*")].filter((el) => norm(el.textContent).includes("添加空白页") && el.children.length <= 3)
      .map((el) => ({ tag: el.tagName, cls: el.className, text: norm(el.textContent).slice(0, 60) }));
  }));
  const card = tpl.locator("text=添加空白页").first();
  log("card-visible", { visible: await card.isVisible().catch(() => false) });
  await card.click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  log("after-card-click", { dialogText: (await tpl.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300) });
  await tpl.locator("text=选取").first().click({ timeout: 5000 });
  // Poll for the dialog to close (up to 30s) instead of a fixed wait.
  let closed = false;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    if (await tpl.isHidden().catch(() => true)) { closed = true; break; }
  }
  log("after-confirm", { dialogClosed: closed, url: page.url(), canvas: await page.locator("iframe.backstage-pc-proview").count() });
  // List custom pages to find the new one.
  try {
    await page.getByText("页面:", { exact: true }).first().click({ timeout: 10000 });
    await page.waitForTimeout(2500);
    log("custom-list-after", await page.evaluate(() => {
      const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
      return [...document.querySelectorAll(".backstage-topToolbar-pageBox ul.backstage-topToolbar-menusubUl li a.name")]
        .map((a) => ({ name: norm(a.textContent), title: a.getAttribute("title"), pageurl: a.getAttribute("pageurl"), href: a.getAttribute("data-href") }));
    }));
  } catch (e) { log("list-pages-error", { message: e.message.slice(0, 300) }); }
  await writeFile("hidden/probe-pages7.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
