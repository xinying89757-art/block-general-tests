import { normalizeSiteHost } from '../site-baseline.mjs';
import { logMutation, markDone, markFailed } from '../mutation-journal.mjs';
import { effectCheck, unavailable, uniqueControl, readEffectRoot, sameSet, sentenceList, rememberCategoryState, productSnapshot } from './effect-checks.mjs';
import { savePage, openPreview, targetLanguage } from '../editor.mjs';
import { selectFrontProvider, FrontProviderPublishedError } from '../front-provider.mjs';
import { journalSnapshot, blockSelector, widgetSession, probeControls, persistControl, radioPersist, radioGroupPersist, findControl, controlValue, previewSelector, TIMEOUT, checkReportText, readBackWithRetry, fixtureCategoryState } from './shared.mjs';
import { createFreshLifecycle } from '../fresh-settings-adapter.mjs';
import { registerFreshSettingsCapability } from '../setting-units.mjs';

// Keep unknown/ambiguous instance identity null; never select an arbitrary wrap.
async function mutationTarget(canvas, config, profile) {
  const instanceId = await canvas.locator(blockSelector(config.blockId)).evaluateAll((wraps) => {
    if (wraps.length !== 1) return null;
    for (const node of [wraps[0], ...wraps[0].querySelectorAll('*')]) {
      const attribute = [...node.attributes].find((attr) => /setting.?id/i.test(attr.name));
      if (attribute?.value) return attribute.value;
    }
    return null;
  });
  return { siteHost: normalizeSiteHost(config.siteDomain), language: targetLanguage(config),
    pageId: config.pageId ?? profile?.target?.pageId ?? null,
    pageKind: config.resolvedTarget?.kind ?? profile?.target?.pageKind ?? null,
    blockId: config.blockId, instanceId };
}

function mutationContext(canvas, config, profile) {
  return config?.mutationJournal ? { journal: config.mutationJournal,
    target: () => mutationTarget(canvas, config, profile), settingKey: 'product-category-select' } : undefined;
}

const SUITE = 'capability:product-category-select';
export const freshSettings = registerFreshSettingsCapability('product-category-select', createFreshDefinitions);
export const checkGroups = Object.freeze({
  'pcs-persistence': ['settings'],
  'pcs-categories-backend': ['backend'],
});
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

