// Probe 6: did probe 5's create actually make a page? List custom pages in
// a fresh session and diff against the known 19. Read-only.
import fs from "node:fs";
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor } from "../../src/editor.mjs";
import { writeFile } from "node:fs/promises";

const KNOWN = ["Home", "About Us", "Solution", "Energy", "Mining", "Water Treatment",
  "General Industry", "Warranty Training", "Video", "定制区块", "1545", "ceshicp",
  "测试私有属性", "测试私有4.0", "测试1531", "2042", "1542", "0940", "1539"];

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
try {
  ({ page } = await openEditor(page, config));
  await page.getByText("页面:", { exact: true }).first().click();
  await page.waitForTimeout(2500);
  const list = await page.evaluate(() => {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll(".backstage-topToolbar-pageBox ul.backstage-topToolbar-menusubUl li a.name")]
      .map((a) => ({ name: norm(a.textContent), title: a.getAttribute("title"), pageurl: a.getAttribute("pageurl"), href: a.getAttribute("data-href") }));
  });
  const extra = list.filter((p) => !KNOWN.includes(p.name));
  console.log(JSON.stringify({ total: list.length, extra }, null, 2));
  fs.mkdirSync('hidden', { recursive: true });
  await writeFile("hidden/probe-pages6.json", `${JSON.stringify({ list, extra }, null, 2)}\n`, "utf8");
  for (const tab of context.pages().filter((t) => t !== page)) { try { if (!tab.isClosed()) await tab.close(); } catch {} }
} finally {
  await browser.close().catch(() => {});
}
