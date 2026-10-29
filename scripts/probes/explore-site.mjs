// Exploration 3: verify which front-end domain the logged-in editor site
// belongs to, by (a) loading both candidate front domains and comparing
// titles, and (b) asking the editor for its preview URL. Read-only.
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
const TARGET = process.env.PLAYWRIGHT_SITE_DOMAIN || "";
const OTHER = "http://en-site22916177.ldmfyh.com";

const browser = await firefox.launch({ proxy: proxyFromEnv() });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`),
});

async function probe(url) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const title = await page.title().catch(() => "");
    const h1 = await page.locator("h1,h2").first().innerText().catch(() => "");
    const nav = await page
      .locator("nav a, header a")
      .allInnerTexts()
      .catch(() => []);
    console.log(`PROBE ${url} -> status=${resp?.status()} final=${page.url()} title=${JSON.stringify(title)} firstHeading=${JSON.stringify(h1.slice(0, 80))} nav=${JSON.stringify(nav.slice(0, 8))}`);
  } catch (e) {
    console.log(`PROBE ${url} -> FAIL ${e.message.split("\n")[0].slice(0, 120)}`);
  } finally {
    await page.close().catch(() => {});
  }
}

await probe(TARGET + "/");
await probe(TARGET.replace("http://", "https://") + "/");
await probe(OTHER + "/");
await probe(OTHER + "/products.html");
await probe(TARGET + "/products.html");

await browser.close();
