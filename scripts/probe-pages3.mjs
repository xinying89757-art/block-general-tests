// Probe 3: tab switching (which list is visible per tab) + create a new
// custom page via 编辑器3.0. Stops with the new page open; does NOT rename
// or add a block yet. The created page is a real test fixture and stays
// (user decision: pages and blocks are kept).
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import { writeFile } from "node:fs/promises";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { steps: [] };
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(`--- ${step}`, JSON.stringify(data).slice(0, 1500)); };
try {
  ({ page } = await openEditor(page, config));
  await page.getByText("页面:", { exact: true }).first().click();
  await page.waitForTimeout(2000);
  const dumpTabs = () => page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const panel = document.querySelector(".backstage-topToolbar-pageBox");
    const tabs = [...panel.querySelectorAll(".backstage-tab-title span")].map((s) => ({ text: norm(s.textContent), on: s.classList.contains("on") }));
    const lists = [...panel.querySelectorAll("ul.backstage-topToolbar-menusubUl")].map((ul) => ({
      visible: ul.offsetParent !== null,
      count: ul.querySelectorAll("li a.name").length,
      names: [...ul.querySelectorAll("li a.name")].map((a) => norm(a.textContent)).slice(0, 25),
    }));
    return { tabs, lists, hasProducts: norm(panel.innerText || "").includes("Products") };
  });
  log("tabs-initial", await dumpTabs());
  await page.locator(".backstage-topToolbar-pageBox .backstage-tab-title span", { hasText: "系统页面" }).first().click();
  await page.waitForTimeout(2500);
  log("tabs-after-system-click", await dumpTabs());
  // Back to custom tab, then create a new page via editor 3.0.
  await page.locator(".backstage-topToolbar-pageBox .backstage-tab-title span", { hasText: "自定义页面" }).first().click();
  await page.waitForTimeout(1500);
  const panel = page.locator(".backstage-topToolbar-pageBox");
  await panel.locator("text=新建页面").last().click();
  await page.waitForTimeout(2500);
  log("after-create-click", { dialogs: await page.locator(".backstage-dialog:visible").allTextContents().then((t) => t.map((x) => x.slice(0, 200))) });
  // In the 新建页面 dialog, choose 编辑器搭建页面 / 网页编辑器3.0.
  const dlg = page.locator(".backstage-dialog:visible", { hasText: "新建页面" }).first();
  const opt30 = dlg.locator("text=网页编辑器3.0").first();
  log("opt30-visible", { visible: await opt30.isVisible().catch(() => false) });
  await opt30.click({ timeout: 5000 });
  await page.waitForTimeout(2500);
  log("after-choose-3.0", { dialogs: await page.locator(".backstage-dialog:visible").allTextContents().then((t) => t.map((x) => x.slice(0, 300))) });
  // 选择网页编辑器 dialog: click the 创建页面 button under 网页编辑器3.0.
  const chooseDlg = page.locator(".backstage-dialog:visible", { hasText: "选择网页编辑器" }).first();
  const createBtn = chooseDlg.locator(".backstage-dialog-cont", { hasText: "网页编辑器3.0" }).locator("text=创建页面").first();
  log("create-btn-visible", { visible: await createBtn.isVisible().catch(() => false) });
  await createBtn.click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  log("after-create", {
    url: page.url(),
    pageLabel: await page.getByText("页面:", { exact: true }).first().textContent().catch(() => null),
    canvasAttached: await page.locator("iframe.backstage-pc-proview").count(),
  });
  await writeFile("hidden/probe-pages3.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
