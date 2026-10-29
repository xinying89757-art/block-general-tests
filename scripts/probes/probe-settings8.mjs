// Probe 8: click the 设置 button (icon block-iconweixiu1 / id editorBtn-*)
// inside the first editable wrap (filterStyle region), then inventory
// the settings dialog: layer iframe src + form controls with labels.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { wraps: [] };

try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;

  // Inventory the sub-wraps and their settings buttons.
  const frameEl = await page.locator("iframe.backstage-pc-proview").elementHandle();
  const frame = await frameEl.contentFrame();
  out.wraps = await frame.evaluate((appid) => {
    const block = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
    return [...block.querySelectorAll(".backstage-blocksEditor-wrap")].map((w) => ({
      cls: (w.className || "").toString().slice(0, 90),
      editorType: w.getAttribute("data-blockseditor-type"),
      settingBtnId: w.querySelector("a.backstage-widgettool-btns")?.id || null,
      btns: [...w.querySelectorAll("a.backstage-widgettool-btns")].map((a) => ({
        id: a.id, title: a.querySelector(".backstage-widgettool-advtitle")?.textContent?.trim() || "",
        urlattr: a.getAttribute("urlattr") || "",
      })),
    }));
  }, config.blockId);

  // Click 设置 of the FIRST wrap (filterStyle region).
  const first = out.wraps[0];
  if (first?.settingBtnId) {
    await canvas.locator(`[id="${first.settingBtnId}"]`).click({ force: true, timeout: 8000 })
      .catch(async () => {
        await frame.evaluate((id) => document.getElementById(id)?.click(), first.settingBtnId);
      });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: "screenshots/probe-settings8-dialog.png" });

    // Find layer iframes in main page & all frames of all pages.
    const pages = context.pages();
    out.pages = [];
    for (const p of pages) {
      const info = { url: p.url(), frames: [] };
      for (const f of p.frames()) {
        info.frames.push({ url: f.url(), name: f.name() });
      }
      out.pages.push(info);
    }
    // Dump visible layers + any iframe srcs in main page.
    out.layers = await page.evaluate(() => {
      return [...document.querySelectorAll(".layui-layer, .layui-layer iframe")]
        .map((n) => ({
          tag: n.tagName, cls: (n.className || "").toString().slice(0, 100),
          src: n.getAttribute?.("src") || "", visible: !!n.getClientRects().length,
          text: (n.innerText || "").slice(0, 300),
        }));
    }).catch((e) => [{ error: e.message }]);

    // If a layer iframe exists, inventory its form.
    const layerFrame = page.frames().find((f) => /component|setting|filter|product/i.test(f.url()) && f !== page.mainFrame());
    if (layerFrame) {
      out.formUrl = layerFrame.url();
      out.form = await layerFrame.evaluate(() => {
        const text = document.body?.innerText?.slice(0, 2500) || "";
        const controls = [...document.querySelectorAll("input, select, textarea")].map((c) => {
          const row = c.closest("tr, .layui-form-item, .form-item, li, div");
          return {
            tag: c.tagName, type: c.type || "", name: c.name || "",
            value: (c.value || "").toString().slice(0, 60), checked: !!c.checked,
            options: c.tagName === "SELECT" ? [...c.options].map((o) => o.textContent.trim().slice(0, 40)) : undefined,
            rowText: (row?.innerText || "").trim().slice(0, 90),
          };
        });
        return { text, controls: controls.slice(0, 100) };
      }).catch((e) => ({ error: e.message }));
    }
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/settings-probe8.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