// Category-selection front effect (另一样本区块 only; 样本区块 has no category
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
async function categoryFrontCheck({ session, page, canvas, context, config, capability, profile, report }) {
  const id = 'pcs-category-front';
  const oracle = profile?.fixture?.category ? { category: profile.fixture.category.name, onShelf: profile.fixture.products.map(p => p.name) } : null;
  if (report?.fixture?.applied === false) return result(id, 'skip', '夹具准备失败，不能断言分类产品。');
  { const cat = fixtureCategoryState(profile, report); if (oracle && cat.reason) return result(id, 'skip', cat.reason); }
  if (!oracle?.category || !Array.isArray(oracle.onShelf)) {
    return result(id, 'skip', '未提供后台分类和上架产品清单，无法比对。');
  }
  const categoryName = oracle.category;
  const expected = [...oracle.onShelf];
  const offShelfCount = Number.isFinite(oracle.cmsTotal) ? Math.max(0, oracle.cmsTotal - expected.length) : null;
  const errors = [];
  const evidence = { category: categoryName, expected, cmsTotal: oracle.cmsTotal ?? null };
  const probe = await probeControls(session);
  if (probe.reason) return result(id, 'skip', `无法读取产品分类弹窗：${probe.reason}`);
  const mode = probe.controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay');
  const originalMode = mode.find((item) => item.checked)?.label || '选择所有产品分类';
  const originalChecked = categoriesOf(probe.controls || []).filter((item) => item.checked).map((item) => (item.label || '').trim());
  evidence.baseline = { mode: originalMode, checkedCount: originalChecked.length };
  const journal = config?.mutationJournal;
  let target;
  let mutationSeq;
  const restore = async () => {
    let restoreSeq;
    const restoreErrorCount = errors.length;
    try {
      await session.cancel();
      await session.open();
      if (journal) {
        target ||= await mutationTarget(canvas, config, profile);
        restoreSeq = await logMutation(journal, journalSnapshot({ op: 'restore', target, before: await session.read(),
          after: probe.controls, restore: { kind: 'set-setting', settingKey: 'product-category-select', value: probe.controls } }));
      }
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
      const after = await probeControls(session, (items) =>
        items.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay').find((item) => item.checked)?.label === originalMode
        && categoriesOf(items).filter((item) => item.checked).length === originalChecked.length);
      const restoredMode = after.controls?.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay').find((item) => item.checked)?.label;
      const restoredChecked = categoriesOf(after.controls || []).filter((item) => item.checked).length;
      evidence.restored = { mode: restoredMode, checkedCount: restoredChecked };
      if (restoredMode !== originalMode) errors.push(`恢复后选择方式为 ${restoredMode}，不是 ${originalMode}`);
      if (restoredChecked !== originalChecked.length) errors.push(`恢复后勾选 ${restoredChecked} 个，不是 ${originalChecked.length} 个`);
    } catch (error) {
      if (restoreSeq !== undefined) await markFailed(journal, restoreSeq, error);
      errors.push(`恢复失败：${error.message}`);
    }
    try { await session.cancel(); } catch {}
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面失败：${error.message}`); }
    if (restoreSeq !== undefined) {
      if (errors.length > restoreErrorCount) await markFailed(journal, restoreSeq, new Error(errors.slice(restoreErrorCount).join('；')));
      else await markDone(journal, restoreSeq);
    }
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
    if (journal) {
      target = await mutationTarget(canvas, config, profile);
      mutationSeq = await logMutation(journal, journalSnapshot({ op: 'set-setting', target, before: probe.controls,
        after: probe.controls.map((item) => item.type === 'radio' && item.name === 'selectGroupWay'
          ? { ...item, checked: item.label === '选择部分产品分类' } : item.type === 'checkbox' && item.name === 'leafProdGroup'
            ? { ...item, checked: (item.label || '').trim() === categoryName } : item),
        restore: { kind: 'set-setting', settingKey: 'product-category-select', value: probe.controls } }));
    }
    await session.set(partial, true);
    await session.save();
    await session.open();
    const after = await probeControls(session);
    if (after.reason) {
      // Do NOT return early here: the mode was already flipped and saved,
      // so fall through to the finally restore.
      errors.push(`切到部分后无法读取弹窗：${after.reason}`);
    } else {
      for (const item of categoriesOf(after.controls || []).filter((x) => x.checked && (x.label || '').trim() !== categoryName)) {
        await session.set(item, false);
      }
      const targetNow = categoriesOf(after.controls || []).find((item) => (item.label || '').trim() === categoryName);
      if (!targetNow) { errors.push(`切到部分后找不到分类“${categoryName}”`); }
      else if (!targetNow.checked) await session.set(targetNow, true);
      await session.save();
      await savePage(page);
      await session.open();
      const verify = await probeControls(session, (items) => {
        const checked = categoriesOf(items).filter((item) => item.checked).map((item) => (item.label || '').trim());
        return items.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay').find((item) => item.checked)?.label === '选择部分产品分类'
          && checked.length === 1 && checked[0] === categoryName;
      });
      const persistedMode = verify.controls?.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay').find((item) => item.checked)?.label;
      const persistedChecked = categoriesOf(verify.controls || []).filter((item) => item.checked).map((item) => (item.label || '').trim());
      evidence.persisted = { mode: persistedMode, checked: persistedChecked };
      if (persistedMode !== '选择部分产品分类' || persistedChecked.length !== 1 || persistedChecked[0] !== categoryName) {
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
        } else if (navCategories.length !== 1 || navCategories[0] !== categoryName) {
          flowErrors.push(`分类导航为“${navCategories.join('”、“')}”，应仅显示“${categoryName}”`);
        }
        // Pre-click list (evidence only): setting the category does not
        // filter the list by itself.
        const readNames = () => root.evaluate((wrap) => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
          return [...wrap.querySelectorAll('.prodlist-pro-name')].map((el) => norm(el.innerText));
        });
        const before = await readNames();
        flowEvidence.beforeClick = { count: before.length, names: before };
        // Scoped to the categoryName instance root: a same-named link in another
        // block or nav must never be clicked. Requires exactly one match.
        const clickResult = await root.evaluate(findAndClickCategoryLink, categoryName);
        if (!clickResult.clicked) {
          if (clickResult.reason === 'ambiguous') {
            flowErrors.push(`预览里分类导航链接“${categoryName}”有 ${clickResult.count} 个同名，不敢点（已限定在目标区块内）`);
          } else {
            flowErrors.push(`预览里找不到分类导航链接“${categoryName}”`);
          }
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
        const extra = names.filter((n) => n.startsWith('AUTOTEST-') && !expected.includes(n));
        if (missing.length) flowErrors.push(`点分类后列表缺 ${missing.length} 个后台产品：“${missing.join('”、“')}”`);
        if (extra.length) flowErrors.push(`点分类后列表多 ${extra.length} 个非该分类产品：“${extra.join('”、“')}”`);
        return { flowErrors, flowEvidence };
      });
      errors.push(...flow.flowErrors);
      Object.assign(evidence, flow.flowEvidence);
    }
    if (mutationSeq !== undefined) {
      if (errors.length) await markFailed(journal, mutationSeq, new Error(errors.join('；')));
      else await markDone(journal, mutationSeq);
    }
  } catch (error) {
    if (mutationSeq !== undefined) await markFailed(journal, mutationSeq, error);
    if (error.code === 'FRONT_PROVIDER_PUBLISHED') {
      evidence.frontDeferred = error.message;
    } else {
      errors.push(`前台效果验证失败：${error.message}`);
    }
  } finally {
    await restore();
  }
  if (!errors.length && evidence.frontDeferred) return result(id, 'deferred', evidence.frontDeferred, evidence);
  return result(id,
    errors.length ? 'fail' : 'pass',
    errors.length ? errors.join('；')
      : `只选“${categoryName}”后导航仅剩该分类；点导航后列表为后台的 ${expected.length} 个上架产品，与后台一致${offShelfCount == null ? '' : `，下架 ${offShelfCount} 个不展示`}。`,
    evidence, { expected: `只选“${categoryName}”后导航应只显示该分类；点击后应显示后台的 ${expected.length} 个上架产品${offShelfCount == null ? '' : `，并排除 ${offShelfCount} 个下架产品`}。` });
}

// Open a throwaway preview tab, run fn on its content frame, then close
// the tab. Same pattern as product-list-display.
async function withPreview(page, context, fn) {
  if (selectFrontProvider().provider === 'published') throw new FrontProviderPublishedError();
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

export async function runSettingsLayer({ page, canvas, context, config, capability, profile, report }) {
  const mutation = mutationContext(canvas, config, profile);
  if (config.frontOnly) return categoryEffects({ page, canvas, context, config, capability, profile, report }, 'front');
  const session = widgetSession({ page, canvas, config,
    type: 'phoenix_blocks_gallery', title: capability?.dialogTitle || '设置产品分类',
    wrapIndex: capability?.wrapIndex ?? 0 });
  const initial = await probeControls(session);
  const checks = [];
  try {
    if (initial.reason) return ['pcs-state', 'pcs-mode-persist', 'pcs-category-persist', 'pcs-category-front']
      .map((id) => result(id, 'skip', `无法读取产品分类弹窗：${initial.reason}`));
    const categories = categoriesOf(initial.controls);
    const mode = initial.controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay');
    const modeChecked = mode.find((item) => item.checked);
    checks.push(result('pcs-state', 'record',
      `选择方式=${modeChecked ? modeChecked.label : '未知'}；分类 ${categories.length} 个，已勾选 ${categories.filter((item) => item.checked).length} 个。`,
      { mode: modeChecked?.label, categories: categories.map((item) => ({ label: item.label, checked: item.checked, disabled: item.disabled })) }));
    checks.push(outcomeResult('pcs-mode-persist', await radioPersist({ mutation, session, page,
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
      const journal = config?.mutationJournal;
      let journalTarget;
      let mutationSeq;
      try {
        if (modeWasAll) {
          const partial = probe.controls.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.label === '选择部分产品分类');
          if (!partial) return result('pcs-category-persist', 'skip', '找不到“选择部分产品分类”选项。');
          if (journal) {
            journalTarget = await mutationTarget(canvas, config, profile);
            mutationSeq = await logMutation(journal, journalSnapshot({ op: 'set-setting', target: journalTarget, before: probe.controls,
              after: probe.controls.map((item) => item.type === 'radio' && item.name === 'selectGroupWay'
                ? { ...item, checked: item.label === '选择部分产品分类' } : item),
              restore: { kind: 'set-setting', settingKey: 'product-category-select', value: probe.controls } }));
          }
          await session.set(partial, true);
          await session.save();
          await session.open();
        }
        const afterMode = await probeControls(session);
        if (mutationSeq !== undefined) {
          if (afterMode.reason) await markFailed(journal, mutationSeq, new Error(afterMode.reason));
          else await markDone(journal, mutationSeq);
        }
        if (afterMode.reason) return result('pcs-category-persist', 'skip', afterMode.reason);
        const target = categoriesOf(afterMode.controls).find((item) => !item.disabled && item.label.trim() === profile?.fixture?.category?.name);
        if (!target) return result('pcs-category-persist', 'skip', '切到“部分”后仍无可切换的分类。');
        const outcome = await persistControl({ mutation, session, page, target, alternate: !target.checked });
        return result('pcs-category-persist', outcome.status,
          `分类“${target.label}”：${outcome.detail}`, outcome.evidence);
      } catch (error) {
        if (mutationSeq !== undefined) await markFailed(journal, mutationSeq, error);
        errors.push(error.message); return result('pcs-category-persist', 'fail', errors.join('；'));
      }
      finally {
        if (modeWasAll) {
          let restoreSeq;
          try {
            await session.cancel();
            await session.open();
            const back = await probeControls(session);
            const all = back.controls?.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.label === '选择所有产品分类');
            if (all) {
              if (journal) {
                journalTarget ||= await mutationTarget(canvas, config, profile);
                restoreSeq = await logMutation(journal, journalSnapshot({ op: 'restore', target: journalTarget, before: back.controls,
                  after: probe.controls, restore: { kind: 'set-setting', settingKey: 'product-category-select', value: probe.controls } }));
              }
              await session.set(all, true);
              await session.save();
              await session.open();
              const restored = await readBackWithRetry(
                async () => findControl(await session.read(), all), (item) => item?.checked,
                async () => { await session.cancel(); await session.open(); });
              if (!restored?.checked) errors.push('选择方式未恢复为“选择所有产品分类”');
              if (restoreSeq !== undefined) {
                if (!restored?.checked) await markFailed(journal, restoreSeq, new Error(errors.at(-1)));
                else await markDone(journal, restoreSeq);
              }
            }
          } catch (error) {
            if (restoreSeq !== undefined) await markFailed(journal, restoreSeq, error);
            errors.push(`恢复选择方式失败：${error.message}`);
          }
          try { await session.cancel(); } catch {}
          if (errors.length) {
            const last = checks.at(-1);
            if (last && last.id === 'pcs-category-persist') { last.status = 'fail'; last.detail += `；${errors.join('；')}`; }
          }
        }
      }
    })();
    checks.push(categoryCheck);
    if (!config.checkGroup) {
      checks.push(config.deferFront ? result('pcs-category-front', 'deferred', 'deferred-to-front-runner', { deferred: true })
        : await categoryFrontCheck({ session, page, canvas, context, config, capability, profile, report }));
    }
  } finally {
    try { await session.cancel(); } catch (error) {
      const last = checks.at(-1);
      if (last) { last.status = 'fail'; last.detail += `；最终取消失败：${error.message}`; }
    }
  }
  if (!config.checkGroup) checks.push(...await categoryEffects({ page, canvas, context, config, capability, profile, report }, 'front'));
  return checks;
}

export async function runFrontEffectsLayer(args) {
  const session = widgetSession({ ...args, type: 'phoenix_blocks_gallery', title: args.capability?.dialogTitle || '设置产品分类',
    wrapIndex: args.capability?.wrapIndex ?? 0 });
  await session.open();
  let check;
  try { check = await categoryFrontCheck({ ...args, session }); }
  finally { await session.cancel().catch(() => {}); }
  return [check, ...await categoryEffects(args, 'front')];
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

Object.assign(NAMES, {
  'pcs-mode-backend': '所有与部分分类在画布生效',
  'pcs-mode-front': '所有与部分分类在预览生效',
  'pcs-categories-backend': '画布分类导航完整集合',
  'pcs-categories-front': '预览分类导航完整集合',
});
function categoryNavigation(root) {
  const nav = root.querySelector('.pf-cate-wrap');
  if (!nav) return null;
  // The editor inserts its toolbar INSIDE .pf-cate-wrap. Scoping to the
  // container alone still includes 设置 / 编辑样式 (both widgettool-btns).
  const entries = [...nav.querySelectorAll('a')]
    .filter((node) => !node.closest('.backstage-widgettool-btns'))
    .map((node) => {
      let depth = 0;
      for (let parent = node.parentElement; parent && parent !== nav; parent = parent.parentElement) {
        if (parent.tagName === 'LI') depth++;
      }
      return { name: (node.textContent || '').replace(/\s+/g, ' ').trim(), depth,
        visible: Boolean(node.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden' };
    }).filter((item) => item.name);
  // Include collapsed links already rendered in the DOM, not just visible
  // rows. Do not invent links for CMS categories absent from this navigation.
  return { names: entries.map((item) => item.name), entries };
}
function categoryControl(controls, name) {
  const candidates = categoriesOf(controls).filter((item) => item.label.includes(name));
  // A parent's label includes descendant names. Its own name starts the
  // label; exact matches take precedence. Never use the whole tree as a name
  // or pick the first ancestor whose label happens to contain the child.
  const exact = candidates.filter((item) => item.label === name);
  const own = exact.length ? exact : candidates.filter((item) => item.label.startsWith(`${name} `));
  if (own.length !== 1) unavailable(`分类“${name}”没有唯一对应的勾选框，需核实分类树结构。`);
  return own[0];
}
export function categorySelectionChanges(controls, targetName) {
  const boxes = categoriesOf(controls);
  const target = categoryControl(controls, targetName);
  return boxes.map((item) => ({ target: item, value: item.index === target.index }));
}

export function categoryPersistedControls(controls) {
  return (controls || []).filter((item) => (item.type === 'radio' && item.name === 'selectGroupWay')
    || (item.type === 'checkbox' && item.name === 'leafProdGroup'))
    .map((item) => ({ region: '设置产品分类', controlIndex: item.index, type: item.type }));
}

// Pure DOM helper: find the category nav link with the given text inside the
// target block instance root and click it. Scoped to the instance root so a
// same-named link in another block / nav can never be clicked by mistake.
// Requires exactly one match; zero or multiple matches are reported instead
// of guessing. Serializable: safe to pass directly to locator.evaluate().
export function findAndClickCategoryLink(wrap, target) {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const links = [...wrap.querySelectorAll('a')].filter((el) => norm(el.innerText) === target);
  if (links.length === 0) return { clicked: false, reason: 'not-found' };
  if (links.length > 1) return { clicked: false, reason: 'ambiguous', count: links.length };
  links[0].click();
  return { clicked: true };
}

export async function createFreshDefinitions(args) {
  const { page, canvas, config, capability, profile } = args;
  const session = args.scopedSession || widgetSession({ page, canvas, config,
    type: 'phoenix_blocks_gallery', title: capability?.dialogTitle || '设置产品分类',
    wrapIndex: capability?.wrapIndex ?? 0 });
  await session.open();
  const initial = Array.isArray(args.initialControls) ? args.initialControls : await session.read();
  const categories = categoriesOf(initial);
  const fixtureCategoryNames = profile?.fixture?.category?.name
    ? [String(profile.fixture.category.name).trim()]
    : categories.map((item) => item.label.trim()).filter((label) => /^AUTOTEST-/i.test(label));
  const staticResults = [result('pcs-state', 'record',
    `选择方式=${initial.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.checked)?.label || '未知'}；分类 ${categories.length} 个，已勾选 ${categories.filter((item) => item.checked).length} 个。`,
    { mode: initial.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.checked)?.label,
      categories: categories.map((item) => ({ label: item.label, checked: item.checked, disabled: item.disabled })) })];
  if (!fixtureCategoryNames.length) {
    try { await session.cancel(); } catch {}
    return { settings: [], staticResults,
      notAdaptedReason: 'Neither the profile nor the category inventory identifies an AUTOTEST fixture category for the existing whole-list selection assertion.' };
  }
  const modeOptions = initial.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay');
  const allMode = modeOptions.filter((item) => item.label === '选择所有产品分类');
  const partialMode = modeOptions.filter((item) => item.label === '选择部分产品分类');
  if (allMode.length !== 1 || partialMode.length !== 1 || categories.length === 0) {
    try { await session.cancel(); } catch {}
    return { settings: [], staticResults,
      notAdaptedReason: `The category surface is ambiguous (all mode ${allMode.length}, partial mode ${partialMode.length}, category controls ${categories.length}); no write definition was created.` };
  }
  const initialMode = modeOptions.find((item) => item.checked)?.label;
  const initialSelection = categories.filter((item) => item.checked).map((item) => item.label.trim());
  const expectedSelection = [...new Set(fixtureCategoryNames)];
  try {
    for (const name of expectedSelection) categoryControl(initial, name);
  } catch (error) {
    try { await session.cancel(); } catch {}
    return { settings: [], staticResults,
      notAdaptedReason: `The complete fixture category set is not uniquely identifiable before any write: ${error.message}` };
  }
  const lifecycle = createFreshLifecycle('settings-dialog', {
    open: () => session.open(), read: () => session.read(),
    apply: async ({ names }) => {
      let controls = await session.read();
      let selectedMode = controls.find((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.checked);
      if (!selectedMode) throw new Error('分类模式没有唯一选中项。');
      if (selectedMode.label !== '选择部分产品分类') {
        const partial = controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay'
          && item.label === '选择部分产品分类');
        if (partial.length !== 1) throw new Error(`部分分类模式候选 ${partial.length} 个，拒绝切换。`);
        await session.set(partial[0], true);
        controls = await session.read();
      }
      if (names.length !== fixtureCategoryNames.length || names.some((name) => !fixtureCategoryNames.includes(name))) {
        throw new Error('分类选择值与当前识别出的 fixture category 集合不一致。');
      }
      const boxes = categoriesOf(controls);
      for (const name of names) categoryControl(controls, name);
      await session.setMany(boxes.map((target) => ({ target, value: names.includes(target.label.trim()) })));
    },
    commit: () => session.save(), cancel: () => session.cancel(),
  });
  const setList = (names) => lifecycle.apply({ names });
  const setting = { id: 'pcs-category-persist', key: 'category-selection-set', name: NAMES['pcs-category-persist'],
    lifecycle, initialValue: { mode: initialMode, selected: initialSelection },
    originalValue: { mode: initialMode, selected: initialSelection },
    value: { mode: '选择部分产品分类', selected: expectedSelection },
    expected: { mode: '选择部分产品分类', selected: expectedSelection },
    apply: () => setList(expectedSelection),
    restore: async () => {
      await setList(initialSelection);
      if (initialMode === '选择所有产品分类') {
        const controls = await session.read();
        const all = controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.label === initialMode);
        if (all.length !== 1) throw new Error('恢复所有分类模式时控件不唯一。');
        await session.set(all[0], true);
      }
    },
    check: async () => {
      await lifecycle.open();
      try {
        const controls = await lifecycle.read();
        const mode = controls.filter((item) => item.type === 'radio' && item.name === 'selectGroupWay' && item.checked);
        const selected = categoriesOf(controls).filter((item) => item.checked).map((item) => item.label.trim()).sort();
        const expected = [...expectedSelection].sort();
        const pass = mode.length === 1 && mode[0].label === '选择部分产品分类' && sameSet(selected, expected);
        return { status: pass ? 'pass' : 'fail', expected: { mode: '选择部分产品分类', selected: expected },
          actual: { mode: mode[0]?.label || null, selected },
          detail: `分类持久化断言：部分模式下所选完整集合应为 ${sentenceList(expected)}；实际模式=${mode[0]?.label || '未知'}，集合=${sentenceList(selected)}。` };
      } finally { await lifecycle.cancel(); }
    } };
  try { await session.cancel(); } catch {}
  return { settings: [setting], persistedControls: categoryPersistedControls(initial), staticResults };
}
export function selectedCheckGroupLayer(group) { return checkGroups[group] || null; }
async function categoryEffects(args, layer, onlyKinds = null) {
  const checks = [];
  for (const kind of ['mode', 'categories'].filter((item) => !onlyKinds || onlyKinds.includes(item))) {
    const session = widgetSession({ ...args, type: 'phoenix_blocks_gallery',
      title: args.capability?.dialogTitle || '设置产品分类', wrapIndex: args.capability?.wrapIndex ?? 0 });
    checks.push(await effectCheck({ ...args, mutation: mutationContext(args.canvas, args.config, args.profile), session, result, id: `pcs-${kind}-${layer}`, layer, run: async (tx) => {
      const controls = await tx.controls();
      const all = uniqueControl(controls, (item) => item.type === 'radio' && item.name === 'selectGroupWay'
        && item.label === '选择所有产品分类', '本区块没有分类选择方式设置项。');
      const partial = uniqueControl(controls, (item) => item.type === 'radio' && item.name === all.name
        && item.label === '选择部分产品分类', '本区块没有部分分类设置项。');
      rememberCategoryState(tx, session, controls, 'selectGroupWay');
      const readNavigation = async () => {
        const snapshot = layer === 'backend' ? await readEffectRoot(args.canvas, args.config, categoryNavigation)
          : await tx.observe((frame) => readEffectRoot(frame, args.config, categoryNavigation));
        if (!snapshot?.names.length) unavailable('该层暂时没有可读取的分类导航，需实站核实。');
        return snapshot;
      };
      const target = args.profile?.fixture?.category?.name;
      const products = args.profile?.fixture?.products?.map(p => p.name);
      if (!target?.startsWith('AUTOTEST-') || !products?.length || args.report?.fixture?.applied === false) unavailable('缺少已准备的 AUTOTEST 分类与产品夹具。');
      await tx.set(all, true); await tx.save();
      const allNavigation = await readNavigation();
      tx.evidence.allNavigation = allNavigation;
      tx.assert(allNavigation.names.includes(target), `所有分类模式应包含夹具分类 ${target}。`);
      if (kind === 'mode') {
        const snapshot = layer === 'backend' ? await readEffectRoot(args.canvas, args.config, productSnapshot)
          : await tx.observe(frame => readEffectRoot(frame, args.config, productSnapshot));
        if (!snapshot?.hasList) unavailable('无法读取产品列表。');
        tx.expected('所有分类模式应显示 AUTOTEST 夹具产品。');
        tx.assert(snapshot.names.some(name => products.includes(name)), '所有分类模式未显示 AUTOTEST 夹具产品。');
      }
      await tx.set(partial, true); await tx.save();
      const current = await tx.controls();
      await tx.setMany(categorySelectionChanges(current, target), { restoreKey: 'category-state:selectGroupWay' });
      await tx.save();
      const nav = await readNavigation(); tx.evidence.navigation = nav;
      tx.expected(`选择夹具分类后导航应仅显示 ${target}。`);
      tx.assert(sameSet(nav.names, [target]), `选择夹具分类后导航为 ${sentenceList(nav.names)}。`);
    } }));
  }
  return checks;
}
export async function runBackendLayer(args) {
  const onlyKinds = args.config.checkGroup === 'pcs-categories-backend' ? ['categories'] : null;
  return categoryEffects(args, 'backend', onlyKinds);
}
