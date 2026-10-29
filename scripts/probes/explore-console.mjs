// Exploration 4: find the editor entry for the TARGET site
// (en-site40083596.ldyjz.com) inside the Leadong console. The console
// overview only surfaces one site by default; this dumps the full console
// DOM (text + all links + any node mentioning the target site id) and the
// visible menu entries. Read-only.
import { firefox } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
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
await page.waitForTimeout(6000);

console.log("CONSOLE_URL:", page.url());
const text = await page.locator("body").innerText().catch(() => "");
mkdirSync(path.join(root, "hidden"), { recursive: true });
writeFileSync(path.join(root, "hidden", "console-text.txt"), text);
console.log("BODY_TEXT_LEN:", text.length);
console.log("MENTIONS_40083596:", text.includes("40083596"));
console.log("MENTIONS_LDYJZ:", text.includes("ldyjz"));

const hits = await page.evaluate(() => {
  const out = [];
  const all = document.querySelectorAll("*");
  for (const el of all) {
    const attrs = [];
    for (const a of el.attributes || []) attrs.push(`${a.name}=${a.value}`);
    const joined = attrs.join(" ");
    if (/40083596|ldyjz|editSite/.test(joined)) {
      out.push({ tag: el.tagName, attrs: joined.slice(0, 300), text: (el.textContent || "").trim().slice(0, 60) });
    }
  }
  return out.slice(0, 40);
});
console.log("DOM_HITS:", JSON.stringify(hits, null, 1));

const links = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    const t = (a.textContent || "").trim().slice(0, 40);
    if (href && href !== "#") out.push({ t, href });
  }
  return out;
});
console.log("ALL_LINKS_COUNT:", links.length);
console.log("ALL_LINKS:", JSON.stringify(links, null, 1));

await page.screenshot({ path: path.join(root, "screenshots", "console.png") });
await browser.close();
