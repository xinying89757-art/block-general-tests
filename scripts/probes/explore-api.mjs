// Exploration 7: capture console API traffic to find how sites are listed
// and switched (looking for the target site's identifiers / editSite params).
import { firefox} from "playwright-core";
import { writeFileSync, mkdirSync} from "node:fs";
import path from "node:path";
import { fileURLToPath} from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env")});

function proxyFromEnv() {
const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
if (!raw) return undefined;
const u = new URL(raw);
return { server: `${u.protocol}//${u.host}`};
}

const ACCOUNT = process.env.PLAYWRIGHT_USERNAME || "";
const TARGET_SITE_NAME = "产品全文搜索、图片搜索";

const browser = await firefox.launch({ proxy: proxyFromEnv()});
const context = await browser.newContext({
ignoreHTTPSErrors: true,
storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
viewport: { width: 1600, height: 1000},
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

const records = [];
page.on("response", async (resp) => {
const url = resp.url();
if (!/leadong\.com/.test(url)) return;
const ct = resp.headers()["content-type"] || "";
if (!ct.includes("json")) return;
let body = "";
try {
body = await resp.text();
} catch {}
const interesting =
/40083596|editSite|ldyjz/.test(body) || /site/i.test(url);
records.push({ url: url.slice(0, 220), status: resp.status(), interesting, body: interesting? body.slice(0, 4000): undefined});
});

await page.goto("https://www.leadong.com/phoenix2/composite/middle/platform/index.html", {
waitUntil: "domcontentloaded",
timeout: 60000,
});
await page.waitForLoadState("networkidle", { timeout: 45000}).catch(() => {});
await page.waitForTimeout(4000);

await page.locator("text=en-site22916177.ldmfyh.com").first().click();
await page.waitForTimeout(3000);

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
await row.hover().catch(() => {});
await page.waitForTimeout(3000);

mkdirSync(path.join(root, "hidden"), { recursive: true});
writeFileSync(path.join(root, "hidden", "api-records.json"), JSON.stringify(records, null, 1));
console.log("TOTAL_JSON_RESPONSES:", records.length);
for (const r of records) {
console.log(`${r.status} ${r.url}${r.interesting? " <== INTERESTING": ""}`);
}

await browser.close();
