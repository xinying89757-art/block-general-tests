// Probe CMS round 4: after the editor SSO hop, inspect what auth material
// and origins the session holds, dump the layout page's full link set, and
// try website.leadong.com console paths in the SAME (SSO'd) session.
import { loadConfig } from "../src/config.mjs";
import { launchSession } from "../src/browser.mjs";
import { openEditor } from "../src/editor.mjs";
import fs from "node:fs";

const config = loadConfig();
let { browser, context, page } = await launchSession(config);
const out = {};
try {
  ({ page } = await openEditor(page, config));
  await page.waitForTimeout(3000);
  out.editorUrl = page.url();
  const storage = await context.storageState().catch(() => null);
  out.cookieDomains = [...new Set((storage?.cookies || []).map((c) => c.domain))];
  out.origins = (storage?.origins || []).map((o) => ({ origin: o.origin, lsKeys: (o.localStorage || []).map((e) => e.name) }));
  out.layoutLinks = await page.evaluate(() => [...document.querySelectorAll("a")]
    .map((a) => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 20), href: a.href.slice(0, 120) }))
    .filter((l) => l.href && !l.href.startsWith("javascript"))
    .slice(0, 30));
  const tries = [
    "https://website.leadong.com/phoenix/admin/user/index",
    "https://website.leadong.com/phoenix/admin/home",
    "https://website.leadong.com/",
  ];
  out.tries = [];
  for (const u of tries) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page.waitForTimeout(4500);
      out.tries.push({
        u, finalUrl: page.url(),
        text: await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 220)),
      });
    } catch (e) { out.tries.push({ u, error: e.message.slice(0, 100) }); }
  }
} finally {
  fs.writeFileSync("hidden/cms-probe6.json", JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(JSON.stringify(out, null, 2).slice(0, 5500));
