// Exploration: log in to leadong.com with the configured account (Firefox via
// the VM egress proxy), persist storageState, and dump post-login navigation
// so we can find the target site's editor entry. Read-only w.r.t. the site:
// it only logs in and lists links.
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
const PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "";
if (!ACCOUNT || !PASSWORD) throw new Error("missing credentials in .env");

const browser = await firefox.launch({
  proxy: proxyFromEnv(),
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);

await page.goto("https://www.leadong.com/login.html", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

// Find login inputs on the page or in any frame (same approach as reference).
async function findInputs(scope) {
  const user = scope.locator('input[name="loginName"]').first();
  const pass = scope.locator('input[name="password"]').first();
  const ok =
    (await user.isVisible().catch(() => false)) &&
    (await pass.isVisible().catch(() => false));
  return ok ? { user, pass } : null;
}

let inputs = await findInputs(page);
if (!inputs) {
  for (const frame of page.frames()) {
    inputs = await findInputs(frame);
    if (inputs) break;
  }
}
if (!inputs) throw new Error("login inputs not found on page or frames");

await inputs.user.fill(ACCOUNT);
await inputs.pass.fill(PASSWORD);

let clicked = false;
for (const sel of ["#loginSubmit", 'button[type="submit"]', 'input[type="submit"]']) {
  const loc = page.locator(sel).first();
  if (await loc.count()) {
    await loc.click().catch(() => {});
    clicked = true;
    break;
  }
}
if (!clicked) throw new Error("login submit control not found");

await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(3000);

mkdirSync(path.join(root, "src/fixtures"), { recursive: true });
mkdirSync(path.join(root, "screenshots"), { recursive: true });
const statePath = path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`);
await context.storageState({ path: statePath });
await page.screenshot({ path: path.join(root, "screenshots", "after-login.png"), fullPage: false });

console.log("POST_LOGIN_URL:", page.url());
console.log("TITLE:", await page.title());
console.log("STORAGE_STATE:", statePath);

const links = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const text = (a.textContent || "").trim().slice(0, 60);
    const href = a.getAttribute("href") || "";
    if (href && href !== "#" && !href.startsWith("javascript")) out.push({ text, href });
  }
  return out;
});
console.log("LINKS:", JSON.stringify(links.slice(0, 80), null, 1));

await browser.close();
