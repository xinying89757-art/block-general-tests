// Probe 47748 inventory: list all blocks on the target page, then for each
// sub-region of 47748 click its 设置 button and snapshot the settings dialog.
// Read-only: dialogs are closed with 取消, nothing is saved.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import { controlsSnapshot } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId, targetPage: config.targetPage, allBlocks: [], wraps: [], dialogs: [] };

try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const frameEl = await page.locator("iframe.backstage-pc-proview").elementHandle();
  const frame = await frameEl.contentFrame();

  out.allBlocks = await frame.evaluate(() => {
    const counts = {};
    for (const el of document.querySelectorAll(".siteblocks-setting-wrap[data-appid]")) {
      const id = el.getAttribute("data-appid");
      counts[id] = (counts[id] || 0) + 1;
    }
    return Object.entries(counts).map(([id, count]) => ({ id, count }));
  });

  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const blockCount = await canvas.locator(blockSel).count();
  out.blockCount = blockCount;
  if (blockCount === 0) {
    out.note = "目标区块不在当前页，未添加。先确认它应在哪个页面、是否需添加。";
  } else {
    out.wraps = await frame.evaluate((appid) => {
      const block = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
      return [...block.querySelectorAll(".backstage-blocksEditor-wrap")].map((w) => ({
        editorType: w.getAttribute("data-blockseditor-type"),
        settingBtnId: w.querySelector("a.backstage-widgettool-btns")?.id || null,
        btns: [...w.querySelectorAll("a.backstage-widgettool-btns")].map((a) => ({
          id: a.id,
          title: a.querySelector(".backstage-widgettool-advtitle")?.textContent?.trim() || "",
        })),
      }));
    }, config.blockId);

    for (let i = 0; i < out.wraps.length; i++) {
      const wrap = out.wraps[i];
      const entry = { index: i, editorType: wrap.editorType, settingBtnId: wrap.settingBtnId };
      try {
        if (!wrap.settingBtnId) { entry.error = "无设置按钮"; out.dialogs.push(entry); continue; }
        await canvas.locator(`[id="${wrap.settingBtnId}"]`).click({ timeout: 8000 }).catch(async () => {
          await frame.evaluate((id) => document.getElementById(id)?.click(), wrap.settingBtnId);
        });
        await page.waitForTimeout(3000);
        const dialog = page.locator(".backstage-dialog.backstage-dialog-widgetsettinsframe").filter({ visible: true }).first();
        await dialog.waitFor({ state: "visible", timeout: 10000 });
        entry.title = (await dialog.locator(".backstage-dialog-title, .layui-layer-title").first().innerText().catch(() => "")) || "";
        entry.dialogText = (await dialog.innerText().catch(() => "")).slice(0, 2000);
        entry.controls = await dialog.evaluate(controlsSnapshot).catch((e) => ({ error: e.message }));
        await page.screenshot({ path: `screenshots/probe-47748-dialog-${i}-${wrap.editorType || "unknown"}.png` });
        // Close without saving.
        const cancel = dialog.locator(".backstage-dialog-bottom").getByText("取消", { exact: true });
        if (await cancel.isVisible()) {
          await cancel.click({ timeout: 5000 });
          await dialog.waitFor({ state: "hidden", timeout: 10000 });
        } else {
          entry.closeNote = "未找到取消按钮，尝试按 Escape";
          await page.keyboard.press("Escape");
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        entry.error = e.message;
        try { await page.screenshot({ path: `screenshots/probe-47748-dialog-${i}-error.png` }); } catch {}
        // Best-effort close so the next wrap can be probed.
        try {
          const cancel = page.locator(".backstage-dialog.backstage-dialog-widgetsettinsframe .backstage-dialog-bottom").getByText("取消", { exact: true }).first();
          if (await cancel.isVisible()) await cancel.click({ timeout: 5000 });
        } catch {}
        await page.waitForTimeout(1000);
      }
      out.dialogs.push(entry);
    }
  }
} finally {
  fs.writeFileSync("hidden/probe-47748-inventory.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 12000));
