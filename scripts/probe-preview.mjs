// Probe: block 40838 is already saved on the Products page. Open the
// editor -> Products -> preview, then locate the block container across
// all frames of the preview page to learn the correct preview selectors.
import { firefox } from "playwright-core";
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
const EDIT = process.env.EDIT_SITE_URL;
const BLOCK_ID = process.env.BLOCK_ID || "40838";

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
const know = page.locator("text=我知道了").first();
if (await know.isVisible().catch(() => false)) await know.click().catch(() => {});

await page.locator("text=页面:").first().click();
await page.waitForTimeout(2000);
await page.locator("text=系统页面").first().click();
await page.waitForTimeout(2000);
await page.getByText("Products", { exact: true }).first().click();
await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(5000);

const previewBtn = page.locator(".clickToPreview");
await previewBtn.waitFor({ state: "visible", timeout: 15000 });
const [preview] = await Promise.all([
  context.waitForEvent("page", { timeout: 30000 }),
  previewBtn.click(),
]);
await preview.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
await preview.waitForTimeout(8000);

console.log("PREVIEW_URL:", preview.url());
console.log("FRAMES:", preview.frames().length);
for (const [i, f] of preview.frames().entries()) {
  const n = await f
    .locator(`.siteblocks-setting-wrap[data-appid="${BLOCK_ID}"]`)
    .count()
    .catch(() => -1);
  const anyWrap = await f.locator(".siteblocks-setting-wrap").count().catch(() => -1);
  console.log(`frame[${i}] url=${f.url().slice(0, 90)} appidContainers=${n} anyWrap=${anyWrap}`);
}
await preview.screenshot({ path: path.join(root, "screenshots", "probe-preview.png") });

await browser.close();
