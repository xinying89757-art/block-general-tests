// Probe 11: inventory the settings dialogs of wrap1 (gallery) and
// wrap2 (button). Dialog DOM lives in the MAIN page: find the smallest
// container that has both 取消 and 保存 buttons, dump its controls.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { dialogs: [] };

async function dumpMainDialog() {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll("div, section, form")];
    const roots = all.filter((n) => {
      const t = n.innerText || "";
      return t.includes("取消") && t.includes("保存") && n.getClientRects().length;
    }).sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    const root = roots[0];
    if (!root) return { error: "dialog root not found" };
    const controls = [...root.querySelectorAll("input, select, textarea")].map((c) => {
      const li = c.closest("li, .el-form-item, label, div");
      return {
        tag: c.tagName, type: c.type || "", value: (c.value ?? "").toString().slice(0, 40),
        checked: !!c.checked,
        options: c.tagName === "SELECT" ? [...c.options].map((o) => o.textContent.trim().slice(0, 30)) : undefined,
        context: (li?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 90),
      };
    });
    return {
      rootCls: (root.className || "").toString().slice(0, 100),
      text: (root.innerText || "").trim().slice(0, 1600),
      controls: controls.slice(0, 120),
    };
  }).catch((e) => ({ error: e.message }));
}

async function closeMainDialog() {
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("div, section, form")];
    const roots = all.filter((n) => {
      const t = n.innerText || "";
      return t.includes("取消") && t.includes("保存") && n.getClientRects().length;
    }).sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    const root = roots[0];
    const btn = root && [...root.querySelectorAll("button, a")].find((b) => (b.innerText || "").trim() === "取消");
    btn?.click();
  }).catch(() => {});
  await page.waitForTimeout(1200);
}

try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const frameEl = await page.locator("iframe.backstage-pc-proview").elementHandle();
  const frame = await frameEl.contentFrame();
  const wraps = await frame.evaluate((appid) => {
    const block = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
    return [...block.querySelectorAll(".backstage-blocksEditor-wrap")].map((w) => ({
      editorType: w.getAttribute("data-blockseditor-type"),
      btnId: w.querySelector("a.backstage-widgettool-btns")?.id || null,
    }));
  }, config.blockId);

  for (let i = 1; i < wraps.length; i++) {
    const w = wraps[i];
    if (!w.btnId) { out.dialogs.push({ index: i, ...w, error: "no btn" }); continue; }
    await frame.evaluate((id) => document.getElementById(id)?.click(), w.btnId);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `screenshots/probe-settings11-wrap${i}.png` });
    out.dialogs.push({ index: i, ...w, dump: await dumpMainDialog() });
    await closeMainDialog();
  }
} finally {
  fs.writeFileSync("hidden/settings-inventory-rest.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 9000));
