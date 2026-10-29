// Probe (no save, no data created): why does filling the enum option inputs
// not write valid JSON into #submitFieldOptionJson (field.fieldOptionJson)?
// Opens the add-field form, selects 多选按钮, then tries fill+blur,
// real keystrokes, and manual event dispatch, reading the hidden field
// after each step. Never clicks save.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor } from '../src/editor.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const hiddenValue = (page) => page.locator('#submitFieldOptionJson').inputValue().catch(() => null);
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await session.context.newPage();
  await cms.goto('https://website.leadong.com/prod', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  // Field list (DOM click, as the probes do).
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    [...document.querySelectorAll('a, button')]
      .find((b) => b.getClientRects().length && norm(b.innerText) === '管理自定义字段')?.click();
  });
  await cms.waitForTimeout(3_000);
  await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    [...document.querySelectorAll('a, button')]
      .find((b) => b.getClientRects().length && norm(b.innerText) === '添加自定义字段')?.click();
  });
  await cms.locator('input[name="field.fieldName"]').waitFor({ state: 'visible', timeout: 15_000 });
  await cms.locator('input[name="field.fieldName"]').fill('AUTOTEST-探针');
  await cms.locator('input[name="field.fieldStatus"][value="1"]').check();
  await cms.locator('input[name="field.fieldType"][value="3"]').check();
  await cms.waitForTimeout(1_000);

  const optionInputs = () => cms.locator('input[name="field.fieldName"]')
    .locator('xpath=ancestor::*[.//*[@id="submitFieldOptionJson"]][1]')
    .locator('input[type="text"]:not([name]), input[type="text"][name=""]')
    .filter({ visible: true });
  out.steps.form = {
    optionInputCount: await optionInputs().count(),
    hiddenInitial: await hiddenValue(cms),
    hiddenName: await cms.locator('#submitFieldOptionJson').getAttribute('name').catch(() => null),
    hiddenType: await cms.locator('#submitFieldOptionJson').getAttribute('type').catch(() => null),
    optionInputHtml: await optionInputs().first().evaluate((el) => el.outerHTML).catch((e) => `error: ${e.message}`),
    // Inline handlers / jQuery data on the first option input.
    handlers: await optionInputs().first().evaluate((el) => {
      const attrs = [...el.attributes].map((a) => `${a.name}=${a.value}`).filter((s) => /^on/i.test(s));
      const jq = window.jQuery && window.jQuery._data ? window.jQuery._data(el, 'events') : null;
      return { inline: attrs, jqueryEvents: jq ? Object.keys(jq) : null };
    }).catch((e) => `error: ${e.message}`),
  };

  // 1. fill + blur, exactly like the runner.
  await optionInputs().nth(0).fill('多选4-10');
  await optionInputs().nth(0).blur();
  await cms.waitForTimeout(500);
  out.steps.afterFillBlur = { value: await optionInputs().nth(0).inputValue(), hidden: await hiddenValue(cms) };

  // 2. Real keystrokes on top of the filled value (append one char, then delete it).
  await optionInputs().nth(0).pressSequentially('X', { delay: 50 });
  await cms.waitForTimeout(500);
  out.steps.afterKeystroke = { value: await optionInputs().nth(0).inputValue(), hidden: await hiddenValue(cms) };
  await optionInputs().nth(0).press('Backspace');
  await cms.waitForTimeout(500);
  out.steps.afterBackspace = { value: await optionInputs().nth(0).inputValue(), hidden: await hiddenValue(cms) };

  // 3. Manual event dispatch: input, change, keyup.
  await optionInputs().nth(0).evaluate((el) => {
    for (const type of ['input', 'change', 'keyup', 'keydown']) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }
  });
  await cms.waitForTimeout(500);
  out.steps.afterDispatch = { value: await optionInputs().nth(0).inputValue(), hidden: await hiddenValue(cms) };

  // 4. Click "+ 添加选择项", then type option 2 with real keystrokes.
  const addBtn = cms.getByText(/^\+\s*添加选择项/).filter({ visible: true });
  out.steps.addButtonCount = await addBtn.count();
  if (await addBtn.count()) {
    await addBtn.first().click();
    await cms.waitForTimeout(500);
    out.steps.afterAdd = { optionInputCount: await optionInputs().count(), hidden: await hiddenValue(cms) };
    await optionInputs().nth(1).click();
    await optionInputs().nth(1).pressSequentially('多选8-10', { delay: 50 });
    await optionInputs().nth(1).blur();
    await cms.waitForTimeout(500);
    out.steps.afterSecondOption = {
      values: await optionInputs().evaluateAll((nodes) => nodes.map((n) => n.value)),
      hidden: await hiddenValue(cms),
    };
  }
  writeFileSync('hidden/probe-cms-field-options-fill-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
