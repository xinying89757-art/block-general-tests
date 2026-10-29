// Exploration 5: open the console's site switcher (top-left, next to the
// current site name) and list every site this account can switch to.
// Read-only: does not switch sites.
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
const browser = await firefox.launch({ proxy: proxyFromEnv() });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
  viewport: { width: 1600, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

await page.goto("https://www.leadong.com/phoenix2/composite/middle/platform/index.html", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(4000);

// The switcher is the header block showing the current site name + domain.
const switcher = page.locator("text=en-site22916177.ldmfyh.com").first();
await switcher.waitFor({ state: "visible", timeout: 20000 });
await switcher.click();
await page.waitForTimeout(3000);

await page.screenshot({ path: path.join(root, "screenshots", "switcher.png") });

const text = await page.locator("body").innerText().catch(() => "");
const idx = text.indexOf("40083596");
console.log("MENTIONS_40083596:", idx >= 0);
if (idx >= 0) console.log("CONTEXT:", JSON.stringify(text.slice(Math.max(0, idx - 300), idx + 300)));

const hits = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const attrs = [];
    for (const a of el.attributes || []) attrs.push(`${a.name}=${a.value}`);
    const joined = attrs.join(" ");
    if (/40083596|ldyjz|editSite/.test(joined)) {
      out.push({ tag: el.tagName, attrs: joined.slice(0, 320), text: (el.textContent || "").trim().slice(0, 80) });
    }
  }
  return out.slice(0, 30);
});
console.log("DOM_HITS:", JSON.stringify(hits, null, 1));

// Also dump any visible dropdown/popup text wholesale for manual reading.
const popups = await page.evaluate(() => {
  const sels = [".ant-dropdown", ".ant-popover", "[role='menu']", "[class*='switch']", "[class*='site-list']", "[class*='sitelist']"];
  const out = [];
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      const t = (el.textContent || "").trim();
      if (t) out.push({ sel: s, text: t.slice(0, 800) });
    }
  }
  return out.slice(0, 10);
});
console.log("POPUPS:", JSON.stringify(popups, null, 1));

await browser.close();
