// Probe 9: full settings inventory of block 40838. For each editable
// sub-wrap, click its 设置 button, dump the blockEditorUI dialog DOM
// (title, tabs, texts, all controls with labels/checked/options),
// then cancel/close before the next wrap.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { dialogs: [] };

function editorFrame() {
  return page.frames().find((f) => f.url().includes("blockEditorUI/index.html#/"));
}

async function dumpDialog() {
  const f = editorFrame();
  if (!f) return { error: "blockEditorUI frame not found" };
  return f.evaluate(() => {
    const root = document.querySelector(
      ".el-dialog, .el-drawer, [role=dialog], .dialog, [class*=dialog], [class*=Dialog]"
    ) || document.body;
    const items = [...root.querySelectorAll("input, select, textarea")].map((c) => {
      const li = c.closest("li, .el-form-item, .form-item, label, div");
      return {
        tag: c.tagName, type: c.type || "", name: c.name || "",
        value: (c.value ?? "").toString().slice(0, 50), checked: !!c.checked,
        options: c.tagName === "SELECT" ? [...c.options].map((o) => o.textContent.trim().slice(0, 40)) : undefined,
        context: (li?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
      };
    });
    return {
      url: location.href,
      title: (root.querySelector(".el-dialog__title, [class*=title]")?.textContent || "").trim().slice(0, 80),
      text: (root.innerText || "").trim().slice(0, 1800),
      controls: items.slice(0, 120),
    };
  }).catch((e) => ({ error: e.message }));
}

async function closeDialog() {
  const f = editorFrame();
  if (!f) return;
  await f.evaluate(() => {
    const btns = [...document.querySelectorAll("button, a")];
    const cancel = btns.find((b) => (b.innerText || "").trim() === "取消")
      || document.querySelector(".el-dialog__headerbtn, [class*=close]");
    cancel?.click();
  }).catch(() => {});
  await page.waitForTimeout(1200);
}

try {
  ({ page } = await openEditor(page, config));
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

  for (let i = 0; i < wraps.length; i++) {
    const w = wraps[i];
    if (!w.btnId) { out.dialogs.push({ ...w, error: "no settings button" }); continue; }
    await frame.evaluate((id) => document.getElementById(id)?.click(), w.btnId);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `screenshots/probe-settings9-wrap${i}.png` });
    const dump = await dumpDialog();
    out.dialogs.push({ index: i, ...w, dump });
    await closeDialog();
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/settings-inventory.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 9000));
