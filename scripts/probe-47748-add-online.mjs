// Add 47748 via the online list search only (40838 was found there).
// Dumps the add panel structure first so a missing control is diagnosable.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, targetPage: config.targetPage, panel: null };
try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  out.countBefore = await canvas.locator(blockSel).count();
  if (out.countBefore > 0) { out.added = false; out.note = "已在页上"; }
  else {
    const addButton = canvas.locator("#backstage-bodyArea .backstage-creatmodules-wrapper").first().locator(".backstage-creatmodules-addbtn").first();
    await addButton.scrollIntoViewIfNeeded();
    await addButton.click({ timeout: 5000 }).catch(async () => { await addButton.click({ force: true }); });
    const panel = page.locator(".backstage-addmodules-chooseWrapper");
    await panel.waitFor({ state: "visible" });
    out.panel = await panel.evaluate((el) => ({
      text: (el.innerText || "").slice(0, 1500),
      tabs: [...el.querySelectorAll(".user-handle-module")].map((n) => ({ value: n.getAttribute("value"), text: (n.textContent || "").trim().slice(0, 40) })),
      searchPresent: !!el.querySelector(".addmodules_searchWrap input"),
    }));
    const search = panel.locator(".addmodules_searchWrap input");
    await search.fill(String(config.blockId));
    await search.press("Enter");
    const candidate = panel.locator(`.btn.add[appid=${JSON.stringify(String(config.blockId))}]`).first();
    try {
      await candidate.waitFor({ state: "attached", timeout: 20000 });
    } catch (e) {
      out.searchResult = await panel.evaluate((el) => (el.innerText || "").slice(0, 1500));
      throw new Error(`online 列表中未找到 47748：${e.message}`);
    }
    const clicked = await page.evaluate(({ panelSelector, blockId }) => {
      const buttons = document.querySelector(panelSelector)?.querySelectorAll(".btn.add[appid]") || [];
      const button = [...buttons].find((el) => el.getAttribute("appid") === blockId);
      if (!button) return false;
      button.style.display = "block";
      button.scrollIntoView({ block: "center" });
      button.click();
      return true;
    }, { panelSelector: ".backstage-addmodules-chooseWrapper", blockId: String(config.blockId) });
    out.clicked = clicked;
    if (!clicked) throw new Error("online 列表找到 47748 但点击失败");
    await canvas.locator(blockSel).first().waitFor({ state: "attached", timeout: 60000 });
    const close = panel.locator(".addmodules_searchContainer > .block-iconbaseline-close").first();
    if (await close.isVisible()) await close.click();
    await panel.waitFor({ state: "hidden" }).catch(() => {});
    out.countAfter = await canvas.locator(blockSel).count();
    await savePage(page);
    out.saved = true;
    out.added = true;
  }
  await page.screenshot({ path: "screenshots/probe-47748-added.png", fullPage: false });
} finally {
  fs.writeFileSync("hidden/probe-47748-add-online.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
