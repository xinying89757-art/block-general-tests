// Independent effect transactions. Only the caller's block and throwaway
// previews are inspected. The journal is populated BEFORE each attempted write.
import { savePage, openPreview } from '../editor.mjs';
import { baselineRestoreTarget, blockSelector, probeControls, findControl, controlValue, TIMEOUT } from './shared.mjs';
import { waitForStable, readBackWithRetry } from '../ui-waits.mjs';
import { assertAllowedLinkUrl } from '../url-safety.mjs';

export const sameSet = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
export const sentenceList = (items) => items.length ? items.join('、') : '无';
export function unavailable(message, status = 'skip') {
  throw Object.assign(new Error(message), { effectStatus: status });
}
export function uniqueControl(items, predicate, absentMessage) {
  const found = items.filter(predicate);
  if (!found.length) unavailable(absentMessage, 'na');
  if (found.length !== 1) unavailable('无法唯一确定设置项，未改写该项。');
  return found[0];
}

export async function withEffectPreview(page, context, inspect) {
  if (!context) unavailable('未提供浏览器环境，无法打开临时预览。');
  const before = new Set(context.pages());
  try {
    await savePage(page);
    const preview = await openPreview(page, context);
    return await inspect(preview.frame, preview.previewPage);
  } finally {
    const errors = [];
    for (const tab of context.pages().filter((tab) => tab !== page && !before.has(tab))) {
      try { if (!tab.isClosed()) await tab.close(); } catch (error) { errors.push(error.message); }
    }
    if (errors.length) throw new Error(`关闭临时预览失败：${errors.join('；')}`);
  }
}

export async function readEffectRoot(frame, config, read, argument) {
  const root = frame.locator(blockSelector(config.blockId)).first();
  try {
    await root.waitFor({ state: 'attached', timeout: TIMEOUT });
    return await waitForStable((timeout) => root.evaluate(read, argument, { timeout }));
  } catch (error) {
    if (error.effectStatus) throw error;
    unavailable('目标区块的静态内容暂时读不到，需实站核实渲染及读取位置。');
  }
}

export async function effectCheck({ id, result, page, canvas, context, config, session, layer, run }) {
  if (config.deferFront && layer === 'front') {
    return result(id, 'deferred', 'deferred-to-front-runner', { deferred: true });
  }
  console.log(`[progress] ${new Date().toISOString()} 效果检查开始：${id}`);
  const errors = [], evidence = { observations: [], restored: [] }, journal = new Map(), pending = new Map();
  let status = 'pass', detail = '', expected;
  const controls = async () => {
    const probe = await probeControls(session);
    if (probe.reason) unavailable('设置面板暂时读不到，未能继续效果检查。');
    return probe.controls;
  };
  const tx = {
    evidence, controls,
    expected: (text) => { expected = text; },
    baselineValue: (type, label) => config.baselineValue?.(type, label),
    note: (text) => evidence.observations.push(text),
    assert: (okay, text) => { evidence.observations.push(text); if (!okay) errors.push(text); },
    set: async (target, value) => {
      if (/链接网址/.test(target.label || '')) assertAllowedLinkUrl(value);
      const items = await controls();
      const current = findControl(items, target);
      if (!current) unavailable('设置项身份已变化，无法安全改写。');
      if (controlValue(current) === value) return;
      if (current.disabled || current.readOnly) unavailable('目标设置项当前不能编辑。');
      const radio = current.type === 'radio';
      if (radio && (!current.name || value !== true)) unavailable('单选组归属不明确，无法安全改写。');
      const key = radio ? `radio:${current.name}` : `control:${current.index}`;
      if (!journal.has(key)) {
        const original = radio ? items.filter((item) => item.type === 'radio' && item.name === current.name && item.checked) : [current];
        if (original.length !== 1) unavailable('当前单选组没有唯一选中项。');
        const snapshot = controlValue(original[0]);
        const baseline = config.baselineCapabilityId === 'button-link'
          ? config.baselineValue?.('phoenix_blocks_button', original[0].label) : undefined;
        const restore = baselineRestoreTarget({ snapshot, baselineValue: baseline,
          defaultValue: original[0].label === '按钮文本' ? 'Please set up the required pop-up form here.' : 'javascript:void(0)' });
        journal.set(key, { target: original[0], value: restore.value });
        if (restore.source !== 'snapshot') {
          (evidence.restoreTargets ||= []).push({ label: original[0].label, value: restore.value,
            source: restore.source, snapshot });
        }
      }
      pending.set(key, { target: current, value });
      await session.set(current, value);
    },
    // For controls with a dedicated UI (Spectrum and button link type tabs).
    remember: (key, restore) => { if (!journal.has(key)) journal.set(key, { restore }); },
    save: async () => {
      await session.save();
      await session.open();
      const matches = (items) => [...pending.values()].every(({ target, value }) => {
        const item = findControl(items, target);
        return item && controlValue(item) === value;
      });
      const items = await readBackWithRetry(() => session.read(), matches,
        async () => { await session.cancel(); await session.open(); });
      if (!matches(items)) throw new Error('效果检查的设置值保存后未保持');
      pending.clear();
      await session.cancel();
      await savePage(page);
    },
    observe: async (read, argument) => layer === 'backend'
      ? readEffectRoot(canvas, config, read, argument)
      : withEffectPreview(page, context, (frame, previewPage) => read(frame, previewPage)),
  };
  try {
    if (layer === 'front' && !context) unavailable('未提供浏览器环境，无法打开临时预览。');
    await run(tx);
    detail = evidence.observations.join('；') || '设置对应的效果与预期一致。';
  } catch (error) {
    status = error.effectStatus || 'fail';
    detail = error.effectStatus ? error.message : '效果检查操作失败，详细错误保留在结构化证据中。';
    evidence.error = error.message;
    if (!error.effectStatus) errors.push(detail);
  } finally {
    // Each undo/save is independent so a failed undo cannot suppress the rest.
    for (const { target, value, restore } of [...journal.values()].reverse()) {
      try {
        await session.cancel();
        await session.open();
        if (restore) await restore();
        else {
          const current = findControl(await session.read(), target);
          if (!current) throw new Error('恢复时设置项身份变化');
          if (controlValue(current) !== value) await session.set(current, value);
          await session.save();
          await session.open();
          const back = await readBackWithRetry(() => session.read(),
            (items) => controlValue(findControl(items, target) || {}) === value,
            async () => { await session.cancel(); await session.open(); });
          if (controlValue(findControl(back, target) || {}) !== value) throw new Error('恢复后重开读值不一致');
          evidence.restored.push({ label: target.label, value });
        }
      } catch (error) {
        errors.push('恢复原设置失败，需检查原始证据。');
        (evidence.restoreErrors ||= []).push(error.message);
      }
    }
    try { await session.cancel(); } catch (error) { errors.push('退出设置面板失败。'); evidence.dismissError = error.message; }
    if (journal.size) {
      try { await savePage(page); } catch (error) { errors.push('保存恢复后的页面失败。'); evidence.saveError = error.message; }
    }
  }
  if (errors.length) { status = 'fail'; detail = `${detail}；${errors.join('；')}`; }
  return result(id, status, detail, evidence, {
    ...(expected ? { expected } : {}), actual: detail,
    evidenceText: [...evidence.observations, ...(status === 'pass' ? ['已在同一次浏览器会话中恢复原设置并保存页面。'] : [detail])],
  });
}

