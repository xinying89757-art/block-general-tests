// Probe 4: system-page list selector + finish the create-page flow
// (template 空白). Creates ONE page on the test site; the page stays as a
// fixture per the user's keep rule. Stops after creation and reports the
// new page's name/url; rename + add-block are a later step.
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
  await page.locator(".backstage-topToolbar-pageBox .backstage-tab-title span", { hasText: "系统页面" }).first().click();
  await page.waitForTimeout(2500);
  log("system-tab", await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const panel = document.querySelector(".backstage-topToolbar-pageBox");
    const prod = [...panel.querySelectorAll("*")].find((el) => norm(el.textContent) === "Products" && el.children.length === 0);
    if (!prod) return { found: false };
    let container = prod;
    for (let i = 0; i < 6 && container.parentElement; i++) {
      container = container.parentElement;
      if (container.querySelectorAll("a").length >= 3) break;
    }
    return {
      found: true,
      containerTag: container.tagName, containerCls: container.className,
      items: [...container.querySelectorAll("a")].map((a) => ({ name: norm(a.textContent), title: a.getAttribute("title"), pageurl: a.getAttribute("pageurl"), href: a.getAttribute("data-href") })),
    };
  }));
  // Back to custom tab and create a blank page via editor 3.0.
  await page.locator(".backstage-topToolbar-pageBox .backstage-tab-title span", { hasText: "自定义页面" }).first().click();
  await page.waitForTimeout(1500);
  await page.locator(".backstage-topToolbar-pageBox").locator("text=新建页面").last().click();
  await page.waitForTimeout(2500);
  const dlg = page.locator(".backstage-dialog:visible", { hasText: "新建页面" }).first();
  await dlg.locator("text=网页编辑器3.0").first().click();
  await page.waitForTimeout(2500);
  const tpl = page.locator(".backstage-dialog:visible", { hasText: "新建页面" }).first();
  log("template-dialog", { text: (await tpl.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400) });
  const blank = tpl.locator("text=空白").first();
  log("blank-visible", { visible: await blank.isVisible().catch(() => false) });
  await blank.click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  log("after-blank", {
    url: page.url(),
    dialogs: await page.locator(".backstage-dialog:visible").allTextContents().then((t) => t.map((x) => x.replace(/\s+/g, " ").slice(0, 200))),
    canvas: await page.locator("iframe.backstage-pc-proview").count(),
  });
  fs.mkdirSync('hidden', { recursive: true });
  await writeFile("hidden/probe-pages4.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
