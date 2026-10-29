// Probe 2: inside the real editor->preview flow, debug CSS retrieval
// for the target block: encodeAppId, stylesheet links, request.get vs
// in-frame fetch, with full error messages.
import { loadConfig } from "../../src/config.mjs";
import { launchSession } from "../../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../../src/editor.mjs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
try {
  ({ page } = await openEditor(page, config));
  const frameLocator = await gotoTargetPage(page, config);
  void frameLocator;
  const { frame } = await openPreview(page, context);
  console.log("preview frame URL:", frame.url());

  const block = frame.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first();
  const encodeAppId = await block.getAttribute("data-encodeappid").catch((e) => "ERR:" + e.message);
  console.log("encodeAppId:", encodeAppId);

  const links = await frame.evaluate(() =>
    [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
  );
  console.log("stylesheets:", JSON.stringify(links, null, 1));
  const matched = links.filter((l) => typeof encodeAppId === "string" && l.includes(encodeAppId));
  console.log("matched:", JSON.stringify(matched, null, 1));

  if (matched.length) {
    const url = matched[0];
    try {
      const r = await frame.page().request.get(url, { timeout: 15000 });
      const t = await r.text();
      console.log("request.get ->", r.status(), t.length, "chars; head:", JSON.stringify(t.slice(0, 100)));
    } catch (e) {
      console.log("request.get ERROR:", e.message.split("\n").slice(0, 4).join(" | "));
    }
    const res2 = await frame.evaluate(async (u) => {
      try {
        const r = await fetch(u);
        const t = await r.text();
        return { ok: r.ok, status: r.status, len: t.length, head: t.slice(0, 100) };
      } catch (err) {
        return { error: String(err) };
      }
    }, url);
    console.log("frame fetch ->", JSON.stringify(res2));
  }
} finally {
  await browser.close();
}