// All snapshots count visible content; hidden grid/list duplicates are excluded.
export function productSnapshot(root) {
  const visible = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const names = [...root.querySelectorAll('.prodlist-pro-name')].filter(visible).map((node) => norm(node.innerText));
  return { names, hasList: Boolean(root.querySelector('.one-pruduct-list, .pf-list-wrap, .one-pruduct-item')), count: names.length };
}

// Switching all/partial may itself rewrite checkbox state. Capture the entire
// original list BEFORE the radio changes, including currently disabled items.
export function rememberCategoryState(tx, session, items, modeName) {
  const modes = items.filter((item) => item.type === 'radio' && item.name === modeName);
  const original = modes.filter((item) => item.checked);
  const partial = modes.find((item) => item.label === '选择部分产品分类');
  const boxes = items.filter((item) => item.type === 'checkbox' && item.name === 'leafProdGroup');
  if (original.length !== 1 || !partial || !boxes.length) unavailable('不能完整记录原分类方式和勾选清单，未改写。');
  tx.remember(`category-state:${modeName}`, async () => {
    const fresh = async (target) => {
      const current = findControl(await session.read(), target);
      if (!current) throw new Error('恢复分类时控件身份变化');
      return current;
    };
    await session.set(await fresh(partial), true); await session.save(); await session.open();
    for (const box of boxes) {
      const current = await fresh(box);
      if (current.checked !== box.checked) await session.set(current, box.checked);
    }
    await session.save(); await session.open();
    const restoredBoxes = await session.read();
    if (!boxes.every((box) => findControl(restoredBoxes, box)?.checked === box.checked)) throw new Error('分类勾选清单未完整恢复');
    await session.set(await fresh(original[0]), true); await session.save(); await session.open();
    const after = await session.read();
    if (!findControl(after, original[0])?.checked || !boxes.every((box) => findControl(after, box)?.checked === box.checked)) throw new Error('恢复原分类方式后勾选清单变化');
    tx.evidence.restoredCategoryState = { mode: original[0].label, checked: boxes.filter((box) => box.checked).map((box) => box.label) };
  });
}
