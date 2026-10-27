// Exploration 2: with saved login state, open the console's editSite link and
// inspect the editor: which site does it belong to, what pages exist, and is
// there a site switcher? Read-only inspection, screenshots only.
import { firefox } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

function proxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw) return undefined;
  const u = new URL(raw);
  return { server: `${u.protocol}//${u.host}` };
}

const ACCOUNT = process.env.PLAYWRIGHT_USERNAME || "";
const EDIT_SITE = "https://www.leadong.com/phoenix/admin/user/editSite?s=miKfUASmzrZj&c=cWUAKfNCbSMO&d=&l=0";

const browser = await firefox.launch({ proxy: proxyFromEnv() });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
  viewport: { width: 1600, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

await page.goto(EDIT_SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(5000);

mkdirSync(path.join(root, "screenshots"), { recursive: true });
await page.screenshot({ path: path.join(root, "screenshots", "editor.png") });

console.log("EDITOR_URL:", page.url());
console.log("EDITOR_TITLE:", await page.title());

const frames = page.frames().map((f) => f.url());
console.log("FRAMES:", JSON.stringify(frames, null, 1));

const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 3000);
console.log("BODY_TEXT_START>>>");
console.log(bodyText);
console.log("<<<BODY_TEXT_END");

const interesting = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    const text = (a.textContent || "").trim().slice(0, 40);
    if (/site|ldy|ldm|edit|preview/i.test(href + " " + text)) out.push({ text, href });
  }
  return out.slice(0, 60);
});
console.log("INTERESTING_LINKS:", JSON.stringify(interesting, null, 1));

await browser.close();
