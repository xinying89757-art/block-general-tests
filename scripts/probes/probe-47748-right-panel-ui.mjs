// The right settings panel is not in the main page: search the
// blockEditorUI frames (phoenix2/composite/blockEditorUI) for the panel
// containing 配色 / 模块宽度 / 1440 after selecting block 47748 in the
// canvas. Read-only.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, uiFrames: [] };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const wrap = canvas.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  await wrap.scrollIntoViewIfNeeded();
  await wrap.click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  for (const frame of page.frames()) {
    if (!frame.url().includes("blockEditorUI")) continue;
    const info = await frame.evaluate(() => {
      const text = document.body ? document.body.innerText || "" : "";
      const keywords = ["配色", "模块宽度", "1440", "宽度", "颜色", "设置"];
      const found = keywords.filter((k) => text.includes(k));
      const controls = [...document.querySelectorAll("input, select, textarea, button")]
        .filter((el) => el.offsetWidth || el.offsetHeight)
        .slice(0, 40)
        .map((el) => ({ tag: el.tagName, type: el.getAttribute("type") || "",
          name: el.getAttribute("name") || "", value: el.value ?? "",
          checked: el.checked ?? null, cls: String(el.className).slice(0, 80),
          text: (el.innerText || "").slice(0, 40) }));
      return { url: location.href.slice(0, 120), textLen: text.length,
        textHead: text.slice(0, 800), found, visibleControls: controls.length, controls };
    }).catch((e) => ({ error: e.message }));
    out.uiFrames.push(info);
  }
} finally {
  fs.mkdirSync('hidden', { recursive: true });
  fs.writeFileSync("hidden/probe-47748-right-panel-ui.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
