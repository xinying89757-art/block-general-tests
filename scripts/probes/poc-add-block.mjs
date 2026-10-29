// POC: on the target site, switch the editor to the "Products" system page,
// add block BLOCK_ID (default 40838), save, open preview, and verify the
// block exists in both the editor canvas and the preview. Leaves the block
// in place for human inspection (suite cleanup comes later).
import { firefox } from "playwright-core";
import { mkdirSync } from "node:fs";
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
const EDIT = process.env.EDIT_SITE_URL || process.env.PLAYWRIGHT_EDIT_SITE_URL;
const BLOCK_ID = process.env.BLOCK_ID || "40838";
const TARGET_PAGE = process.env.TARGET_PAGE || "products";
const PAGE_LABEL = { products: "Products" }[TARGET_PAGE] || TARGET_PAGE;

const log = (...a) => console.log("[poc]", ...a);
mkdirSync(path.join(root, "screenshots"), { recursive: true });

const browser = await firefox.launch({ proxy: proxyFromEnv() });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
  viewport: { width: 1600, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

async function shot(name) {
  await page.screenshot({ path: path.join(root, "screenshots", name) }).catch(() => {});
}

// 1) Open editor
await page.goto(EDIT, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(5000);
const know = page.locator("text=我知道了").first();
if (await know.isVisible().catch(() => false)) await know.click().catch(() => {});
log("editor opened");

// 2) Switch to target system page
await page.locator("text=页面:").first().click();
await page.waitForTimeout(2000);
await page.locator("text=系统页面").first().click();
await page.waitForTimeout(2000);
await page.getByText(PAGE_LABEL, { exact: true }).first().click();
await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(5000);
const currentLabel = await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && (e.textContent || "").trim() === "页面:",
  );
  return el?.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) || "";
});
log("page selector shows:", currentLabel);
await shot("poc-01-products-page.png");

// 3) Click first module add button in the canvas iframe (reference logic)
const frame = page.frameLocator("iframe.backstage-pc-proview");
await frame.locator("body").waitFor({ state: "attached", timeout: 60000 });
const wrapper = frame.locator("#backstage-bodyArea .backstage-creatmodules-wrapper").first();
await wrapper.waitFor({ state: "attached", timeout: 30000 });
const addBtn = wrapper.locator(".backstage-creatmodules-addbtn");
await addBtn.waitFor({ state: "attached", timeout: 30000 });
await addBtn.scrollIntoViewIfNeeded();
try {
  await addBtn.click({ timeout: 5000 });
} catch {
  await addBtn.click({ force: true });
}
await page.waitForTimeout(1500);
await page.locator(".backstage-addmodules-chooseWrapper").waitFor({ state: "attached", timeout: 30000 });
log("add panel opened");
await shot("poc-02-add-panel.png");

// 4) Add the block, trying module lists in order: review -> develop -> online
async function tryAdd(moduleType) {
  if (moduleType === "online") {
    const search = page.locator(".addmodules_searchWrap input");
    await search.waitFor({ state: "attached", timeout: 15000 });
    await search.fill(BLOCK_ID);
    await search.press("Enter");
  } else {
    const value = moduleType === "develop" ? "-1" : "-2";
    const tab = page
      .locator(`.backstage-addmodules-chooseWrapper .user-handle-module[value="${value}"]`)
      .first();
    await tab.waitFor({ state: "attached", timeout: 15000 });
    await tab.click();
  }
  await page.waitForTimeout(2500);
  const found = await page.evaluate((id) => {
    const els = document.querySelectorAll(`.btn.add[appid="${id}"]`);
    if (els.length > 0) {
      const el = els[0];
      el.style.display = "block";
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.click();
      return true;
    }
    return false;
  }, BLOCK_ID);
  return found;
}

let addedVia = null;
for (const t of ["review", "develop", "online"]) {
  const ok = await tryAdd(t).catch(() => false);
  log(`tryAdd(${t}) ->`, ok);
  if (ok) {
    addedVia = t;
    break;
  }
}
if (!addedVia) {
  await shot("poc-XX-add-failed.png");
  throw new Error(`block ${BLOCK_ID} not found in any module list`);
}
await page.waitForTimeout(3000);
const closeBtn = page
  .locator(".backstage-addmodules-chooseWrapper .addmodules_searchContainer > .block-iconbaseline-close")
  .first();
if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {});
await page.waitForTimeout(2000);

// 5) Verify block present in canvas
const inCanvas = await frame
  .locator(`.siteblocks-setting-wrap[data-appid="${BLOCK_ID}"]`)
  .count();
log("block containers in canvas:", inCanvas);
await shot("poc-03-block-added.png");

// 6) Save
const saveBtn = page.locator("#saveLayout");
await saveBtn.waitFor({ state: "visible", timeout: 30000 });
await saveBtn.click();
await page.waitForTimeout(3000);
log("saved");

// 7) Preview and verify
const previewBtn = page.locator(".clickToPreview");
await previewBtn.waitFor({ state: "visible", timeout: 15000 });
const [preview] = await Promise.all([
  context.waitForEvent("page", { timeout: 30000 }),
  previewBtn.click(),
]);
await preview.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
await preview.waitForTimeout(3000);
const inPreview = await preview
  .locator(`.siteblocks-setting-wrap[data-appid="${BLOCK_ID}"]`)
  .count()
  .catch(() => -1);
log("preview url:", preview.url());
log("block containers in preview:", inPreview);
await preview
  .screenshot({ path: path.join(root, "screenshots", "poc-04-preview.png") })
  .catch(() => {});

console.log(
  "POC_RESULT:",
  JSON.stringify({ blockId: BLOCK_ID, addedVia, inCanvas, inPreview, previewUrl: preview.url() }),
);

await browser.close();
