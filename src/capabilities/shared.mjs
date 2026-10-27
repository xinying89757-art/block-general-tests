import { savePage } from '../editor.mjs';

export const TIMEOUT = 10_000;
export const blockSelector = (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`;
// Preview root: the data-appid wrap exists for every block. The LA class
// (e.g. LA40838) is block-specific: 47748 has no LA class in preview, so
// relying on it fails the front layer for blocks that never had one.
export const previewSelector = (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`;

export async function poll(read, accepts) {
  const deadline = Date.now() + TIMEOUT;
  let value;
  do {
    // A read that times out on the last millisecond (or a predicate that
    // cannot handle an empty read) is a non-match, not a crash: callers
    // decide what an unmatched poll means. Without this, a block whose
    // preview never yields groups (47748) fails the baseline check with a
    // 1ms evaluate timeout instead of recording "no groups".
    try { value = await read(Math.max(1, deadline - Date.now())); } catch { value = undefined; }
    try { if (accepts(value)) return { matched: true, value }; } catch { /* non-match */ }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
  } while (Date.now() <= deadline);
  return { matched: false, value };
}

export async function clickSettings(canvas, config, type, wrapIndex = 0) {
  // Several sub-regions can share one type (47748 has two gallery wraps:
  // category at 0, list at 1). wrapIndex picks the nth wrap of that type.
  const button = canvas.locator(blockSelector(config.blockId)).first()
    .locator(`.backstage-blocksEditor-wrap[data-blockseditor-type=${JSON.stringify(type)}]`).nth(wrapIndex)
    .locator('a.backstage-widgettool-btns[id^="editorBtn-"]').first();
  await button.waitFor({ state: 'attached', timeout: TIMEOUT });
  await button.evaluate((node) => node.click());
}

// Browser-side snapshot; keep every radio, including unidentified/unchecked groups.
export function controlsSnapshot(root) {
  const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
  return [...root.querySelectorAll('input, select, textarea')].map((input, index) => {
    const label = norm([...(input.labels || [])].map((node) => node.innerText).join(' ')
      || input.closest('li, label, .el-form-item, div')?.innerText);
    let parent = input.parentElement;
    while (parent && parent !== root && !norm(parent.innerText)) parent = parent.parentElement;
    return {
      index, tag: input.tagName, type: input.type, name: input.name || '', label,
      context: norm(parent?.innerText).slice(0, 300), value: input.value,
      checked: Boolean(input.checked), disabled: input.disabled, readOnly: Boolean(input.readOnly),
      options: input.tagName === 'SELECT' ? [...input.options].map((option) => ({
        value: option.value, label: norm(option.textContent), disabled: option.disabled
          || Boolean(option.closest('optgroup')?.disabled),
      })) : undefined,
    };
  });
}

export function controlValue(control) {
  return ['checkbox', 'radio'].includes(control.type) ? control.checked : control.value;
}

// Identity is checked on every reopen, before any write. Index alone is unsafe.
export function findControl(controls, target) {
  return controls.find((item) => item.index === target.index && item.tag === target.tag
    && item.type === target.type && item.name === target.name && item.label === target.label
    && (!['checkbox', 'radio'].includes(item.type) || item.value === target.value));
}

export function controlSession(root, lifecycle) {
  const read = (timeout = TIMEOUT) => root.evaluate(controlsSnapshot, undefined, { timeout });
  const set = async (target, value) => {
    await root.evaluate((node, { target, value }) => {
      const input = node.querySelectorAll('input, select, textarea')[target.index];
      const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const label = input && norm([...(input.labels || [])].map((label) => label.innerText).join(' ')
        || input.closest('li, label, .el-form-item, div')?.innerText);
      if (!input || input.tagName !== target.tag || input.type !== target.type
        || (input.name || '') !== target.name || label !== target.label || input.disabled
        || (['checkbox', 'radio'].includes(input.type) && input.value !== target.value)) {
        throw new Error('目标控件身份变化、缺失或不可切换');
      }
      if (['checkbox', 'radio'].includes(input.type)) {
        if (input.checked !== value) input.click();
      } else {
        if (input.readOnly) throw new Error('输入框只读');
        const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype
          : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
      }
    }, { target, value }, { timeout: TIMEOUT });
    const settled = await poll(read, (items) => {
      const actual = findControl(items, target);
      return actual && controlValue(actual) === value;
    });
    if (!settled.matched) throw new Error('切换后控件值未达到预期');
  };
  return { root, read, set, ...lifecycle };
}

export function widgetSession({ page, canvas, config, type, title, wrapIndex = 0 }) {
  const root = page.locator('.backstage-dialog.backstage-dialog-widgetsettinsframe')
    .filter({ hasText: title }).filter({ visible: true }).first();
  const anyDialog = page.locator('.backstage-dialog.backstage-dialog-widgetsettinsframe')
    .filter({ visible: true }).first();
  const open = async () => {
    if (!await root.isVisible()) await clickSettings(canvas, config, type, wrapIndex);
    await root.waitFor({ state: 'visible', timeout: TIMEOUT });
    await root.locator('.backstage-dialog-bottom').waitFor({ state: 'visible', timeout: TIMEOUT });
  };
  const close = async (text) => {
    await root.locator('.backstage-dialog-bottom').getByText(text, { exact: true }).click({ timeout: TIMEOUT });
    await root.waitFor({ state: 'hidden', timeout: TIMEOUT });
  };
  // The dismiss button is 取消 in most dialogs but 关闭 in 47748's
  // 设置与选取数据 dialog. Try both, in that order.
  const dismiss = async (dialog) => {
    for (const text of ['取消', '关闭']) {
      const button = dialog.locator('.backstage-dialog-bottom').getByText(text, { exact: true });
      if (await button.count()) {
        await button.click({ timeout: TIMEOUT });
        await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
        return;
      }
    }
    throw new Error('弹窗底部既无取消也无关闭按钮');
  };
  return controlSession(root, { open, save: () => close('保存'),
    cancel: async () => {
      // Close the title-matched dialog when it is open. If a different dialog
      // is open instead (wrong wrap clicked, title mismatch), close that one
      // too: a leftover dialog overlays #saveLayout and breaks the whole run.
      if (await root.isVisible()) { await dismiss(root); return; }
      if (await anyDialog.isVisible()) await dismiss(anyDialog);
    } });
}

// Radio group with any number of options (2-option groups keep using
// radioPersist). Returns skip when the group cannot be located uniquely.
export async function radioGroupPersist({ session, page, name, labels }) {
  const probe = await probeControls(session);
  if (probe.reason) return { status: 'skip', detail: `${name}：${probe.reason}` };
  const options = probe.controls.filter((item) => item.type === 'radio' && labels.includes(item.label));
  const byName = new Map(options.map((item) => [item.name, true]));
  if (options.length !== labels.length || byName.size !== 1
    || options.filter((item) => item.checked).length !== 1 || options.some((item) => item.disabled)) {
    return { status: 'skip', detail: `${name}：无法唯一定位该组选项或当前选中不唯一。`, evidence: options };
  }
  const original = options.find((item) => item.checked);
  const alternate = options.find((item) => !item.checked);
  const groupSession = { ...session,
    set: async (_target, checked) => { await session.set(checked ? original : alternate, true); },
    read: async (...args) => {
      const controls = await session.read(...args);
      const states = options.map((item) => findControl(controls, item));
      if (states.some((item) => !item) || states.filter((item) => item.checked).length !== 1) {
        throw new Error('radio 组保存后未保持唯一选中值');
      }
      return controls;
    } };
  const outcome = await persistControl({ session: groupSession, page, target: original, alternate: false });
  outcome.detail = `${name}（${original.label} → ${alternate.label} → ${original.label}）：${outcome.detail}`;
  return outcome;
}

export async function probeControls(session) {
  try { await session.open(); return { controls: await session.read() }; }
  catch (error) { return { reason: `控件探查不可用：${error.message}` }; }
}

// A mutation is a transaction: verify the alternate persisted value, then always
// attempt recovery, verify it, close the editor UI, and save the restored page.
// Discovery failures skip; failures from the first attempted write onward fail.
export async function persistControl({ session, page, target, alternate, afterSwitch }) {
  const evidence = { control: target.label || target.context, original: controlValue(target), alternate };
  const errors = [];
  let stage = '翻转控件';
  try {
    // A previous transaction ends with the dialog closed. Reopen it here so
    // a persist that follows another one does not fail on a hidden dialog.
    if (typeof session.open === 'function') await session.open();
    await session.set(target, alternate);
    stage = '保存翻转状态';
    await session.save();
    stage = '重开回读翻转状态';
    await session.open();
    const actual = findControl(await session.read(), target);
    evidence.afterSave = actual ? controlValue(actual) : null;
    if (!actual || evidence.afterSave !== alternate) throw new Error('保存后值不符合预期');
    if (afterSwitch) {
      stage = '保存页面及预览效果';
      await session.cancel();
      await afterSwitch(evidence, (next) => { stage = next; });
    }
  } catch (error) { errors.push(`${stage}失败：${error.message}`); }
  finally {
    try {
      stage = '恢复前重新打开';
      await session.cancel();
      await session.open();
      stage = '恢复原值';
      await session.set(target, evidence.original);
      stage = '保存恢复状态';
      await session.save();
      stage = '重开断言恢复';
      await session.open();
      const restored = findControl(await session.read(), target);
      evidence.restored = restored ? controlValue(restored) : null;
      if (!restored || evidence.restored !== evidence.original) throw new Error('未恢复原值');
    } catch (error) { errors.push(`${stage}失败：${error.message}`); }
    // Keep these attempts independent: failed readback must not prevent page save.
    try { await session.cancel(); } catch (error) { errors.push(`退出设置失败：${error.message}`); }
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面失败：${error.message}`); }
  }
  return { status: errors.length ? 'fail' : 'pass',
    detail: `${String(evidence.original)} → ${String(alternate)} → ${String(evidence.original)}；${errors.join('；') || '保存重开回读及恢复页面保存均完成。'}`, evidence };
}

export async function radioPersist({ session, page, name, prefixes, afterSwitch }) {
  const probe = await probeControls(session);
  if (probe.reason) return { status: 'skip', detail: `${name}：${probe.reason}` };
  const options = prefixes.map((prefix) => probe.controls.filter((item) => item.type === 'radio' && item.label.startsWith(prefix)));
  if (options.some((items) => items.length !== 1) || options[0][0].index === options[1][0].index) {
    return { status: 'skip', detail: `${name}：无法按标签前缀唯一定位两个选项。` };
  }
  const pair = options.map(([item]) => item);
  if (pair.some((item) => item.disabled) || pair.filter((item) => item.checked).length !== 1
    || pair[0].name !== pair[1].name) {
    return { status: 'skip', detail: `${name}：选项不可切换或当前值/组归属不唯一。`, evidence: pair };
  }
  const original = pair.find((item) => item.checked);
  const alternate = pair.find((item) => !item.checked);
  // Setting one radio false cannot select its sibling; adapt reads/writes to the
  // original control's boolean value while explicitly clicking the other radio.
  const radioSession = { ...session, set: async (_target, checked) => {
    await session.set(checked ? original : alternate, true);
  }, read: async (...args) => {
    const controls = await session.read(...args);
    const left = findControl(controls, original);
    const right = findControl(controls, alternate);
    if (!left || !right || left.checked === right.checked) throw new Error('radio 组保存后未保持唯一选中值');
    return controls;
  } };
  const outcome = await persistControl({ session: radioSession, page, target: original, alternate: false, afterSwitch });
  outcome.detail = `${name}（${original.label} → ${alternate.label} → ${original.label}）：${outcome.detail}`;
  return outcome;
}
