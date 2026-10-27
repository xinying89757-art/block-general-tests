// Fixture setup for oracle v2 (values chosen from the holder scan —
// both target values currently have ZERO holders, so expected sets are
// exactly the fixture products):
//   P1 测试产品A:   A=单选4-10, B=下拉列表4-10   (both)
//   P2 测试产品小何1: A=单选4-10, B=下拉列表8-10   (A only)
//   P3 测试产品小何2: A=单选6-10, B=下拉列表4-10   (B only)
// Expected: A-set {P1,P2}  B-set {P1,P3}  ∩ {P1}  ∪ {P1,P2,P3}
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, context, page } = await launchSession(config);
const out = { products: {} };
const PLAN = {
  "测试产品A": { a: "单选4-10", b: "下拉列表4-10" },
  "测试产品小何1": { a: "单选4-10", b: "下拉列表8-10" },
  "测试产品小何2": { a: "单选6-10", b: "下拉列表4-10" },
};

async function findProdId(name) {
  await page.goto("https://website.leadong.com/prod", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  return page.evaluate((n) => {
    const a = [...document.querySelectorAll("a")].find((x) => (x.innerText || "").trim() === n && /prodId=/.test(x.getAttribute("href") || ""));
    return a ? new URL(a.getAttribute("href"), location.origin).searchParams.get("prodId") : null;
  }, name);
}

async function setFields(prodId, plan) {
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${prodId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  const setRes = await page.evaluate(({ aText, bText }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const log = [];
    // Field A: radio group option_826554; option label text sits next to each radio.
    const radios = [...document.querySelectorAll('input[type=radio][name="option_826554"]')];
    const rTarget = radios.find((r) => {
      const lab = r.closest("label") || r.parentElement;
      return lab && norm(lab.innerText).includes(aText);
    });
    if (!rTarget) log.push("A radio not found");
    else { rTarget.click(); log.push("A set -> " + rTarget.value + " checked=" + rTarget.checked); }
    // Field B: the select whose options include the target text.
    const selects = [...document.querySelectorAll("select")];
    const sel = selects.find((s) => [...s.options].some((o) => norm(o.text) === bText));
    if (!sel) log.push("B select not found");
    else {
      const opt = [...sel.options].find((o) => norm(o.text) === bText);
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      log.push("B set -> " + sel.value + " (" + norm(sel.selectedOptions[0]?.text) + ")");
    }
    return log;
  }, { aText: plan.a, bText: plan.b });
  // Save: find the form's save/submit button.
  const saveRes = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, input[type=submit], a")];
    const btn = btns.find((b) => ["保存", "提交", "确定"].includes((b.innerText || b.value || "").replace(/\s+/g, " ").trim()) && b.getClientRects().length);
    if (!btn) return "save-btn-not-found: " + btns.map((b) => (b.innerText || b.value || "").trim()).filter(Boolean).slice(0, 12).join("|");
    btn.click();
    return "saved-clicked:" + (btn.innerText || btn.value || "").trim();
  });
  await page.waitForTimeout(5000);
  // Read back in a fresh load.
  await page.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${prodId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  const readBack = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const r = document.querySelector('input[type=radio][name="option_826554"]:checked');
    const rLab = r ? norm((r.closest("label") || r.parentElement || {}).innerText || "") : null;
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /下拉列表/.test(o.text)));
    return { a: rLab, b: sel ? norm(sel.selectedOptions[0]?.text) : null };
  });
  return { setRes, saveRes, readBack };
}

try {
  await openEditor(page, config);
  for (const [name, plan] of Object.entries(PLAN)) {
    const prodId = await findProdId(name);
    out.products[name] = { prodId, plan };
    if (prodId) out.products[name].result = await setFields(prodId, plan);
  }
} finally {
  fs.writeFileSync("hidden/oracle-fixture.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
