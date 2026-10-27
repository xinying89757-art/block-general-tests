// Probe: in preview, select a Series value and click Search; record
// what happens: frame URL change, new page, URL params, and where
// product names appear afterwards.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { events: [] };
try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const { previewPage, frame } = await openPreview(page, context);
  out.beforeUrl = frame.url();
  out.beforePageUrl = previewPage.url();
  context.on("page", (p) => out.events.push("newpage: " + p.url()));
  frame.on("navigated", (f) => out.events.push("framenavigated: " + f.url()));

  await page.waitForTimeout(2500);
  const clicked = await frame.evaluate(() => {
    const groups = [...document.querySelectorAll(".LA40838 .prodfield-single")];
    const g = groups[0];
    if (!g) return "no-group";
    const labels = [...g.querySelectorAll("label, .check-itm, span, div")];
    const el = labels.find((n) => (n.innerText || "").trim() === "Hydraulic cylinder");
    if (!el) return "no-value";
    el.scrollIntoView({ block: "center" });
    el.click();
    return "value-clicked";
  });
  out.events.push("select: " + clicked);
  await page.waitForTimeout(1000);
  out.afterSelect = await frame.evaluate(() => ({
    url: location.href,
    checkedCount: document.querySelectorAll(".LA40838 input[type=checkbox]:checked, .LA40838 .has-active").length,
    selectedTags: [...document.querySelectorAll(".LA40838 [class*=selected], .LA40838 [class*=tag]")].map((n) => (n.innerText || "").trim().slice(0, 40)).slice(0, 8),
  }));

  const searched = await frame.evaluate(() => {
    const el = [...document.querySelectorAll(".LA40838 .prodfield-search")][0]
      || [...document.querySelectorAll(".LA40838 *")].find((n) => (n.innerText || "").trim() === "Search");
    if (!el) return "no-search";
    el.click();
    return "search-clicked";
  });
  out.events.push("search: " + searched);
  await page.waitForTimeout(5000);
  out.afterUrl = frame.url();
  out.afterPageUrl = previewPage.url();
  out.pagesNow = context.pages().map((p) => p.url());
  // Where are products now? scan the (possibly navigated) frame + pages
  out.afterScan = await frame.evaluate(() => {
    const sels = [".one-pruduct-item", ".prodlist-pro-name", "[class*=prodlist]", ".product-item", ".prod-item"];
    const counts = {};
    for (const s of sels) counts[s] = document.querySelectorAll(s).length;
    return { url: location.href, counts, textSample: (document.body.innerText || "").slice(0, 600) };
  }).catch((e) => ({ error: e.message }));
} finally {
  fs.writeFileSync("hidden/searchnav-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
