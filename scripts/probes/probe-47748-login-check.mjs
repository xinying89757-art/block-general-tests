// Debug: open editSiteUrl, screenshot + dump visible text, do not fail on missing selectors.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
try {
  await page.goto(config.editSiteUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "screenshots/probe-47748-login-check.png", fullPage: false });
  const info = {
    url: page.url(),
    title: await page.title().catch(() => ""),
    bodyText: (await page.evaluate(() => document.body?.innerText || "").catch((e) => e.message)).slice(0, 2000),
  };
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-login-check.json", JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
} finally {
  await browser.close();
}
