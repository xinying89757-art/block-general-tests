// Probe: why did css-font-follow / css-word-break SKIP with
// "区块 CSS 获取失败（Error）"? Reproduce the CSS retrieval two ways
// (API request context vs in-frame fetch) and print real error messages.
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
const BLOCK_ID = process.env.BLOCK_ID || "40838";

const browser = await firefox.launch({ proxy: proxyFromEnv() });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
});

// Go straight to the published products page on the preview domain that
// the editor preview frame uses.
const page = await context.newPage();
await page.goto("http://en-site40083596.preview.leadong.com/products.html", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(6000);

const block = page.locator(`.siteblocks-setting-wrap[data-appid="${BLOCK_ID}"]`).first();
console.log("block count:", await page.locator(`.siteblocks-setting-wrap[data-appid="${BLOCK_ID}"]`).count());
const encodeAppId = await block.getAttribute("data-encodeappid").catch(() => null);
console.log("encodeAppId:", encodeAppId);

const links = await page.evaluate(() =>
  [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
);
console.log("stylesheets:", links.length);
const matched = links.filter((l) => encodeAppId && l.includes(encodeAppId));
console.log("matched:", JSON.stringify(matched, null, 1));

if (matched.length) {
  const url = matched[0];
  // Way 1: API request context (what checks.mjs does)
  try {
    const r = await page.request.get(url, { timeout: 15000 });
    console.log("request.get ->", r.status(), (await r.text()).length, "chars");
  } catch (e) {
    console.log("request.get ERROR:", e.message.split("\n").slice(0, 3).join(" | "));
  }
  // Way 2: in-page fetch (what the reference implementation does)
  const res2 = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u);
      const t = await r.text();
      return { ok: r.ok, status: r.status, len: t.length, head: t.slice(0, 80) };
    } catch (err) {
      return { error: String(err) };
    }
  }, url);
  console.log("page fetch ->", JSON.stringify(res2));
}

await browser.close();
