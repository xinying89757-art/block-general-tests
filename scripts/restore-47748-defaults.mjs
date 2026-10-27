// Restore 47748 list dialog to inventory defaults after a run whose
// restores failed: data source 所有产品, pagination 否, number input 20.
// Verifies by reopening; saves the page.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage } from "../src/editor.mjs";
import { widgetSession, probeControls, findControl, controlValue } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page } = await launchSession(config);
const out = { blockId: config.blockId, defaults: { dataSource: "所有产品", pagination: "否", number: "20" } };
try {
  ({ page } = await openEditor(page, config));
  const canvas = await gotoTargetPage(page, config);
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置与选取数据", wrapIndex: 1 });
  const probe = await probeControls(session);
  if (probe.reason) throw new Error(probe.reason);
  const find = (pred) => probe.controls.find(pred);
  const dataSource = find((c) => c.type === "radio" && c.name === "selectProdType" && c.label === "所有产品");
  const paginationNo = find((c) => c.type === "radio" && c.name === "pagination" && c.label === "否");
  const number = probe.controls.find((c) => ["text", "number"].includes(c.type) && /^\d+$/.test(c.value)
    && /每页产品数量|显示产品总数量/.test(c.label + c.context));
  out.found = { dataSource: !!dataSource, paginationNo: !!paginationNo, number: number ? number.value : null };
  out.before = {
    dataSource: probe.controls.filter((c) => c.type === "radio" && c.name === "selectProdType" && c.checked).map((c) => c.label),
    pagination: probe.controls.filter((c) => c.type === "radio" && c.name === "pagination" && c.checked).map((c) => c.label),
  };
  if (dataSource) await session.set(dataSource, true);
  if (paginationNo) await session.set(paginationNo, true);
  if (number && number.value !== "20") await session.set(number, "20");
  await session.save();
  await session.open();
  const after = await session.read();
  out.after = {
    dataSource: after.filter((c) => c.type === "radio" && c.name === "selectProdType" && c.checked).map((c) => c.label),
    pagination: after.filter((c) => c.type === "radio" && c.name === "pagination" && c.checked).map((c) => c.label),
    number: after.find((c) => c.index === number?.index)?.value,
  };
  out.restored = out.after.dataSource[0] === "所有产品" && out.after.pagination[0] === "否" && out.after.number === "20";
  await session.cancel();
  await savePage(page);
  out.saved = true;
} finally {
  fs.writeFileSync("hidden/restore-47748-defaults.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
