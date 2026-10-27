// Inspect how the editor's own JS collects custom-field values on save:
// search inline scripts and the page's JS bundles for option_/fieldSelect.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await page.goto("https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=ENULQuzRFljy", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  out.inline = await page.evaluate(() => {
    const hits = [];
    for (const s of document.querySelectorAll("script:not([src])")) {
      const t = s.textContent || "";
      for (const kw of ["fieldSelect", "option_", "doUpdate", "customField"]) {
        let i = t.indexOf(kw);
        while (i >= 0 && hits.length < 14) {
          hits.push({ kw, ctx: t.slice(Math.max(0, i - 90), i + 130).replace(/\s+/g, " ") });
          i = t.indexOf(kw, i + 1);
        }
      }
    }
    return hits;
  });
  out.scriptSrcs = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.src).filter((u) => /prod|edit|custom/i.test(u)).slice(0, 10));
} finally {
  fs.writeFileSync("hidden/prod-js-probe.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
