// Probe 10: finish the create flow — fill 页面设置 (name + URL) and submit.
// Creates ONE page "测试-47748" (/test-47748.html) on the test site; it stays.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import { writeFile } from "node:fs/promises";

const config = loadConfig();
const { browser, page, context } = await launchSession(config);
const out = { steps: [] };
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(`--- ${step}`, JSON.stringify(data).slice(0, 2500)); };
try {
  await openEditor(page, config);
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
  await page.waitForTimeout(5000);
  const settings = page.locator(".backstage-dialog:visible", { hasText: "页面设置" }).first();
  log("settings-dialog", await settings.evaluate((root) => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    return {
      inputs: [...root.querySelectorAll("input, select, textarea")].map((i) => ({
        tag: i.tagName, type: i.type, name: i.name, placeholder: i.placeholder, value: i.value, cls: i.className,
      })),
      buttons: [...root.querySelectorAll("button, a, input[type=button], input[type=submit]")].map((b) => norm(b.innerText || b.value || "")).filter(Boolean),
      labels: [...root.querySelectorAll("label")].map((l) => norm(l.innerText)).filter(Boolean).slice(0, 20),
    };
  }));
  // Fill by field name (stable): page.pageTitle = name, page.pageUrl = URL.
  await settings.locator('input[name="page.pageTitle"]').fill("测试-47748");
  await settings.locator('input[name="page.pageUrl"]').fill("/test-47748.html");
  log("filled", {
    name: await settings.locator('input[name="page.pageTitle"]').inputValue(),
    url: await settings.locator('input[name="page.pageUrl"]').inputValue(),
  });
  const buttons = await settings.locator("button, a, input[type=button], input[type=submit]").allTextContents();
  log("settings-buttons", { buttons: buttons.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 12) });
  const submit = settings.locator("text=/^保存$|^确定$|^完成$|^创建$/").first();
  log("submit-visible", { visible: await submit.isVisible().catch(() => false), text: await submit.innerText().catch(() => "") });
  await submit.click({ timeout: 5000 });
  await page.waitForTimeout(6000);
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  log("after-submit", {
    url: page.url(),
    topBar: await page.evaluate(() => (document.querySelector(".backstage-topToolbar")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 150)),
    visibleDialogs: await page.locator(".backstage-dialog:visible").count(),
  });
  await page.getByText("页面:", { exact: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  log("custom-list-after", await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll(".backstage-topToolbar-pageBox ul.backstage-topToolbar-menusubUl li a.name")]
      .filter((a) => a.offsetParent !== null)
      .map((a) => ({ name: norm(a.textContent), pageurl: a.getAttribute("pageurl"), href: a.getAttribute("data-href") }));
  }));
  await writeFile("hidden/probe-pages10.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
