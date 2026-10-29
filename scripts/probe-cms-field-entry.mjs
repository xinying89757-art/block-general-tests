// Probe (read-only): why did fixture-prep time out waiting for the
// "管理自定义字段" entry (action=prod_field_list) on /prod?
// Opens /prod in a NEW tab of the same context after openEditor, exactly
// like src/cms.mjs openProdPage does, then dumps the menu/action state.
// No clicks that change data; only navigates to the field-list page to
// confirm the entry works.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await session.context.newPage();
  await cms.goto('https://website.leadong.com/prod', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  out.steps.afterGoto = {
    url: cms.url(),
    title: await cms.title(),
    passwordInputs: await cms.locator('input[type="password"]:visible').count(),
    prodListVisible: await cms.locator('[action="prod_list"], [data-action="prod_list"]').filter({ visible: true }).count(),
  };
  out.steps.actions = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('[action], [data-action]')]
      .map((el) => ({ tag: el.tagName, action: el.getAttribute('action') || el.getAttribute('data-action'),
        text: norm(el.innerText).slice(0, 40), visible: Boolean(el.getClientRects().length) }))
      .filter((row) => row.action === 'prod_field_list' || /自定义字段/.test(row.text));
  });
  out.steps.customFieldText = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('a, button')]
      .filter((el) => /自定义字段/.test(norm(el.innerText)))
      .map((el) => ({ tag: el.tagName, action: el.getAttribute('action'), text: norm(el.innerText),
        visible: Boolean(el.getClientRects().length),
        parentText: norm(el.parentElement?.innerText).slice(0, 80) }));
  });
  // Try the exact locator the runner uses, then fall back to a plain DOM click.
  const entry = cms.locator('[action="prod_field_list"], [data-action="prod_field_list"]')
    .filter({ visible: true }).filter({ hasText: /^管理自定义字段$/ });
  out.steps.runnerLocatorCount = await entry.count().catch((e) => `error: ${e.message}`);
  await cms.waitForTimeout(5_000);
  out.steps.runnerLocatorCountAfterWait = await entry.count().catch((e) => `error: ${e.message}`);
  const target = out.steps.customFieldText.find((row) => row.visible && row.text === '管理自定义字段');
  if (target) {
    await cms.evaluate(() => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const el = [...document.querySelectorAll('a, button')]
        .find((b) => b.getClientRects().length && norm(b.innerText) === '管理自定义字段');
      el?.click();
    });
    await cms.waitForTimeout(3_000);
    out.steps.afterClick = { url: cms.url(), title: await cms.title(),
      bodyTextStart: (await cms.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 300) };
  }
  writeFileSync('hidden/probe-cms-field-entry-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 4000));
} finally {
  await session.browser.close().catch(() => {});
}
