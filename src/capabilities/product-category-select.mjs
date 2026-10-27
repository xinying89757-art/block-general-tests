import { savePage, openPreview } from '../editor.mjs';
import { widgetSession, probeControls, persistControl, radioPersist, radioGroupPersist, findControl, controlValue, previewSelector, TIMEOUT, checkReportText } from './shared.mjs';

const SUITE = 'capability:product-category-select';
const NAMES = {
  'pcs-state': '产品分类选择方式与分类清单',
  'pcs-mode-persist': '分类选择方式保存回读与恢复',
  'pcs-category-persist': '单个分类勾选保存回读与恢复',
  'pcs-category-front': '分类选择前台效果（导航与 oracle 比对）',
  'pcs-front-note': '产品分类前台可观察性记录',
};
function result(id, status, detail, evidence, textFields = {}) {
  return { id, name: NAMES[id], suite: SUITE, status, detail, ...checkReportText(NAMES[id], status, detail, evidence, id), ...textFields,
    ...(evidence === undefined ? {} : { evidence }) };
}
const outcomeResult = (id, outcome) => result(id, outcome.status, outcome.detail, outcome.evidence);
// Category checkboxes share name leafProdGroup; the 全选 row has no name.
const categoriesOf = (controls) => controls.filter((item) => item.type === 'checkbox'
  && item.name === 'leafProdGroup');

