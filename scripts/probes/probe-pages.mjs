// Probe: page menu structure in the editor (read-only).
// Clicks 页面: and dumps the menu: 系统页面 items, 自定义页面 items,
// and any create-page control. Does NOT create or switch pages.
import fs from "node:fs";
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import { writeFile } from "node:fs/promises";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
try {
  ({ page } = await openEditor(page, config));
  await page.getByText("页面:", { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const menu = await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    // The page menu is the visible panel that appeared; find the container
    // holding 系统页面.
    const all = [...document.querySelectorAll("body *")].filter((el) => norm(el.textContent) === "系统页面");
    const info = { systemLabelCount: all.length, panels: [] };
    for (const label of all) {
      let panel = label;
      for (let i = 0; i < 8 && panel.parentElement; i++) {
        panel = panel.parentElement;
        const text = norm(panel.innerText || "");
        if (text.length > 40) break;
      }
      info.panels.push({
        tag: panel.tagName,
        cls: panel.className,
        text: norm(panel.innerText || "").slice(0, 500),
        html: panel.outerHTML.slice(0, 3000),
      });
    }
    return info;
  });
  console.log(JSON.stringify(menu, null, 2).slice(0, 6000));
  fs.mkdirSync('hidden', { recursive: true });
  await writeFile("hidden/probe-pages.json", `${JSON.stringify(menu, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
