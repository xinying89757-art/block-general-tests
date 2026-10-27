// Experiment: drive the product editor's custom fields through their
// layui skins (radio skin div; select dropdown dl/dd), save, read back.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
const PROD = "ENULQuzRFljy";
try {
  ({ page } = await openEditor(page, config));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.skins = await page.evaluate(() => {
    const r = document.querySelector('input[type=radio][name="option_826554"][value="4"]');
    const label = r.closest("label") || r.parentElement;
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
    const selWrap = sel.closest(".layui-form-select") || sel.parentElement;
    return {
      radioLabelHTML: label ? label.outerHTML.slice(0, 300) : null,
      selectWrapHTML: selWrap ? selWrap.outerHTML.slice(0, 300) : null,
    };
  });
  out.set = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const log = [];
    // radio via skin
    const r = document.querySelector('input[type=radio][name="option_826554"][value="4"]');
    const skin = r.parentElement.querySelector(".layui-form-radio") || r.closest("label");
    skin.click();
    log.push("radio checked after skin click: " + r.checked);
    // select via layui dropdown
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
    const wrap = sel.closest(".layui-form-select");
    if (!wrap) { log.push("no layui select wrap"); return log; }
    const title = wrap.querySelector(".layui-select-title") || wrap;
    title.click();
    const dd = [...wrap.querySelectorAll("dd")].find((d) => norm(d.innerText) === "下拉列表4-10");
    log.push("dd found: " + !!dd);
    if (dd) dd.click();
    log.push("select now: " + norm(sel.selectedOptions[0]?.text) + " value=" + sel.value);
    return log;
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button, a")].find((b) => (b.innerText || "").replace(/\s+/g, " ").trim() === "保存" && b.getClientRects().length);
    if (btn) btn.click();
  });
  await page.waitForTimeout(6000);
  out.toast = await page.evaluate(() => [...document.querySelectorAll(".layui-layer-content")]
    .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60)));
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.readBack = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const r = document.querySelector('input[type=radio][name="option_826554"]:checked');
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
    return { a: r ? r.value : null, b: sel ? norm(sel.selectedOptions[0]?.text) : null };
  });
} finally {
  fs.writeFileSync("hidden/prod-layui-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
