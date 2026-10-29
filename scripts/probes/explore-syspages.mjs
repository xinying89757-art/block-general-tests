// Exploration 9: list the editor's 系统页面 (system pages) entries from the
// top page selector. Read-only.
import { firefox } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

function proxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw) return undefined;
  const u = new URL(raw);
  return { server: `${u.protocol}//${u.host}` };
}

const ACCOUNT = process.env.PLAYWRIGHT_USERNAME || "";
const EDIT = process.env.EDIT_SITE_URL || process.env.PLAYWRIGHT_EDIT_SITE_URL;

const browser = await firefox.launch({ proxy: proxyFromEnv() });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
  viewport: { width: 1600, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

await page.goto(EDIT, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(5000);

const know = page.locator("text=我知道了").first();
if (await know.isVisible().catch(() => false)) await know.click().catch(() => {});
await page.waitForTimeout(800);

await page.locator("text=页面:").first().click();
await page.waitForTimeout(2000);

const sysTab = page.locator("text=系统页面").first();
await sysTab.click();
await page.waitForTimeout(2500);

await page.screenshot({ path: path.join(root, "screenshots", "syspages.png") });

const items = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("li, [class*='item'], [class*='page']")) {
    const t = (el.textContent || "").trim();
    if (t && t.length <= 50 && el.offsetParent !== null && el.children.length <= 4) out.push(t);
  }
  return [...new Set(out)].slice(0, 60);
});
console.log("VISIBLE_ITEMS:", JSON.stringify(items, null, 1));

await browser.close();