// Category-selection front effect (47748 only; 40838 has no category
// setting and skips — the check needs capability.oracle from the profile).
// Ground truth from probes 2026-10-26:
// - CMS oracle: 产品管理上方分类筛选（a.title_show dropdown）选 测试分类
//   → 共 11 条；前台只展示上架（CMS 上架列 shelve）的 7 个，下架
//   （offShelve：3号、80"-30"、4号、2号）不展示。
// - Setting only the category does NOT filter the list by itself: with
//   partial + only 测试分类, the nav shows only 测试分类, but the list
//   still shows all products (618 total, first 20). Clicking the nav link
//   filters the list (AJAX, URL stays products.html) to exactly the 7
//   on-shelf products, with a "测试分类 ✕ Clear Filters" chip.
async function categoryFrontCheck({ session, page, canvas, context, config, capability }) {
  const id = 'pcs-category-front';
  const oracle = capability?.oracle;
  if (!oracle?.category || !Array.isArray(oracle.onShelf)) {
    return result(id, 'skip', '未提供后台分类和上架产品清单，无法比对。');
  }
  const target = oracle.category;
  const expected = [...oracle.onShelf];
  const offShelfCount = Number.isFinite(oracle.cmsTotal) ? Math.max(0, oracle.cmsTotal - expected.length) : null;
  const errors = [];
  const evidence = { category: target, expected, cmsTotal: oracle.cmsTotal ?? null };
  const probe = await probeControls(session);
  if (probe.reason) return result(id, 'skip', `无法读取产品分类弹窗：${probe.reason}`);
  const mode = probe.controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay');
  const originalMode = mode.find((item) => item.checked)?.label || '选择所有产品分类';
  const originalChecked = categoriesOf(probe.controls || []).filter((item) => item.checked).map((item) => (item.label || '').trim());
  evidence.baseline = { mode: originalMode, checkedCount: originalChecked.length };
  const restore = async () => {
    try {
      await session.cancel();
      await session.open();
      if (originalMode === '选择部分产品分类') {
        const current = await probeControls(session);
        const partial = current.controls?.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.label === '选择部分产品分类');
        if (partial && !partial.checked) {
          await session.set(partial, true);
          await session.save();
          await session.open();
        }
        const now = await probeControls(session);
        for (const item of categoriesOf(now.controls || [])) {
          const want = originalChecked.includes((item.label || '').trim());
          if (item.checked !== want) await session.set(item, want);
        }
        await session.save();
        await session.open();
      }
      const back = await probeControls(session);
      const all = back.controls?.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.label === originalMode);
      if (all) {
        await session.set(all, true);
        await session.save();
      }
      await session.open();
      const after = await probeControls(session);
      const restoredMode = after.controls?.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay').find((item) => item.checked)?.label;
      const restoredChecked = categoriesOf(after.controls || []).filter((item) => item.checked).length;
      evidence.restored = { mode: restoredMode, checkedCount: restoredChecked };
      if (restoredMode !== originalMode) errors.push(`恢复后选择方式为 ${restoredMode}，不是 ${originalMode}`);
      if (restoredChecked !== originalChecked.length) errors.push(`恢复后勾选 ${restoredChecked} 个，不是 ${originalChecked.length} 个`);
    } catch (error) { errors.push(`恢复失败：${error.message}`); }
    try { await session.cancel(); } catch {}
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面失败：${error.message}`); }
    // Let the canvas settle after the flip + restore saves: the next
    // capability opens the canvas settings button, and a still-reloading
    // canvas makes its 10s wait time out (seen 2026-10-26).
    try {
      await canvas.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first()
        .waitFor({ state: 'attached', timeout: 30000 });
    } catch {}
  };
  try {
    if (!context) return result(id, 'skip', '未提供浏览器 context，无法打开临时预览。');
    // Flip to partial with only the oracle category.
    // Identify by exact label: every leafProdGroup checkbox has value "on".
    const partial = mode.find((item) => item.label === '选择部分产品分类');
    if (!partial) return result(id, 'na', '本区块没有“选择部分产品分类”设置项。');
    await session.set(partial, true);
    await session.save();
    await session.open();
    const after = await probeControls(session);
    if (after.reason) {
      // Do NOT return early here: the mode was already flipped and saved,
      // so fall through to the finally restore.
      errors.push(`切到部分后无法读取弹窗：${after.reason}`);
    } else {
      for (const item of categoriesOf(after.controls || []).filter((x) => x.checked && (x.label || '').trim() !== target)) {
        await session.set(item, false);
      }
      const targetNow = categoriesOf(after.controls || []).find((item) => (item.label || '').trim() === target);
      if (!targetNow) { errors.push(`切到部分后找不到分类“${target}”`); }
      else if (!targetNow.checked) await session.set(targetNow, true);
      await session.save();
      await savePage(page);
      await session.open();
      const verify = await probeControls(session);
      const persistedMode = verify.controls?.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay').find((item) => item.checked)?.label;
      const persistedChecked = categoriesOf(verify.controls || []).filter((item) => item.checked).map((item) => (item.label || '').trim());
      evidence.persisted = { mode: persistedMode, checked: persistedChecked };
      if (persistedMode !== '选择部分产品分类' || persistedChecked.length !== 1 || persistedChecked[0] !== target) {
        errors.push(`翻转后未保持单分类：方式=${persistedMode}，勾选=[${persistedChecked.join('、')}]`);
      }
      await session.cancel();
    }
    if (errors.length === 0) {
      const flow = await withPreview(page, context, async (frame) => {
        const flowErrors = [];
        const flowEvidence = {};
        const root = frame.locator(previewSelector(config.blockId)).first();
        await root.waitFor({ state: 'attached', timeout: TIMEOUT });
        await frame.waitForTimeout(4000);
        // Nav links live in the category sub-area container .pf-cate-wrap.
        // (Do NOT scope by "anchors before the first product link": the
        // product name IS the anchor itself (<a class="prodlist-pro-name">),
        // so a.querySelector('.prodlist-pro-name') never matches and the
        // old code fell back to all anchors in the block.)
        const navCategories = await root.evaluate((wrap) => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
          const cate = wrap.querySelector('.pf-cate-wrap');
          if (!cate) return null;
          return [...cate.querySelectorAll('a')].map((a) => norm(a.innerText)).filter(Boolean);
        });
        flowEvidence.navLinks = navCategories;
        if (navCategories === null) {
          flowErrors.push('预览里找不到分类导航容器 .pf-cate-wrap');
        } else if (navCategories.length !== 1 || navCategories[0] !== target) {
          flowErrors.push(`分类导航为“${navCategories.join('”、“')}”，应仅显示“${target}”`);
        }
        // Pre-click list (evidence only): setting the category does not
        // filter the list by itself.
        const readNames = () => root.evaluate((wrap) => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
          return [...wrap.querySelectorAll('.prodlist-pro-name')].map((el) => norm(el.innerText));
        });
        const before = await readNames();
        flowEvidence.beforeClick = { count: before.length, names: before };
        const clicked = await frame.evaluate((cat) => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
          const link = [...document.querySelectorAll('a')].find((el) => norm(el.innerText) === cat);
          if (!link) return false;
          link.click();
          return true;
        }, target);
        if (!clicked) {
          flowErrors.push(`预览里找不到分类导航链接“${target}”`);
          return { flowErrors, flowEvidence };
        }
        // Poll until the product set stabilises (AJAX filter, ≤10s).
        let names = [];
        let prev = null;
        for (let i = 0; i < 10; i++) {
          await frame.waitForTimeout(1000);
          names = await readNames();
          if (prev !== null && prev.join('|') === names.join('|')) break;
          prev = names;
        }
        flowEvidence.afterClick = { count: names.length, names };
        const missing = expected.filter((n) => !names.includes(n));
        const extra = names.filter((n) => !expected.includes(n));
        if (missing.length) flowErrors.push(`点分类后列表缺 ${missing.length} 个后台产品：“${missing.join('”、“')}”`);
        if (extra.length) flowErrors.push(`点分类后列表多 ${extra.length} 个非该分类产品：“${extra.join('”、“')}”`);
        return { flowErrors, flowEvidence };
      });
      errors.push(...flow.flowErrors);
      Object.assign(evidence, flow.flowEvidence);
    }
  } catch (error) {
    errors.push(`前台效果验证失败：${error.message}`);
  } finally {
    await restore();
  }
  return result(id,
    errors.length ? 'fail' : 'pass',
    errors.length ? errors.join('；')
      : `只选“${target}”后导航仅剩该分类；点导航后列表为后台的 ${expected.length} 个上架产品，与后台一致${offShelfCount == null ? '' : `，下架 ${offShelfCount} 个不展示`}。`,
    evidence, { expected: `只选“${target}”后导航应只显示该分类；点击后应显示后台的 ${expected.length} 个上架产品${offShelfCount == null ? '' : `，并排除 ${offShelfCount} 个下架产品`}。` });
}

// Open a throwaway preview tab, run fn on its content frame, then close
// the tab. Same pattern as product-list-display.
async function withPreview(page, context, fn) {
  const before = new Set(context.pages());
  try {
    await savePage(page);
    const preview = await openPreview(page, context);
    return await fn(preview.frame, preview.previewPage);
  } finally {
    for (const tab of context.pages().filter((tab) => !before.has(tab) && tab !== page)) {
      try { if (!tab.isClosed()) await tab.close(); } catch {}
    }
  }
}

export async function runSettingsLayer({ page, canvas, context, config, capability }) {
  const session = widgetSession({ page, canvas, config,
    type: 'phoenix_blocks_gallery', title: capability?.dialogTitle || '设置产品分类',
    wrapIndex: capability?.wrapIndex ?? 0 });
  const initial = await probeControls(session);
  const checks = [];
  try {
    if (initial.reason) return Object.keys(NAMES).filter((id) => id !== 'pcs-front-note')
      .map((id) => result(id, 'skip', `无法读取产品分类弹窗：${initial.reason}`));
    const categories = categoriesOf(initial.controls);
    const mode = initial.controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay');
    const modeChecked = mode.find((item) => item.checked);
    checks.push(result('pcs-state', 'record',
      `选择方式=${modeChecked ? modeChecked.label : '未知'}；分类 ${categories.length} 个，已勾选 ${categories.filter((item) => item.checked).length} 个。`,
      { mode: modeChecked?.label, categories: categories.map((item) => ({ label: item.label, checked: item.checked, disabled: item.disabled })) }));
    checks.push(outcomeResult('pcs-mode-persist', await radioPersist({ session, page,
      name: '分类选择方式', prefixes: ['选择所有产品分类', '选择部分产品分类'] })));
    // Category checkboxes are disabled while mode is 选择所有产品分类, so
    // the category transaction first switches to 选择部分产品分类, flips one
    // category, then restores the mode. Each step reopens and verifies.
    const categoryCheck = await (async () => {
      const probe = await probeControls(session);
      if (probe.reason) return result('pcs-category-persist', 'skip', probe.reason);
      const currentMode = probe.controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay').find((item) => item.checked);
      if (!currentMode) return result('pcs-category-persist', 'skip', '无法读取当前分类选择方式。');
      const errors = [];
      const modeWasAll = currentMode.label === '选择所有产品分类';
      try {
        if (modeWasAll) {
          const partial = probe.controls.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.label === '选择部分产品分类');
          if (!partial) return result('pcs-category-persist', 'skip', '找不到“选择部分产品分类”选项。');
          await session.set(partial, true);
          await session.save();
          await session.open();
        }
        const afterMode = await probeControls(session);
        if (afterMode.reason) return result('pcs-category-persist', 'skip', afterMode.reason);
        const target = categoriesOf(afterMode.controls).find((item) => !item.disabled);
        if (!target) return result('pcs-category-persist', 'skip', '切到“部分”后仍无可切换的分类。');
        const outcome = await persistControl({ session, page, target, alternate: !target.checked });
        return result('pcs-category-persist', outcome.status,
          `分类“${target.label}”：${outcome.detail}`, outcome.evidence);
      } catch (error) { errors.push(error.message); return result('pcs-category-persist', 'fail', errors.join('；')); }
      finally {
        if (modeWasAll) {
          try {
            await session.cancel();
            await session.open();
            const back = await probeControls(session);
            const all = back.controls?.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.label === '选择所有产品分类');
            if (all) {
              await session.set(all, true);
              await session.save();
              await session.open();
              const restored = findControl(await session.read(), all);
              if (!restored?.checked) errors.push('选择方式未恢复为“选择所有产品分类”');
            }
          } catch (error) { errors.push(`恢复选择方式失败：${error.message}`); }
          try { await session.cancel(); } catch {}
          if (errors.length) {
            const last = checks.at(-1);
            if (last && last.id === 'pcs-category-persist') { last.status = 'fail'; last.detail += `；${errors.join('；')}`; }
          }
        }
      }
    })();
    checks.push(categoryCheck);
    checks.push(await categoryFrontCheck({ session, page, canvas, context, config, capability }));
  } finally {
    try { await session.cancel(); } catch (error) {
      const last = checks.at(-1);
      if (last) { last.status = 'fail'; last.detail += `；最终取消失败：${error.message}`; }
    }
  }
  return checks;
}

export async function runFrontLayer({ frame, config }) {
  try {
    const root = frame.locator(previewSelector(config.blockId)).first();
    await root.waitFor({ state: 'attached', timeout: TIMEOUT });
    const text = await root.evaluate((node) => (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500));
    return [result('pcs-front-note', 'record', '预览里分类导航可观察，本项只记录前 500 字文本，不判断导航效果是否正确。', { text })];
  } catch (error) {
    return [result('pcs-front-note', 'record', `分类前台可观察性探查不可用：${error.message}`)];
  }
}
