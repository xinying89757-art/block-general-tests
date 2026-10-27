// Switch the Leadong console to the TARGET site (产品全文搜索、图片搜索
// = en-site40083596.ldyjz.com), English language, then report the site's
// editSite entry and persist a site-specific storageState.
// This changes the account's current-site context (reversible via the same
// switcher); it does not modify any site content.
import { firefox} from "playwright-core";
import { mkdirSync} from "node:fs";
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

// Open switcher.
await page.locator("text=en-site22916177.ldmfyh.com").first().click();
await page.waitForTimeout(2500);

// Scroll the switcher list until the target site row is visible, then click.
const row = page.locator(`text=${TARGET_SITE_NAME}`).first();
for (let i = 0; i < 8; i++) {
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
await row.click();
await page.waitForTimeout(2000);

// Pick English if a language column appears for the chosen site.
const en = page.locator("text=英语").first();
if (await en.isVisible().catch(() => false)) {
await en.click().catch(() => {});
}
await page.waitForLoadState("networkidle", { timeout: 45000}).catch(() => {});
await page.waitForTimeout(5000);

const headerText = await page.evaluate(() => {
const el = document.querySelector("body");
return (el?.innerText || "").slice(0, 600);
});
console.log("HEADER_SNIPPET:", JSON.stringify(headerText.slice(0, 300)));
console.log("ON_TARGET_DOMAIN:", headerText.includes(TARGET_DOMAIN));

const edit = await page.evaluate(() => {
const a = document.querySelector("a[href*='editSite']");
const li = document.querySelector("[path*='editSite']");
return {
href: a?.getAttribute("href") || null,
path: li?.getAttribute("path") || null,
};
});
console.log("EDIT_SITE:", JSON.stringify(edit));

mkdirSync(path.join(root, "screenshots"), { recursive: true});
await page.screenshot({ path: path.join(root, "screenshots", "console-target-site.png")});

const out = path.join(root, "src/fixtures", `storageState-${ACCOUNT}-site40083596.json`);
await context.storageState({ path: out});
console.log("SAVED_STATE:", out);

await browser.close();
