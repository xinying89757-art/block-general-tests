// Probe: build the first empirical oracle sample for 40838 filtering.
// In the preview frame: collect baseline product names, then apply a
// Series value, a Category value, and both (default logic = 交集),
// recording the visible product-name set after each step.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, openPreview } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = { steps: [] };

async function productNames(frame) {
  return frame.evaluate(() => {
    const names = [...document.querySelectorAll(
      ".LA40838 .one-pruduct-list .prodlist-pro-name, .LA40838 .one-pruduct-list .prodlist-pro-name a"
    )].map((n) => (n.innerText || "").trim()).filter(Boolean);
    return [...new Set(names)];
  });
}

async function groupValues(frame, groupTitle) {
  return frame.evaluate((title) => {
    const groups = [...document.querySelectorAll(".LA40838 .prodfield-single")];
    const g = groups.find((x) => (x.querySelector(".prodfield-left-fieldname")?.innerText || "").trim() === title)
      || groups.find((x) => (x.innerText || "").includes(title));
    if (!g) return [];
    return [...g.querySelectorAll("label, .layui-form-item, .check-itm")]
      .map((n) => (n.innerText || "").trim()).filter(Boolean).slice(0, 20);
  }, groupTitle);
}

async function clickFilterValue(frame, groupTitle, value) {
  return frame.evaluate(({ title, value }) => {
    const groups = [...document.querySelectorAll(".LA40838 .prodfield-single")];
    const g = groups.find((x) => (x.querySelector(".prodfield-left-fieldname")?.innerText || "").trim() === title)
      || groups[0];
    if (!g) return "no-group";
    const labels = [...g.querySelectorAll("label, .check-itm, .layui-unselect, span, div")];
    const el = labels.find((n) => (n.innerText || "").trim() === value);
    if (!el) return "no-value";
    el.scrollIntoView({ block: "center" });
    el.click();
    return "clicked";
  }, { title: groupTitle, value });
}

async function clickSearch(frame) {
  return frame.evaluate(() => {
    const btns = [...document.querySelectorAll(".LA40838 .prodfield-search, .LA40838 .prodfield-bottom *")];
    const el = btns.find((n) => (n.innerText || "").trim() === "Search") || btns[0];
    if (!el) return "no-search";
    el.click();
    return "clicked";
  });
}

async function clickClear(frame) {
  return frame.evaluate(() => {
    const el = [...document.querySelectorAll(".LA40838 *")].find((n) => (n.innerText || "").trim() === "Clear Filters");
    if (!el) return "no-clear";
    el.click();
    return "clicked";
  });
}

try {
  ({ page } = await openEditor(page, config));
  await gotoTargetPage(page, config);
  const { frame } = await openPreview(page, context);
  await frame.locator(".LA40838").first().waitFor({ state: "attached", timeout: 30000 });
  await page.waitForTimeout(3000);

  out.seriesValues = await groupValues(frame, "Series");
  out.categoryValues = await groupValues(frame, "Category");
  out.baseline = await productNames(frame);
  out.steps.push(`baseline=${out.baseline.length}`);

  const seriesPick = (out.seriesValues || []).find((v) => v && v !== "All");
  const catPick = (out.categoryValues || []).find((v) => v && v !== "All");
  out.picks = { seriesPick, catPick };

  if (seriesPick) {
    out.steps.push("series click: " + await clickFilterValue(frame, "Series", seriesPick));
    await page.waitForTimeout(800);
    out.steps.push("search: " + await clickSearch(frame));
    await page.waitForTimeout(3000);
    out.afterSeries = await productNames(frame);
    await clickClear(frame);
    await page.waitForTimeout(2500);
  }
  if (catPick) {
    out.steps.push("category click: " + await clickFilterValue(frame, "Category", catPick));
    await page.waitForTimeout(800);
    await clickSearch(frame);
    await page.waitForTimeout(3000);
    out.afterCategory = await productNames(frame);
    await clickClear(frame);
    await page.waitForTimeout(2500);
  }
  if (seriesPick && catPick) {
    await clickFilterValue(frame, "Series", seriesPick);
    await page.waitForTimeout(500);
    await clickFilterValue(frame, "Category", catPick);
    await page.waitForTimeout(500);
    await clickSearch(frame);
    await page.waitForTimeout(3000);
    out.afterBoth = await productNames(frame);
    const inter = (out.afterSeries || []).filter((x) => (out.afterCategory || []).includes(x));
    out.expectedIntersection = inter;
    out.intersectionMatches = JSON.stringify([...(out.afterBoth || [])].sort()) === JSON.stringify([...inter].sort());
  }
} finally {
  fs.writeFileSync("hidden/oracle-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
