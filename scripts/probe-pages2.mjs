// Probe 2: system-page list + create-page dialog (read-only).
// Clicks the 系统页面 tab and dumps its items, then opens the 新建页面
// dialog, dumps its fields, and closes it WITHOUT submitting.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import { writeFile } from "node:fs/promises";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await page.getByText("页面:", { exact: true }).first().click();
  await page.waitForTimeout(2000);
  const panel = page.locator(".backstage-topToolbar-pageBox");
  await panel.locator(".backstage-tab-title span", { hasText: "系统页面" }).first().click();
  await page.waitForTimeout(2000);
  out.systemPages = await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll(".backstage-topToolbar-pageBox ul.backstage-topToolbar-menusubUl li a.name")]
      .map((a) => ({ name: norm(a.textContent), title: a.getAttribute("title"), pageurl: a.getAttribute("pageurl"), href: a.getAttribute("data-href") }));
  });
  // Back to the custom tab and open the create-page dialog.
  await panel.locator(".backstage-tab-title span", { hasText: "自定义页面" }).first().click();
  await page.waitForTimeout(1500);
  const createBtn = page.locator(".backstage-topToolbar-pageBox", { hasText: "新建页面" })
    .locator("text=新建页面").last();
  out.createButtonVisible = await createBtn.isVisible().catch(() => false);
  await createBtn.click({ timeout: 5000 }).catch((e) => { out.createClickError = e.message; });
  await page.waitForTimeout(2500);
  out.createDialog = await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const dialogs = [...document.querySelectorAll(".backstage-dialog, [class*=dialog]")]
      .filter((d) => d.offsetParent !== null || getComputedStyle(d).display !== "none");
    return dialogs.map((d) => ({
      cls: d.className,
      text: norm(d.innerText || "").slice(0, 600),
      inputs: [...d.querySelectorAll("input, select, textarea")].map((i) => ({
        tag: i.tagName, type: i.type, name: i.name, placeholder: i.placeholder, value: i.value,
      })),
      buttons: [...d.querySelectorAll("button, a, input[type=button], input[type=submit]")]
        .map((b) => norm(b.innerText || b.value || "")).filter(Boolean),
    }));
  });
  // Close the dialog without submitting: prefer a 取消/关闭 button.
  const closeBtn = page.locator(".backstage-dialog:visible").locator("text=/取消|关闭|×/").first();
  if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {});
  await page.waitForTimeout(1000);
  console.log(JSON.stringify(out, null, 2).slice(0, 8000));
  await writeFile("hidden/probe-pages2.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
