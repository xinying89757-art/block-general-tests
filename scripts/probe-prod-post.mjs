// Capture the actual POST body when saving the product editor after
// changing the two custom fields; check whether the new values are in it.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { posts: [] };
const PROD = "ENULQuzRFljy";
page.on("request", (req) => {
  if (req.method() === "POST" && /doUpdate|prod/i.test(req.url())) {
    const body = req.postData() || "";
    out.posts.push({ url: req.url().slice(0, 90), opt826554: (body.match(/option_826554=[^&]*/) || [])[0], select826574: (body.match(/select_826574=[^&]*/) || [])[0], len: body.length, has4: /826554[^&]*4/.test(body) });
  }
});
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const r = document.querySelector('input[type=radio][name="option_826554"][value="4"]');
    (r.closest("label") || r).click();
    const sel = document.querySelector("select.fieldSelect");
    const opt = [...sel.options].find((o) => norm(o.text) === "下拉列表4-10");
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button, a")].find((b) => (b.innerText || "").replace(/\s+/g, " ").trim() === "保存" && b.getClientRects().length);
    if (btn) btn.click();
  });
  await page.waitForTimeout(7000);
  out.toast = await page.evaluate(() => [...document.querySelectorAll(".layui-layer-content")].map((n) => (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40)));
} finally {
  fs.writeFileSync("hidden/prod-post-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3500));
