// Exploration 8: in the TARGET site editor, find how to navigate to the
// "products" system page: dump the top page selector options and the left
// 页面 (pages) panel contents. Read-only (no page switch yet).
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

// Dismiss the translation notice popup if present.
const know = page.locator("text=我知道了").first();
if (await know.isVisible().catch(() => false)) await know.click().catch(() => {});
await page.waitForTimeout(1000);

// Inspect the top page selector: native select? custom dropdown?
const selects = await page.evaluate(() => {
  const out = [];
  for (const s of document.querySelectorAll("select")) {
    out.push({
      cls: (s.className || "").slice(0, 60),
      options: [...s.options].map((o) => ({ text: o.textContent.trim(), value: o.value, selected: o.selected })),
    });
  }
  return out;
});
console.log("SELECTS:", JSON.stringify(selects, null, 1));

// Top bar also shows a custom page dropdown ("页面: Home"); click it.
const pageBox = page.locator("text=页面:").first();
await pageBox.click().catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(root, "screenshots", "pages-dropdown.png") });
const ddText = await page.evaluate(() => {
  const pops = [...document.querySelectorAll("[class*='dropdown'], [class*='menu'], [class*='pop'], [role='listbox'], [class*='select']")]
    .filter((e) => e.offsetParent !== null)
    .map((e) => (e.textContent || "").trim().slice(0, 500))
    .filter(Boolean);
  return [...new Set(pops)].slice(0, 12);
});
console.log("DROPDOWN_TEXTS:", JSON.stringify(ddText, null, 1));

await browser.close();
