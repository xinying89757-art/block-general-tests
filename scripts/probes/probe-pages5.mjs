// Probe 5: finish creating a blank custom page (click 选取), then find the
// new page in the custom list. Creates ONE page on the test site; it stays
// as a fixture per the user's keep rule.
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
  await tpl.locator("text=空白").first().click();
  await page.waitForTimeout(1000);
  const confirm = tpl.locator("text=选取").first();
  log("confirm-visible", { visible: await confirm.isVisible().catch(() => false) });
  await confirm.click({ timeout: 5000 });
  await page.waitForTimeout(6000);
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  log("after-create", {
    url: page.url(),
    dialogsOpen: await page.locator(".backstage-dialog:visible").count(),
    canvas: await page.locator("iframe.backstage-pc-proview").count(),
  });
  // Reopen the page menu and list custom pages to find the new one.
  await page.getByText("页面:", { exact: true }).first().click();
  await page.waitForTimeout(2500);
  log("custom-list-after", await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll(".backstage-topToolbar-pageBox ul.backstage-topToolbar-menusubUl li a.name")]
      .map((a) => ({ name: norm(a.textContent), title: a.getAttribute("title"), pageurl: a.getAttribute("pageurl"), href: a.getAttribute("data-href") }));
  }));
  fs.mkdirSync('hidden', { recursive: true });
  await writeFile("hidden/probe-pages5.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
