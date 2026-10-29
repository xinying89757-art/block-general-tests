// Probe round 3: the custom fields must live in a frame or tab of the
// product editor. Enumerate frames, search each for the field name, and
// dump the main document's tab/section headers.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
const PROD_ID = "ENULQuzRFljy";
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.frames = [];
  for (const f of page.frames()) {
    let has = null;
    try {
      has = await f.evaluate(() => ({
        fieldA: (document.body.innerText || "").includes("测试单选按钮A"),
        custom: (document.body.innerText || "").includes("产品自定义字段"),
        textHead: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 150),
      }));
    } catch (e) { has = { error: e.message.slice(0, 60) }; }
    out.frames.push({ url: f.url().slice(0, 110), ...has });
  }
  out.tabs = await page.evaluate(() => [...document.querySelectorAll("a, li, div, span, button")]
    .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim())
    .filter((t) => t && t.length <= 16 && /属性|字段|基本|详情|SEO|规格|库存/.test(t))
    .filter((v, i, a) => a.indexOf(v) === i).slice(0, 30));
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/prod-fields-probe3.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
