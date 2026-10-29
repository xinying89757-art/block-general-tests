// Probe 3: test the extracted single-file CSS URLs exactly as
// checks.mjs readBlockCss builds them.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../../src/editor.mjs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const { frame } = await openPreview(page, context);

  const block = frame.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  const encodeAppId = await block.getAttribute("data-encodeappid");
  const links = await frame.evaluate(() =>
    [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
  );
  const matched = links.filter((l) => l.includes(encodeAppId));

  const urls = new Set();
  for (const link of matched) {
    const url = new URL(link);
    const parts = url.pathname.split("/");
    const concatIndex = parts.indexOf("concat");
    if (concatIndex >= 0 && url.pathname.includes(",")) {
      const files = parts.slice(concatIndex + 2).join("/").split(",")
        .filter((f) => f.includes(encodeAppId));
      const base = `${url.origin}${parts.slice(0, concatIndex).join("/")}/`;
      for (const f of files) {
        const single = new URL(f.replace(/^\//, ""), base);
        single.search = url.search;
        urls.add(single.href);
      }
    } else urls.add(link);
  }
  console.log("single urls:", JSON.stringify([...urls], null, 1));

  for (const u of urls) {
    try {
      const r = await frame.page().request.get(u, { timeout: 15000 });
      const t = await r.text();
      console.log("request.get", r.status(), t.length, "chars |", u.slice(0, 90));
      console.log("  font-family?", /font-family\s*:/.test(t), "| word-break: break-word?", /word-break\s*:\s*break-word/.test(t));
    } catch (e) {
      console.log("request.get ERROR:", e.message.split("\n")[0], "|", u.slice(0, 90));
    }
    const res2 = await frame.evaluate(async (x) => {
      try {
        const r = await fetch(x);
        const t = await r.text();
        return { status: r.status, len: t.length };
      } catch (err) { return { error: String(err) }; }
    }, u);
    console.log("  frame fetch ->", JSON.stringify(res2));
  }
} finally {
  await browser.close();
}
