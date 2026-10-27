// Probe: the LIST's own category selection (separate from the category
// NAV setting). In the list dialog (设置与选取数据), data source
// (selectProdType) has 选择部分产品分类 (5): picking it reveals a
// category multi-select. Select only 测试分类, save, preview: the list
// itself should show exactly the 7 on-shelf oracle products, no nav click.
// Restore runs in a finally block: data source back to 所有产品.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor, gotoTargetPage, savePage, openPreview } from "../src/editor.mjs";
import { widgetSession, probeControls, previewSelector } from "../src/capabilities/shared.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, page, context } = await launchSession(config);
const out = { blockId: config.blockId, targetCategory: "测试分类",
  expectedOnShelf: ["测试产品A", "测试产品芋圆1", "测试6号", "测试5号",
    "100\"-40\" 2 Bundles Natural Wavy 3A Virgin Brazilian Hair Natural Black 250gC",
    "产品7", "测试产品hap"] };
let canvas;

async function readListDialog() {
  const session = widgetSession({ page, canvas, config,
    type: "phoenix_blocks_gallery", title: "设置与选取数据", wrapIndex: 1 });
  const probe = await probeControls(session);
  return { session, probe };
}
const dataSourceOf = (probe) => (probe.controls || []).filter((c) =>
  c.type === "radio" && c.name === "selectProdType");

try {
  ({ page } = await openEditor(page, config));
  canvas = await gotoTargetPage(page, config);
  try {
    let { session, probe } = await readListDialog();
    out.baseline = { dataSource: dataSourceOf(probe).find((c) => c.checked)?.label,
      allControls: probe.controls?.map((c) => ({ type: c.type, name: c.name, label: (c.label || "").slice(0, 40), checked: c.checked, disabled: c.disabled })) };
    const partial = dataSourceOf(probe).find((c) => c.label === "选择部分产品分类");
    if (!partial) { out.error = "列表弹窗里找不到“选择部分产品分类”"; }
    else {
      await session.set(partial, true);
      await session.save();
      await session.open();
      const after = await probeControls(session);
      // The category multi-select revealed by the partial-category source.
      const catBoxes = (after.controls || []).filter((c) => c.type === "checkbox"
        && c.name !== "langBarSort" && c.label !== "全选" && (c.name || "").includes("Group"));
      out.revealed = { count: catBoxes.length,
        sample: catBoxes.slice(0, 6).map((c) => ({ name: c.name, label: (c.label || "").slice(0, 40), checked: c.checked })),
        allLabels: catBoxes.map((c) => (c.label || "").trim()).slice(0, 50) };
      const target = catBoxes.find((c) => (c.label || "").trim() === "测试分类");
      out.targetFound = !!target;
      if (!target) { out.error = "选择部分分类后，弹窗里找不到 测试分类"; }
      else {
        for (const c of catBoxes.filter((x) => x.checked && (x.label || "").trim() !== "测试分类")) {
          await session.set(c, false);
        }
        if (!target.checked) await session.set(target, true);
        await session.save();
        await savePage(page);
        const verify = await readListDialog();
        out.persisted = { dataSource: dataSourceOf(verify.probe).find((c) => c.checked)?.label,
          checked: (verify.probe.controls || []).filter((c) => c.type === "checkbox" && c.checked).map((c) => (c.label || "").trim()) };
        await verify.session.cancel();

        const preview = await openPreview(page, context);
        const frame = preview.frame;
        const previewPage = preview.previewPage;
        const root = frame.locator(previewSelector(config.blockId)).first();
        await root.waitFor({ state: "attached", timeout: 10000 });
        await frame.waitForTimeout(4000);
        out.preview = await root.evaluate((wrap) => {
          const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
          const names = [...wrap.querySelectorAll(".prodlist-pro-name")].map((el) => norm(el.innerText));
          return { textHead: norm(wrap.innerText).slice(0, 700),
            productNames: names, productCount: names.length };
        });
        out.preview.missing = out.expectedOnShelf.filter((n) => !out.preview.productNames.includes(n));
        out.preview.extra = out.preview.productNames.filter((n) => !out.expectedOnShelf.includes(n));
        try { if (!previewPage.isClosed()) await previewPage.close(); } catch {}
      }
    }
  } finally {
    try {
      const { session, probe } = await readListDialog();
      const all = dataSourceOf(probe).find((c) => c.label === "所有产品");
      if (all) await session.set(all, true);
      await session.save();
      await savePage(page);
      const after = await readListDialog();
      out.restored = { dataSource: dataSourceOf(after.probe).find((c) => c.checked)?.label };
      await after.session.cancel();
    } catch (e) { out.restoreError = e.message.slice(0, 300); }
  }
} finally {
  fs.writeFileSync("hidden/probe-47748-list-category-front.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
