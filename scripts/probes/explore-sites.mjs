// Exploration 6: dump the full site-switcher list (names + any identifying
// attributes), scrolling the list to catch items below the fold. Read-only.
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
await page.locator("text=en-site22916177.ldmfyh.com").first().click();
await page.waitForTimeout(2500);

async function dumpList(round) {
  const items = await page.evaluate(() => {
    const out = [];
    // Site entries are the clickable rows in the left panel; find leaf-ish
    // elements whose text looks like a site name (starts with # or 【).
    for (const el of document.querySelectorAll("div, li, a, span")) {
      const t = (el.textContent || "").trim();
      if ((t.startsWith("#") || t.startsWith("【")) && t.length <= 60 && el.children.length <= 3) {
        const attrs = [];
        for (const a of el.attributes || []) attrs.push(`${a.name}=${String(a.value).slice(0, 120)}`);
        out.push({ text: t, tag: el.tagName, cls: (el.className || "").toString().slice(0, 80), attrs: attrs.join(" ").slice(0, 300) });
      }
    }
    // de-dup by text
    const seen = new Set();
    return out.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
  });
  console.log(`ROUND ${round} SITES:`, JSON.stringify(items, null, 1));
}

await dumpList(1);

// Scroll the switcher list container (the scrollable ancestor of a site row).
await page.evaluate(() => {
  const el = [...document.querySelectorAll("div, li, a, span")].find(
    (e) => (e.textContent || "").trim() === "#xujiying 4.0-测试图册",
  );
  let node = el;
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 10) {
      node.scrollTop = node.scrollHeight;
      return;
    }
    node = node.parentElement;
  }
});
await page.waitForTimeout(2000);
await dumpList(2);
await page.screenshot({ path: path.join(root, "screenshots", "switcher-scrolled.png") });

await browser.close();
