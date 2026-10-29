// Probe (writes ONE value to ONE existing fixture product, then re-reads):
// why doesn't the AUTOTEST-多选 value stick on 测试产品A? Steps:
// 1. Open the product edit page, dump the AUTOTEST-多选 control group
//    (tag/type/name/visibility/labels/checked) and the save button.
// 2. Check 多选4-10 via the same DOM click productFields uses; read back
//    the in-DOM checked state.
// 3. Click 保存; record whether/when the 重复确认 dialog appears, click
//    确定, and watch the page for 20s (URL? toast? network? dialog gone?).
// 4. Reopen the product in a fresh goto and read the AUTOTEST-多选 value.
// If the value still isn't there, the save path (not the checkbox) is broken.
import fs from "node:fs";
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor } from '../../src/editor.mjs';

const config = loadConfig();
const out = { at: new Date().toISOString(), site: config.siteDomain, steps: {} };
const PROD_ID = 'ENULQuzRFljy'; // 测试产品A
const session = await launchSession(config);
try {
  const { page } = await openEditor(session.page, config);
  const cms = await session.context.newPage();
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  out.steps.group = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const title = (t) => norm(t).replace(/^[*＊]\s*/, '').replace(/\s*[：:]$/, '');
    const labels = [...document.querySelectorAll('label, th, td, span, div, dt')]
      .filter((node) => title(node.textContent) === 'AUTOTEST-多选'
        && ![...node.children].some((child) => title(child.textContent) === 'AUTOTEST-多选'));
    const info = { labelMatches: labels.length, groups: [] };
    for (const label of labels) {
      for (let parent = label; parent && !['BODY', 'HTML', 'FORM'].includes(parent.tagName); parent = parent.parentElement) {
        const controls = [...parent.querySelectorAll('input[type="radio"], input[type="checkbox"], select')]
          .filter((input) => input.getClientRects().length || [...(input.labels || [])].some((l) => l.getClientRects().length));
        if (!controls.length) continue;
        info.groups.push(controls.map((input) => ({
          tag: input.tagName, type: input.type, name: input.name, value: input.value,
          visible: Boolean(input.getClientRects().length),
          checked: input.checked, disabled: input.disabled,
          label: norm([...(input.labels || [])].map((l) => l.innerText).join(' ')) || norm((input.closest('label') || input.parentElement)?.innerText),
          cls: norm(input.className).slice(0, 60),
        })));
        break;
      }
    }
    info.saveButtons = [...document.querySelectorAll('button, a, input[type="submit"], input[type="button"]')]
      .filter((node) => node.getClientRects().length && /^(保存|提交)$/.test(norm(node.innerText || node.value)))
      .map((node) => ({ tag: node.tagName, text: norm(node.innerText || node.value), cls: norm(node.className).slice(0, 60) }));
    return info;
  });
  // 2. Check 多选4-10 the way productFields does (DOM click on the input).
  out.steps.click = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((input) => norm([...(input.labels || [])].map((l) => l.innerText).join(' '))
        === '多选4-10');
    if (inputs.length !== 1) return { found: inputs.length, error: 'target not unique' };
    const before = inputs[0].checked;
    inputs[0].click();
    return { found: 1, before, after: inputs[0].checked,
      afterLabel: norm([...(inputs[0].labels || [])].map((l) => l.innerText).join(' ')) };
  });
  // 3. Click 保存 and watch for the confirm dialog.
  const saveClick = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const btn = [...document.querySelectorAll('button, a, input[type="submit"], input[type="button"]')]
      .filter((node) => node.getClientRects().length && /^(保存|提交)$/.test(norm(node.innerText || node.value)));
    if (btn.length !== 1) return { found: btn.length };
    btn[0].click();
    return { found: 1, clicked: norm(btn[0].innerText || btn[0].value) };
  });
  out.steps.saveClick = saveClick;
  const dialogSeen = [];
  for (let i = 0; i < 40; i++) {
    await cms.waitForTimeout(500);
    const state = await cms.evaluate(() => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
      const text = norm(document.body.innerText);
      const confirmBtns = [...document.querySelectorAll('button, a')]
        .filter((b) => visible(b) && /^(确定|确认)$/.test(norm(b.innerText)))
        .map((b) => norm(b.innerText));
      return { hasRepeatConfirm: /重复确认/.test(text), confirmBtns,
        bodyTail: text.slice(-200) };
    });
    dialogSeen.push({ t: (i + 1) * 0.5, ...state });
    if (state.hasRepeatConfirm && state.confirmBtns.length) {
      await cms.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
        const btn = [...document.querySelectorAll('button, a')]
          .find((b) => visible(b) && /^(确定|确认)$/.test(norm(b.innerText)));
        btn?.click();
      });
      dialogSeen.push({ t: (i + 1) * 0.5, action: 'clicked 确定' });
      break;
    }
  }
  out.steps.dialogWatch = dialogSeen.filter((s, i) => s.hasRepeatConfirm || s.action || i === 0 || i === dialogSeen.length - 1);
  await cms.waitForTimeout(5_000);
  out.steps.afterSave = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return { url: location.href, bodyTail: norm(document.body.innerText).slice(-200),
      hasRepeatConfirm: /重复确认/.test(norm(document.body.innerText)) };
  });
  // 4. Fresh reopen and read the value.
  await cms.goto(`https://website.leadong.com/prod?invokeAction=prod_new_update&prodId=${PROD_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await cms.waitForTimeout(3_000);
  out.steps.reread = await cms.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((input) => norm([...(input.labels || [])].map((l) => l.innerText).join(' ')) === '多选4-10');
    return { found: inputs.length, checked: inputs.map((i) => i.checked) };
  });
  fs.mkdirSync('hidden', { recursive: true });
  writeFileSync('hidden/probe-40838-multiselect-save-2026-10-28.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  await session.browser.close().catch(() => {});
}
