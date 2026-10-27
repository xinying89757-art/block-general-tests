// Probe 6 (decisive): use elementFromPoint at the pill's screenshot
// location in both the main page and the canvas frame to identify the
// pill element, then click its two icons and dump any settings dialog.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
const { browser, page } = await launchSession(config);
const out = {};

async function getFrame() {
  const handle = await page.locator("iframe.backstage-pc-proview").elementHandle();
  return handle.contentFrame();
}
async function dump(label) {
  const grab = (ctx, where) => ctx.evaluate((w) => {
    const nodes = [...document.querySelectorAll(
      ".layui-layer, [class*=dialog], [class*=modal], [class*=compan], [class*=setting-panel]"
    )].filter((n) => n.getClientRects().length && (n.innerText || "").trim().length > 5);
    return nodes.slice(0, 8).map((n) => ({
      where: w, tag: n.tagName, cls: (n.className || "").toString().slice(0, 110),
      src: n.getAttribute?.("src") || "", text: (n.innerText || "").slice(0, 800),
    }));
  }, where).catch((e) => [{ where, error: e.message }]);
  const frame = await getFrame();
  out[label] = [...(await grab(page, "main")), ...(await grab(frame, "canvas"))];
}

try {
  await openEditor(page, config);
  const canvas = await gotoTargetPage(page, config);
  const blockSel = `.siteblocks-setting-wrap[data-appid="${config.blockId}"]`;
  const block = canvas.locator(blockSel).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover();
  await page.waitForTimeout(600);
  await block.click();
  await page.waitForTimeout(1200);

  const iframeBox = await page.locator("iframe.backstage-pc-proview").boundingBox();
  const blockBox = await block.boundingBox(); // relative to iframe viewport? Playwright returns main-frame coords for frame locators
  out.iframeBox = iframeBox; out.blockBox = blockBox;
  const cx = blockBox.x + blockBox.width / 2;
  const cy = blockBox.y + blockBox.height / 2;
  out.center = [cx, cy];

  const describe = (el) => el ? {
    tag: el.tagName, cls: (el.className || "").toString().slice(0, 130),
    parentCls: (el.parentElement?.className || "").toString().slice(0, 130),
    grandCls: (el.parentElement?.parentElement?.className || "").toString().slice(0, 130),
    text: (el.innerText || "").trim().slice(0, 40),
    html: el.outerHTML.slice(0, 400),
  } : null;

  out.mainPoint = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tag: el.tagName, cls: (el.className || "").toString().slice(0, 130), html: el.outerHTML.slice(0, 300) } : null;
  }, { x: cx, y: cy });

  const frame = await getFrame();
  const fx = cx - iframeBox.x, fy = cy - iframeBox.y;
  out.framePoint = await frame.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const chain = [];
    let n = el;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      chain.push({ tag: n.tagName, cls: (n.className || "").toString().slice(0, 130), html: n.outerHTML.slice(0, 220) });
    }
    return chain;
  }, { x: fx, y: fy });

  // The pill sits slightly above center of the block in screenshots.
  // Scan a horizontal band above center in the frame for clickable icons.
  out.band = await frame.evaluate(({ appid }) => {
    const wrap = document.querySelector(`.siteblocks-setting-wrap[data-appid="${appid}"]`);
    const wr = wrap.getBoundingClientRect();
    const hits = [];
    for (let dx = 0.35; dx <= 0.65; dx += 0.02) {
      for (let dy = 0.3; dy <= 0.55; dy += 0.05) {
        const el = document.elementFromPoint(wr.x + wr.width * dx, wr.y + wr.height * dy);
        if (el && !el.closest(".siteblocks-container")) {
          hits.push({ dx: +dx.toFixed(2), dy: +dy.toFixed(2), tag: el.tagName, cls: (el.className || "").toString().slice(0, 110), html: el.outerHTML.slice(0, 200) });
        }
      }
    }
    return hits.slice(0, 10);
  }, { appid: config.blockId });

  // Click the pill: mouse at frame point where a non-content element was hit.
  if (out.band?.length) {
    const hit = out.band[0];
    const wrapBox = await block.boundingBox();
    const px = wrapBox.x + wrapBox.width * hit.dx;
    const py = wrapBox.y + wrapBox.height * hit.dy;
    await page.mouse.click(px, py);
    await page.waitForTimeout(2800);
    await page.screenshot({ path: "screenshots/probe-settings6-pillclick.png" });
    await dump("pillClick");
  }
} finally {
  fs.writeFileSync("hidden/settings-probe6.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
