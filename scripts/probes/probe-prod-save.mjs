// Experiment on 测试产品A only: set A via the layui skin click, B via
// native select, save, capture any toast, reload, read back.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
const PROD = "ENULQuzRFljy";
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.set = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const log = [];
    const radios = [...document.querySelectorAll('input[type=radio][name="option_826554"]')];
    const r = radios.find((x) => x.value === "4");
    const skin = r.closest("label") || r.parentElement;
    log.push("skin: " + (skin ? skin.tagName + "." + (skin.className || "") : "none") + " text=" + (skin ? norm(skin.innerText) : ""));
    skin.click();
    log.push("after skin click checked=" + r.checked);
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
    const opt = [...sel.options].find((o) => norm(o.text) === "下拉列表4-10");
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    log.push("B -> " + norm(sel.selectedOptions[0].text));
    return log;
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button, a")].find((b) => (b.innerText || "").replace(/\s+/g, " ").trim() === "保存" && b.getClientRects().length);
    if (btn) btn.click();
  });
  await page.waitForTimeout(6000);
  out.afterSaveText = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll(".layui-layer-content, .toast, .el-message, [class*=success], [class*=tips]")]
      .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6);
    return { url: location.href, toasts };
  });
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.readBack = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const r = document.querySelector('input[type=radio][name="option_826554"]:checked');
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
    return { a: r ? r.value : null, b: sel ? norm(sel.selectedOptions[0]?.text) : null };
  });
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/prod-save-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 3500));
