// Switch console to target site, v2: hover the site row to reveal its
// language column, then click the 英语 entry in that column (the actual
// switch trigger), and verify the header domain changes.
import { firefox} from "playwright-core";
import path from "node:path";
import { fileURLToPath} from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env")});

function proxyFromEnv() {
const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
if (!raw) return undefined;
const u = new URL(raw);
return { server: `${u.protocol}//${u.host}`};
}

const ACCOUNT = process.env.PLAYWRIGHT_USERNAME || "";
const TARGET_SITE_NAME = "产品全文搜索、图片搜索";
const TARGET_DOMAIN = "en-site40083596.ldyjz.com";

const browser = await firefox.launch({ proxy: proxyFromEnv()});
const context = await browser.newContext({
ignoreHTTPSErrors: true,
storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
viewport: { width: 1600, height: 1000},
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

await page.goto("https://www.leadong.com/phoenix2/composite/middle/platform/index.html", {
waitUntil: "domcontentloaded",
timeout: 60000,
});
await page.waitForLoadState("networkidle", { timeout: 45000}).catch(() => {});
await page.waitForTimeout(4000);

await page.locator("text=en-site22916177.ldmfyh.com").first().click();
await page.waitForTimeout(2500);

const row = page.locator(`text=${TARGET_SITE_NAME}`).first();
for (let i = 0; i < 10; i++) {
if (await row.isVisible().catch(() => false)) break;
await page.evaluate(() => {
const el = [...document.querySelectorAll("div, li, a, span")].find((e) =>
(e.textContent || "").includes("测试图册"),
);
let node = el;
while (node && node!== document.body) {
if (node.scrollHeight > node.clientHeight + 10) {
node.scrollTop += 300;
return;
}
node = node.parentElement;
}
});
await page.waitForTimeout(800);
}
await row.waitFor({ state: "visible", timeout: 15000});
await row.hover();
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(root, "screenshots", "switcher-target-hover.png")});

// Language entries live in a column to the right of the site list; pick the
// 英语 entry whose box starts right of the list (x > 340).
const candidates = page.locator("text=英语");
const count = await candidates.count();
console.log("EN_CANDIDATES:", count);
let clicked = false;
for (let i = 0; i < count; i++) {
const box = await candidates.nth(i).boundingBox().catch(() => null);
console.log(`CANDIDATE ${i}:`, JSON.stringify(box));
if (box && box.x > 340 && box.y < 400) {
await candidates.nth(i).click();
clicked = true;
break;
}
}
console.log("LANG_CLICKED:", clicked);

await page.waitForLoadState("networkidle", { timeout: 45000}).catch(() => {});
await page.waitForTimeout(6000);

const headerText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 300));
console.log("HEADER_SNIPPET:", JSON.stringify(headerText.slice(0, 200)));
console.log("ON_TARGET_DOMAIN:", headerText.includes(TARGET_DOMAIN));

const edit = await page.evaluate(() => {
const a = document.querySelector("a[href*='editSite']");
const li = document.querySelector("[path*='editSite']");
return { href: a?.getAttribute("href") || null, path: li?.getAttribute("path") || null};
});
console.log("EDIT_SITE:", JSON.stringify(edit));

await page.screenshot({ path: path.join(root, "screenshots", "console-target-site2.png")});
const out = path.join(root, "src/fixtures", `storageState-${ACCOUNT}-site40083596.json`);
await context.storageState({ path: out});
console.log("SAVED_STATE:", out);

await browser.close();
