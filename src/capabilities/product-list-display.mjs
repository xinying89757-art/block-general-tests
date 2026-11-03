import { normalizeSiteHost } from '../site-baseline.mjs';
import { logMutation, markDone, markFailed } from '../mutation-journal.mjs';
import { effectCheck, unavailable, uniqueControl, readEffectRoot, sameSet, sentenceList, productSnapshot, rememberCategoryState } from './effect-checks.mjs';
import { categorySelectionChanges } from './product-category-select.mjs';
import { savePage, openPreview, targetLanguage } from '../editor.mjs';
import { selectFrontProvider, FrontProviderPublishedError } from '../front-provider.mjs';
import { journalSnapshot, blockSelector, widgetSession, probeControls, persistControl, radioPersist, radioGroupPersist, previewSelector, TIMEOUT, checkReportText, fixtureCategoryState, findControl, controlValue } from './shared.mjs';
import { executeSettingBatches } from '../batch-save.mjs';
import { createFreshLifecycle } from '../fresh-settings-adapter.mjs';
import { registerFreshSettingsCapability } from '../setting-units.mjs';
import { retryDisplayFieldSnapshot } from '../display-field-front-check.mjs';
import { listSession } from './product-list-effects.mjs';

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
    target: () => mutationTarget(canvas, config, profile), settingKey: 'product-list-display' } : undefined;
}

const SUITE = 'capability:product-list-display';
const NAMES = {
  'pld-fields': '产品列表展示字段与勾选状态',
  'pld-page-size-persist': '每页产品数量保存回读与恢复',
  'pld-pagination-persist': '分页展示保存回读与恢复',
  'pld-compare-persist': '产品对比保存回读与恢复',
  'pld-compare-front': '产品对比前台效果',
  'pld-data-source-category-front': '列表数据来源选部分分类前台效果',
  'pld-display-field-persist': '展示字段保存回读与恢复',
  'pld-data-source-persist': '列表数据来源保存回读与恢复',
  'pld-data-source-batch-effect': '批量保存后数据来源画布效果',
  'pld-size-batch-effect': '批量保存后产品数量画布效果',
  'pld-pagination-batch-effect': '批量保存后分页画布效果',
  'pld-compare-batch-effect': '批量保存后产品对比画布效果',
  'pld-display-field-batch-effect': '批量保存后展示字段画布效果',
  'pld-front-note': '产品列表前台可观察性记录',
};
const backendCheckIds = Object.freeze([
  'pld-fields-backend', 'pld-source-all-backend', 'pld-source-filter-backend',
  'pld-source-products-backend', 'pld-source-category-backend', 'pld-size-backend',
  'pld-pagination-backend', 'pld-compare-backend',
]);
export const checkGroups = Object.freeze(Object.fromEntries(backendCheckIds.map((id) => [id, ['backend']])));
export const batchSaveMetadata = Object.freeze({
  'data-source': Object.freeze({ interferesWith: ['product-quantity', 'pagination'] }),
  'product-quantity': Object.freeze({ interferesWith: ['pagination', 'data-source'] }),
  pagination: Object.freeze({ interferesWith: ['product-quantity', 'data-source'],
    requiresBaseline: ['product-quantity', 'data-source'] }),
  comparison: Object.freeze({}),
  'display-field': Object.freeze({}),
});
export const freshSettings = registerFreshSettingsCapability('product-list-display', createProductListBatchDefinitions,
  { metadata: batchSaveMetadata, settingKeys: Object.freeze(Object.keys(batchSaveMetadata)) });

export async function runListEffectPlan(tasks, { checkGroup } = {}) {
  const selected = checkGroup ? tasks.filter((task) => task.id === checkGroup) : tasks;
  const checks = [];
  for (let index = 0; index < selected.length; index += 1) {
    const task = selected[index];
    const check = await task.run();
    checks.push(check);
    if (!['env-paused', 'env-timeout'].includes(check.status)) continue;
    for (const blocked of selected.slice(index + 1)) {
      checks.push(result(blocked.id, check.status,
        `因检查 ${check.id} 遇到 ${check.status}，此检查未执行。`,
        { blockedByEnvironmentCheck: check.id, notExecuted: true }));
    }
    break;
  }
  return checks;
}

function result(id, status, detail, evidence, textFields = {}) {
  const machineReason = evidence?.reason?.code ?? evidence?.reason;
  const reason = typeof machineReason === 'string' && /^[a-z0-9-]+$/i.test(machineReason)
    ? { stage: 'capability-effect', code: machineReason } : undefined;
  return { id, name: NAMES[id], suite: SUITE, status, detail, ...checkReportText(NAMES[id], status, detail, evidence, id),
    ...(reason ? { reason } : {}), ...textFields,
    ...(evidence === undefined ? {} : { evidence }) };
}
const outcomeResult = (id, outcome) => result(id, outcome.status, outcome.detail, outcome.evidence);
const fieldsOf = (controls) => controls.filter((item) => item.type === 'checkbox'
  && item.value && item.value !== 'on' && item.label !== '全选');

export function assessAllProducts({ fixtureNames, actualNames, pagination, quantity }) {
  const counts = Object.fromEntries(fixtureNames.map((name) => [name,
    actualNames.filter((actual) => actual === name).length]));
  const limit = Number(quantity);
  return {
    fixtureCounts: counts,
    allFixturesPresent: fixtureNames.length > 0 && fixtureNames.every((name) => counts[name] > 0),
    countWithinQuantity: Number.isFinite(limit) && actualNames.length <= limit,
    actualCount: actualNames.length,
    quantity: limit,
    quantityMeaning: pagination ? '每页产品数量' : '显示产品总数量',
  };
}

// Open a throwaway preview tab, run fn on its content frame, then close
// the tab. Same pattern as block-color-scheme / module-width.
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

async function contentFrame(previewPage) {
  const found = previewPage.frames().find((f) => {
    try { return new URL(f.url()).hostname.endsWith('.preview.leadong.com'); } catch { return false; }
  });
  return found || previewPage.mainFrame();
}

// Product-compare front effect (样本区块 only; 另一样本区块 has no compare setting
// and skips). Ground truth from probes 2026-10-26:
// each product card carries `input.compared-input[type=checkbox]` +
// bare text "Add to Compare" (two copies per card, grid + list markup;
// only the grid copy is visible). Checking boxes shows a fixed
// `.compareMenu` bar (counter `.compareNum`, "Compare(n/6)", product
// thumbnails + remove, "Empty"). The "Compare" control is a DIV
// (`.compareButton`), not a button; clicking it expands
// `.compareMenu_large`, whose `<table>` stays empty in preview — the
// attribute comparison happens on the inquiry form instead. Its submit
// is `.opt-btn .save` ("Inquire"), posting #comparedForm to
// /phoenix/admin/prod/inquire. The checked display fields show on the
// product cards (e.g. Brand) and as columns on the inquiry form.
async function compareFrontCheck({ session, page, canvas, context, config, profile, report }) {
  const id = 'pld-compare-front';
  const skip = (detail) => result(id, 'skip', detail);
  const fixtureNames = profile?.fixture?.products?.map(p => p.name) || [];
  if (fixtureNames.length < 2 || report?.fixture?.applied === false) return skip('缺少已准备的至少两个 AUTOTEST 产品。');
  const probe = await probeControls(session);
  if (probe.reason) return skip(`无法读取产品列表弹窗：${probe.reason}`);
  const pair = ['关闭', '开启'].map((label) => probe.controls
    .find((item) => item.type === 'radio' && item.label === label));
  if (pair.some((item) => !item)) return result(id, 'na', '本区块没有产品对比设置项。');
  const brand = probe.controls.find((item) => item.type === 'checkbox' && item.label === 'Brand');
  const originalCompare = pair.find((item) => item.checked)?.label || '关闭';
  const originalBrand = brand?.checked ?? null;
  const errors = [];
  const evidence = { originalCompare, originalBrand };
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
          after: probe.controls, restore: { kind: 'set-setting', settingKey: 'product-list-display', value: probe.controls } }));
      }
      const current = await probeControls(session);
      const off = current.controls?.find((item) => item.type === 'radio' && item.label === originalCompare);
      if (off) await session.set(off, true);
      if (brand && originalBrand !== null) {
        const now = current.controls?.find((item) => item.type === 'checkbox' && item.label === 'Brand');
        if (now && now.checked !== originalBrand) await session.set(now, originalBrand);
      }
      await session.save();
      await session.open();
      const after = await probeControls(session, (items) =>
        items.find((item) => item.type === 'radio' && (item.label === '关闭' || item.label === '开启') && item.checked)?.label === originalCompare
        && (originalBrand === null || (items.find((item) => item.type === 'checkbox' && item.label === 'Brand')?.checked ?? null) === originalBrand));
      // The dialog holds several radio groups (pagination 是/否, data
      // source, compare 关闭/开启): the restored compare value must be
      // read from the compare pair, not from the first checked radio
      // (2026-10-26: the first checked radio was pagination "是", which
      // made a successful restore look like a failure).
      const restoredCompare = after.controls?.find((item) => item.type === 'radio'
        && (item.label === '关闭' || item.label === '开启') && item.checked)?.label;
      const restoredBrand = after.controls?.find((item) => item.type === 'checkbox' && item.label === 'Brand')?.checked ?? null;
      evidence.restoredCompare = restoredCompare;
      evidence.restoredBrand = restoredBrand;
      if (restoredCompare !== originalCompare) errors.push(`恢复后产品对比为 ${restoredCompare}，不是 ${originalCompare}`);
      if (originalBrand !== null && restoredBrand !== originalBrand) errors.push(`恢复后 Brand 勾选为 ${restoredBrand}，不是 ${originalBrand}`);
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
  };
  try {
    if (!context) return skip('未提供浏览器 context，无法打开临时预览。');
    // session.open() is idempotent (only clicks when the dialog is not
    // visible), so open once up front: the dialog is closed here because
    // the preceding persist transactions end with cancel.
    await session.open();
    if (journal) {
      target = await mutationTarget(canvas, config, profile);
      mutationSeq = await logMutation(journal, journalSnapshot({ op: 'set-setting', target, before: probe.controls,
        after: probe.controls.map((item) => item.type === 'radio' && ['关闭', '开启'].includes(item.label)
          ? { ...item, checked: item.label === '开启' } : item.type === 'checkbox' && item.label === 'Brand' ? { ...item, checked: true } : item),
        restore: { kind: 'set-setting', settingKey: 'product-list-display', value: probe.controls } }));
    }
    if (originalCompare === '关闭') await session.set(pair[1], true);
    if (brand && !brand.checked) await session.set(brand, true);
    await session.save();
    evidence.flipped = { compare: '开启', brand: true };
    const flow = await withPreview(page, context, async (frame, previewPage) => {
      const flowErrors = [];
      const flowEvidence = {};
      const root = frame.locator(previewSelector(config.blockId)).first();
      await root.waitFor({ state: 'attached', timeout: TIMEOUT });
      await frame.waitForTimeout(3000);
      const boxes = root.locator('input.compared-input:visible');
      const fixtureBoxes = [];
      for (let i = 0; i < await boxes.count(); i++) {
        const name = await boxes.nth(i).evaluate(box => (box.closest('.one-pruduct-item')?.querySelector('.prodlist-pro-name')?.innerText || '').trim());
        if (fixtureNames.includes(name) && !fixtureBoxes.some(item => item.name === name)) fixtureBoxes.push({ index: i, name });
      }
      flowEvidence.compareBoxCount = fixtureBoxes.length;
      if (fixtureBoxes.length < 2) {
        flowErrors.push(`预览里只有 ${fixtureBoxes.length} 个可见的 AUTOTEST 对比产品，不到 2 个`);
        return { flowErrors, flowEvidence };
      }
      for (const item of fixtureBoxes.slice(0, 2)) await boxes.nth(item.index).check({ timeout: TIMEOUT });
      await frame.waitForTimeout(1500);
      flowEvidence.checkedCount = await root.locator('input.compared-input:visible:checked').count();
      const names = await root.evaluate((wrap) => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        return [...wrap.querySelectorAll('input.compared-input:checked')].slice(0, 2).map((box) => {
          const card = box.closest('.one-pruduct-item');
          return norm(card?.querySelector('.prodlist-pro-name')?.innerText);
        });
      });
      flowEvidence.products = names;
      const bar = frame.locator('.compareMenu').first();
      const barShown = await bar.evaluate((el) => el.classList.contains('show') && el.offsetWidth > 0).catch(() => false);
      const counter = await frame.locator('.compareMenu .compareNum').first().innerText().catch(() => null);
      const barText = await frame.locator('.compareMenu .compareList').first().innerText().catch(() => '');
      flowEvidence.bar = { shown: barShown, counter, hasNames: names.map((n) => barText.includes(n)) };
      if (!barShown) flowErrors.push('勾选 2 个产品后底部对比栏未出现（.compareMenu 没有 show）');
      if (counter !== '2') flowErrors.push(`对比计数为 ${counter}，不是 2`);
      names.forEach((n, i) => { if (!barText.includes(n)) flowErrors.push(`底部栏里没有第 ${i + 1} 个产品 ${n}`); });
      // Expand the comparison panel.
      await frame.locator('.compareMenu .compareButton').first().click({ timeout: TIMEOUT });
      await frame.waitForTimeout(2000);
      const large = await frame.evaluate(() => {
        const el = document.querySelector('.compareMenu_large');
        const table = document.querySelector('.compareMenu .table-wrap table');
        return { visible: !!el && el.offsetWidth > 0,
          text: el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : null,
          tableRows: table ? table.rows.length : null };
      });
      flowEvidence.large = large;
      if (!large.visible) flowErrors.push('点 Compare 后对比大面板未展开');
      names.forEach((n) => { if (!large.text?.includes(n)) flowErrors.push(`对比大面板里没有产品 ${n}`); });
      // Submit via Inquire to the inquiry form.
      await frame.locator('.compareMenu_large .opt-btn .save').first().click({ timeout: TIMEOUT });
      let landed = null;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const current = await contentFrame(previewPage);
        if (current.url().includes('/phoenix/admin/prod/inquire')) { landed = current; break; }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!landed) {
        flowErrors.push('点 Inquire 后 15 秒内未进入询盘表单页（/phoenix/admin/prod/inquire）');
      } else {
        // The navigated document briefly has no body; poll the read
        // until the body exists and has text (2026-10-26: a single
        // evaluate right after landing threw "document.body is null").
        let inquire = null;
        const readDeadline = Date.now() + 10000;
        while (Date.now() < readDeadline) {
          try {
            const read = await landed.evaluate(() => ({
              url: location.href, title: document.title,
              text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
            }));
            if (read.text.length > 0) { inquire = read; break; }
          } catch { /* document still loading; retry */ }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (!inquire) {
          flowErrors.push('询盘页已跳转但 10 秒内读不到页面内容');
        } else {
          flowEvidence.inquire = inquire;
          names.forEach((n) => { if (!inquire.text.includes(n)) flowErrors.push(`询盘页里没有产品 ${n}`); });
        }
      }
      return { flowErrors, flowEvidence };
    });
    errors.push(...flow.flowErrors);
    Object.assign(evidence, flow.flowEvidence);
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
      : `对比开启后勾选 2 个产品（${(evidence.products || []).join('、')}），底部栏计数 2/6、含两个产品名；点 Compare 展开大面板；点 Inquire 进入询盘表单页，并核对两件已选产品都被带入。询盘页标题和 Brand 列不由产品对比设置控制，不作为本项预期。`,
    evidence);
}

// List data-source category front effect (另一样本区块 only; 样本区块 has no data
// source group and skips — the check needs capability.oracle from the
// profile). This is the LIST's own category selection, separate from the
// category NAV setting (product-category-select): data source
// (selectProdType) = 选择部分产品分类 reveals a category multi-select in
// THIS dialog, and the list's data scope follows it directly — no nav
// click needed. Ground truth from probes 2026-10-26: with source =
// partial + only 测试分类, the preview list is exactly the 7 on-shelf
// oracle products (CMS 测试分类共 11 条，下架 4 个不展示）, while the
// category nav still shows all 44 categories (the nav setting is
// untouched).
async function dataSourceCategoryFrontCheck({ session, page, canvas, context, config, capability, profile, report }) {
  const id = 'pld-data-source-category-front';
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
  const sourceOf = (probe) => (probe.controls || []).filter((item) => item.type === 'radio' && item.name === 'selectProdType');
  const catsOf = (probe) => (probe.controls || []).filter((item) => item.type === 'checkbox' && item.name === 'leafProdGroup');
  const probe = await probeControls(session);
  if (probe.reason) return result(id, 'skip', `无法读取产品列表弹窗：${probe.reason}`);
  const sources = sourceOf(probe);
  const originalSource = sources.find((item) => item.checked)?.label || '所有产品';
  const originalChecked = catsOf(probe).filter((item) => item.checked).map((item) => (item.label || '').trim());
  evidence.baseline = { dataSource: originalSource, checkedCategories: originalChecked };
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
          after: probe.controls, restore: { kind: 'set-setting', settingKey: 'product-list-display', value: probe.controls } }));
      }
      if (originalSource === '选择部分产品分类') {
        const current = await probeControls(session);
        const partial = current.controls?.find((item) => item.type === 'radio' && item.name === 'selectProdType' && item.label === '选择部分产品分类');
        if (partial && !partial.checked) {
          await session.set(partial, true);
          await session.save();
          await session.open();
        }
        const now = await probeControls(session);
        for (const item of catsOf(now)) {
          const want = originalChecked.includes((item.label || '').trim());
          if (item.checked !== want) await session.set(item, want);
        }
        await session.save();
        await session.open();
      }
      const back = await probeControls(session);
      const orig = back.controls?.find((item) => item.type === 'radio' && item.name === 'selectProdType' && item.label === originalSource);
      if (orig) {
        await session.set(orig, true);
        await session.save();
      }
      await session.open();
      const after = await probeControls(session, (items) => sourceOf({ controls: items }).find((item) => item.checked)?.label === originalSource);
      const restoredSource = sourceOf(after).find((item) => item.checked)?.label;
      evidence.restored = { dataSource: restoredSource };
      if (restoredSource !== originalSource) errors.push(`恢复后数据来源为 ${restoredSource}，不是 ${originalSource}`);
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
    // Let the canvas settle after the flip + restore saves (same lesson
    // as pcs-category-front: a still-reloading canvas can make the next
    // capability's dialog open time out).
    try {
      await canvas.locator(`.siteblocks-setting-wrap[data-appid="${config.blockId}"]`).first()
        .waitFor({ state: 'attached', timeout: 30000 });
    } catch {}
  };
  try {
    if (!context) return result(id, 'skip', '未提供浏览器 context，无法打开临时预览。');
    const partial = sources.find((item) => item.label === '选择部分产品分类');
    if (!partial) return result(id, 'na', '本区块没有“选择部分产品分类”数据来源设置项。');
    if (journal) {
      target = await mutationTarget(canvas, config, profile);
      mutationSeq = await logMutation(journal, journalSnapshot({ op: 'set-setting', target, before: probe.controls,
        after: probe.controls.map((item) => item.type === 'radio' && item.name === 'selectProdType'
          ? { ...item, checked: item.label === '选择部分产品分类' } : item.type === 'checkbox' && item.name === 'leafProdGroup'
            ? { ...item, checked: (item.label || '').trim() === categoryName } : item),
        restore: { kind: 'set-setting', settingKey: 'product-list-display', value: probe.controls } }));
    }
    await session.set(partial, true);
    await session.save();
    await session.open();
    const after = await probeControls(session);
    if (after.reason) {
      // Do NOT return early: the source was already flipped and saved,
      // so fall through to the finally restore.
      errors.push(`切到部分分类后无法读取弹窗：${after.reason}`);
    } else {
      const boxes = catsOf(after);
      if (!boxes.length) { errors.push('切到部分分类后弹窗里没有出现分类多选。'); }
      else {
        for (const item of boxes.filter((x) => x.checked && (x.label || '').trim() !== categoryName)) {
          await session.set(item, false);
        }
        const targetNow = boxes.find((item) => (item.label || '').trim() === categoryName);
        if (!targetNow) { errors.push(`切到部分分类后找不到分类“${categoryName}”`); }
        else if (!targetNow.checked) await session.set(targetNow, true);
      }
      await session.save();
      await savePage(page);
      await session.open();
      const verify = await probeControls(session, (items) => {
        const checked = catsOf({ controls: items }).filter((item) => item.checked).map((item) => (item.label || '').trim());
        return sourceOf({ controls: items }).find((item) => item.checked)?.label === '选择部分产品分类'
          && checked.length === 1 && checked[0] === categoryName;
      });
      const persistedSource = sourceOf(verify).find((item) => item.checked)?.label;
      const persistedChecked = catsOf(verify).filter((item) => item.checked).map((item) => (item.label || '').trim());
      evidence.persisted = { dataSource: persistedSource, checkedCategories: persistedChecked };
      if (persistedSource !== '选择部分产品分类' || persistedChecked.length !== 1 || persistedChecked[0] !== categoryName) {
        errors.push(`翻转后未保持单分类：数据来源=${persistedSource}，勾选分类=[${persistedChecked.join('、')}]`);
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
        // The list shows the category's products directly, no nav click.
        // Poll until the product set stabilises (≤10s).
        const readNames = () => root.evaluate((wrap) => {
          const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
          return [...wrap.querySelectorAll('.prodlist-pro-name')].map((el) => norm(el.innerText));
        });
        let names = [];
        let prev = null;
        for (let i = 0; i < 10; i++) {
          await frame.waitForTimeout(1000);
          names = await readNames();
          if (prev !== null && prev.join('|') === names.join('|')) break;
          prev = names;
        }
        flowEvidence.list = { count: names.length, names };
        const missing = expected.filter((n) => !names.includes(n));
        const extra = names.filter((n) => n.startsWith('AUTOTEST-') && !expected.includes(n));
        if (missing.length) flowErrors.push(`列表缺 ${missing.length} 个后台产品：“${missing.join('”、“')}”`);
        if (extra.length) flowErrors.push(`列表多 ${extra.length} 个非该分类产品：“${extra.join('”、“')}”`);
        // Independence evidence (record only): the category nav is a
        // different setting and should still show all categories here.
        const navCount = await root.evaluate((wrap) => {
          const cate = wrap.querySelector('.pf-cate-wrap');
          return cate ? [...cate.querySelectorAll('a')].length : null;
        });
        flowEvidence.navCategoryCount = navCount;
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
      : `数据来源选部分分类（仅“${categoryName}”）后，列表直接为后台的 ${expected.length} 个上架产品，与后台一致${offShelfCount == null ? '' : `，下架 ${offShelfCount} 个不展示`}，无需点导航。`,
    evidence, { expected: `数据来源只选“${categoryName}”后，产品列表应与后台的 ${expected.length} 个上架产品完全一致${offShelfCount == null ? '' : `，并排除 ${offShelfCount} 个下架产品`}。` });
}

export async function runSettingsLayer({ page, canvas, context, config, capability, profile, report }) {
  const mutation = mutationContext(canvas, config, profile);
  if (config.frontOnly) return runJournaledProductListEffects({ page, canvas, context, config, capability, profile, report }, 'front');
  // The dialog title and the wrap index come from the profile: 样本区块 uses
  // title 设置产品列表 at gallery wrap 0, while 另一样本区块 uses 设置与选取数据
  // at gallery wrap 1 (wrap 0 is the category dialog). Title alone is not
  // enough when two gallery sub-regions share one editor type.
  const session = widgetSession({ page, canvas, config,
    type: 'phoenix_blocks_gallery', title: capability?.dialogTitle || '设置产品列表',
    wrapIndex: capability?.wrapIndex ?? 0 });
  const initial = await probeControls(session);
  const checks = [];
  try {
    if (initial.reason) return ['pld-fields', 'pld-page-size-persist', 'pld-pagination-persist', 'pld-compare-persist', 'pld-compare-front', 'pld-data-source-category-front', 'pld-display-field-persist', 'pld-data-source-persist']
      .map((id) => result(id, 'skip', `无法读取产品列表弹窗：${initial.reason}`));
    const fields = fieldsOf(initial.controls);
    checks.push(Array.isArray(profile?.requirements?.displayFieldTypes) && profile.requirements.displayFieldTypes.length
      ? result('pld-fields', 'record', `展示字段 ${fields.length} 个（排除全选，含系统属性与自定义字段）；需求类型：${profile.requirements.displayFieldTypes.join('、')}。`, fields)
      : result('pld-fields', 'skip', '需求未提供，需人工补充', fields));
    // Data source is a 4-option radio in 另一样本区块 (所有产品 / 使用筛选条件 /
    // 选择指定产品 / 选择部分产品分类); 样本区块 has no such group, so a
    // missing group correctly degrades to na via radioGroupPersist.
    checks.push(outcomeResult('pld-data-source-persist', await radioGroupPersist({ mutation, session, page,
      name: '列表数据来源', labels: ['所有产品', '使用筛选条件', '选择指定产品', '选择部分产品分类'] })));
    checks.push(config.deferFront ? result('pld-data-source-category-front', 'deferred', 'deferred-to-front-runner', { deferred: true })
      : await dataSourceCategoryFrontCheck({ session, page, canvas, context, config, capability, profile, report }));
    // Inventory probe: page size is type=text, not necessarily type=number.
    // 另一样本区块 labels the same input 显示产品总数量, so accept either label;
    // the matched label is kept in evidence until its meaning is confirmed.
    const numbers = initial.controls.filter((item) => !item.disabled && !item.readOnly && ['text', 'number'].includes(item.type)
      && /^\d+$/.test(item.value) && Number(item.value) >= 1 && Number(item.value) <= 100);
    const sizeInputs = numbers.filter((item) => /每页产品数量|显示产品总数量/.test(item.label + item.context));
    const pageSize = sizeInputs.length === 1 ? sizeInputs[0] : (numbers.length === 1 ? numbers[0] : null);
    // The number's meaning depends on pagination (user-confirmed 2026-10-26):
    // pagination=是 → per-page count; pagination=否 → total count.
    const paginationChecked = initial.controls.find((item) => item.type === 'radio' && item.name === 'pagination' && item.checked);
    const sizeMeaning = paginationChecked?.label === '是' ? '每页产品数量' : paginationChecked?.label === '否' ? '总数量' : '未知含义';
    const sizeOutcome = pageSize ? await persistControl({ mutation, session, page,
      target: pageSize, alternate: Number(pageSize.value) === 10 ? '20' : '10' }) : null;
    checks.push(sizeOutcome
      ? outcomeResult('pld-page-size-persist', { ...sizeOutcome,
        detail: `${sizeOutcome.detail}；当前分页=${paginationChecked?.label || '未知'}，该输入为${sizeMeaning}。` })
      : result('pld-page-size-persist', numbers.length === 0 ? 'na' : 'skip', numbers.length === 0
        ? '本区块没有产品数量设置项。' : '未能唯一定位每页产品数量输入（盘点值 20，上限 100）。'));
    for (const [id, name, prefixes] of [
      ['pld-pagination-persist', '分页展示', ['是', '否']],
      ['pld-compare-persist', '产品对比', ['关闭', '开启']],
    ]) {
      checks.push(outcomeResult(id, await radioPersist({ mutation, session, page, name, prefixes })));
    }
    checks.push(config.deferFront ? result('pld-compare-front', 'deferred', 'deferred-to-front-runner', { deferred: true })
      : await compareFrontCheck({ session, page, canvas, context, config, profile, report }));
    const probe = await probeControls(session);
    const field = probe.controls && fieldsOf(probe.controls).find((item) => !item.disabled);
    checks.push(field ? outcomeResult('pld-display-field-persist', await persistControl({ mutation, session, page,
      target: field, alternate: !field.checked }))
      : result('pld-display-field-persist', probe.reason ? 'skip' : fieldsOf(probe.controls || []).length === 0 ? 'na' : 'skip',
        probe.reason || (fieldsOf(probe.controls || []).length === 0 ? '本区块没有展示字段设置项。' : '没有可切换的展示字段。')));
  } finally {
    try { await session.cancel(); } catch (error) {
      const last = checks.at(-1);
      if (last) { last.status = 'fail'; last.detail += `；最终取消失败：${error.message}`; }
    }
  }
  checks.push(...await runJournaledProductListEffects({ page, canvas, context, config, capability, profile, report }, 'front'));
  return checks;
}

function radioBatchSetting({ id, key, name, options }) {
  const original = options.find((item) => item.checked);
  const alternate = options.find((item) => !item.checked);
  const setting = { id, key, name, control: original, originalValue: original.label, alternateValue: alternate.label };
  const choose = async (session, target) => {
    await session.open();
    const controls = await session.read();
    const current = findControl(controls, target);
    if (!current) throw new Error(`${name}控件身份在保存期间变化`);
    await session.set(current, true);
  };
  setting.apply = (session) => choose(session, alternate);
  setting.restore = (session) => choose(session, original);
  setting.inspect = (controls) => {
    const states = options.map((item) => findControl(controls, item));
    if (states.some((item) => !item)) return { value: null, valid: false };
    const selected = states.filter((item) => item.checked);
    return { value: selected.length === 1 ? selected[0].label : null,
      valid: selected.length === 1 && selected[0].label === alternate.label };
  };
  return setting;
}

function controlBatchSetting({ id, key, name, control, alternate }) {
  const original = controlValue(control);
  const setting = { id, key, name, control, originalValue: original, alternateValue: alternate };
  const set = async (session, value) => {
    await session.open();
    const controls = await session.read();
    const current = findControl(controls, control);
    if (!current) throw new Error(`${name}控件身份在保存期间变化`);
    if (controlValue(current) !== value) await session.set(current, value);
  };
  setting.apply = (session) => set(session, alternate);
  setting.restore = (session) => set(session, original);
  setting.inspect = (controls) => {
    const current = findControl(controls, control);
    const value = current ? controlValue(current) : null;
    return { value, valid: current !== undefined && value === alternate };
  };
  return setting;
}

export function bindFreshBatchSettingSession(setting, session) {
  const apply = setting.apply;
  const restore = setting.restore;
  return { ...setting, apply: () => apply(session), restore: () => restore(session) };
}

function attachBatchEffect(setting, { canvas, config, profile, report }) {
  setting.captureEffect = async () => {
    try { setting.effectBefore = await readEffectRoot(canvas, config, productSnapshot); }
    catch (error) { setting.effectBeforeError = error.message; }
  };
  setting.checkEffect = async () => {
    if (setting.key === 'product-quantity') {
      const before = setting.effectBefore;
      if (!before?.count) return { status: 'skip', detail: setting.effectBeforeError || '当前画布无可读产品列表，无法核对数量效果。' };
      const next = Number(setting.alternateValue);
      const original = Number(setting.originalValue);
      const available = before.count >= next ? before.count : before.count < original ? before.count : null;
      if (available === null) return { status: 'skip', detail: '现有列表达到原数量上限，但没有完整可用产品数，暂不能判断数量设置效果。', evidence: before };
      const expected = Math.min(next, available);
      const after = await readEffectRoot(canvas, config, productSnapshot);
      const evidence = { before, after, quantity: next, available, expected };
      return { status: after.count === expected ? 'pass' : 'fail', detail: `产品数量设为 ${next} 后应显示 ${expected} 件，实际 ${after.count} 件。`, evidence };
    }
    if (setting.key === 'pagination') {
      if (!setting.effectBefore?.count || setting.effectBefore.count < 2) return { status: 'skip', detail: '翻转前可见产品不足两件，无法判断分页条效果。', evidence: setting.effectBefore || null };
      const after = await readEffectRoot(canvas, config, listVisibility);
      if (!after.hasList) return { status: 'skip', detail: '当前画布没有可读产品列表。', evidence: after };
      const expected = setting.alternateValue === '是';
      return { status: after.pagination === expected ? 'pass' : 'fail',
        detail: `分页设为“${setting.alternateValue}”后分页条应${expected ? '显示' : '隐藏'}，实际${after.pagination ? '显示' : '隐藏'}。`,
        evidence: { before: setting.effectBefore, after, expected } };
    }
    if (setting.key === 'comparison') {
      const after = await readEffectRoot(canvas, config, listVisibility);
      if (!after.hasList || !after.cards) return { status: 'skip', detail: '当前画布没有可读产品卡，无法判断对比入口效果。', evidence: after };
      const expected = setting.alternateValue === '开启';
      const mismatches = after.compareCards.filter((shown) => shown !== expected).length;
      return { status: mismatches ? 'fail' : 'pass', detail: `产品对比设为“${setting.alternateValue}”后应有 ${expected ? '全部' : '无'}产品卡显示入口，${mismatches} 张卡不符合。`,
        evidence: { after, expected, mismatches } };
    }
    if (setting.key === 'display-field') {
      const fieldLabel = setting.control.label;
      const snapshot = await retryDisplayFieldSnapshot(() => readEffectRoot(canvas,
        { ...config, effectReadTimeoutMs: config.displayFieldReadTimeoutMs || 1500 }, cardFieldSnapshot, [fieldLabel]),
      { attempts: 3, delayMs: 250 });
      const cards = snapshot.cards;
      if (snapshot.status !== 'ready' || cards.some((card) => !card.mapped || card.unmappedRows)) return {
        status: 'human-review', reason: { code: 'effect-unresolved-on-canvas' },
        detail: `展示字段“${fieldLabel}”已完成设置保存读回，但画布产品卡定位未能确认该字段效果；由前台卡片检查继续核对。`,
        evidence: { fieldLabel, expectedVisible: setting.alternateValue === true,
          checkId: 'pld-display-field-batch-effect', reason: 'effect-unresolved-on-canvas',
          attempts: snapshot.attempts, lastError: snapshot.lastError, cards } };
      const expected = setting.alternateValue === true;
      const mismatches = cards.filter((card) => card.labels.includes(fieldLabel) !== expected);
      return { status: mismatches.length ? 'fail' : 'pass', detail: `展示字段“${fieldLabel}”设为${expected ? '勾选' : '未勾选'}后，${mismatches.length} 张卡片与该状态不符。`,
        evidence: { cards, expected, mismatches: mismatches.map((card) => card.product) } };
    }
    if (setting.key === 'data-source') {
      const kind = { '所有产品': 'all', '使用筛选条件': 'filter', '选择指定产品': 'products', '选择部分产品分类': 'category' }[setting.alternateValue];
      const fixture = kind === 'all' || kind === 'category' ? profile?.fixture?.products?.map((item) => item.name)
        : kind === 'filter' ? profile?.fixture?.filteredProducts : profile?.fixture?.specifiedProducts;
      if (!Array.isArray(fixture) || !fixture.length || report?.fixture?.applied === false) return { status: 'skip',
        detail: `来源“${setting.alternateValue}”缺少完整且独立的 AUTOTEST 产品名单夹具。` };
      const after = await readEffectRoot(canvas, config, productSnapshot);
      const actualFixtures = after.names.filter((name) => name.startsWith('AUTOTEST-'));
      const missing = fixture.filter((name) => !actualFixtures.includes(name));
      const extra = actualFixtures.filter((name) => !fixture.includes(name));
      return { status: missing.length || extra.length ? 'fail' : 'pass',
        detail: `来源“${setting.alternateValue}”应显示 ${fixture.length} 件 AUTOTEST 产品；缺少 ${missing.length}、多出 ${extra.length}。`,
        evidence: { wanted: fixture, actual: actualFixtures, missing, extra } };
    }
    return { status: 'skip', detail: '该设置未声明可独立判定的画布效果。' };
  };
}

export async function createProductListBatchDefinitions(args) {
  const { page, canvas, context, config, capability, profile, report } = args;
  // Optional dependencies let the same definitions run against an offline
  // editor-session fixture. Production callers continue to use the real
  // capability-scoped dialog session and probe its live controls.
  const session = args.scopedSession || listSession({ page, canvas, config, capability });
  const initial = Array.isArray(args.initialControls)
    ? { controls: args.initialControls }
    : await probeControls(session);
  if (initial.reason) {
    await session.cancel().catch(() => {});
    return { settings: [], staticResults: [result('pld-settings', 'skip', `无法读取产品列表设置：${initial.reason}`)] };
  }

  const controls = initial.controls;
  const checksById = new Map();
  const candidates = [];
  const labelsForSource = ['所有产品', '使用筛选条件', '选择指定产品', '选择部分产品分类'];
  const sources = controls.filter((item) => item.type === 'radio' && labelsForSource.includes(item.label));
  if (!sources.length) checksById.set('pld-data-source-persist', result('pld-data-source-persist', 'na', '列表数据来源：该区块没有此选项组。'));
  else if (sources.length !== labelsForSource.length || new Set(sources.map((item) => item.name)).size !== 1
    || sources.filter((item) => item.checked).length !== 1 || sources.some((item) => item.disabled)) {
    checksById.set('pld-data-source-persist', result('pld-data-source-persist', 'skip', '列表数据来源：无法唯一定位该组选项或当前选中不唯一。', sources));
  } else candidates.push(radioBatchSetting({ id: 'pld-data-source-persist', key: 'data-source',
    name: '列表数据来源', options: sources }));

  const fields = fieldsOf(controls);
  checksById.set('pld-fields', Array.isArray(profile?.requirements?.displayFieldTypes) && profile.requirements.displayFieldTypes.length
    ? result('pld-fields', 'record', `展示字段 ${fields.length} 个（排除全选，含系统属性与自定义字段）；需求类型：${profile.requirements.displayFieldTypes.join('、')}。`, fields)
    : result('pld-fields', 'skip', '需求未提供，需人工补充', fields));

  const numbers = controls.filter((item) => !item.disabled && !item.readOnly && ['text', 'number'].includes(item.type)
    && /^\d+$/.test(item.value) && Number(item.value) >= 1 && Number(item.value) <= 100);
  const sizeInputs = numbers.filter((item) => /每页产品数量|显示产品总数量/.test(item.label + item.context));
  const pageSize = sizeInputs.length === 1 ? sizeInputs[0] : (numbers.length === 1 ? numbers[0] : null);
  if (pageSize) candidates.push(controlBatchSetting({ id: 'pld-page-size-persist', key: 'product-quantity',
    name: '产品数量', control: pageSize, alternate: Number(pageSize.value) === 10 ? '20' : '10' }));
  else checksById.set('pld-page-size-persist', result('pld-page-size-persist', numbers.length === 0 ? 'na' : 'skip',
    numbers.length === 0 ? '本区块没有产品数量设置项。' : '未能唯一定位每页产品数量输入（盘点值 20，上限 100）。'));

  for (const [id, key, name, label, groupName] of [
    ['pld-pagination-persist', 'pagination', '分页展示', null, 'pagination'],
    ['pld-compare-persist', 'comparison', '产品对比', null, null],
  ]) {
    const labels = id === 'pld-pagination-persist' ? ['是', '否'] : ['关闭', '开启'];
    const options = labels.map((labelText) => controls.filter((item) => item.type === 'radio'
      && item.label === labelText && (!groupName || item.name === groupName)));
    if (options.every((items) => items.length === 0)) {
      checksById.set(id, result(id, 'na', `${name}：该区块没有此选项组。`));
    } else if (options.some((items) => items.length !== 1) || options[0][0].index === options[1][0].index
      || options[0][0].name !== options[1][0].name || options.some((items) => items[0].disabled)
      || options.flat().filter((item) => item.checked).length !== 1) {
      checksById.set(id, result(id, 'skip', `${name}：无法唯一定位该组选项或当前选中不唯一。`, options.flat()));
    } else candidates.push(radioBatchSetting({ id, key, name, options: options.map((items) => items[0]) }));
  }

  const field = fields.find((item) => !item.disabled);
  if (field) candidates.push(controlBatchSetting({ id: 'pld-display-field-persist', key: 'display-field',
    name: '展示字段', control: field, alternate: !field.checked }));
  else checksById.set('pld-display-field-persist', result('pld-display-field-persist', fields.length === 0 ? 'na' : 'skip',
    fields.length === 0 ? '本区块没有展示字段设置项。' : '没有可切换的展示字段。'));

  candidates.forEach((setting) => attachBatchEffect(setting, { canvas, config, profile, report }));
  const checkBatch = async (setting, { phase }) => {
    const state = setting.inspect(await session.read());
    const effectCheck = await setting.checkEffect();
    const format = (value) => typeof value === 'boolean' ? (value ? '勾选' : '未勾选') : String(value ?? '缺失');
    const detail = `${setting.name}原值“${format(setting.originalValue)}”，批量保存后应为“${format(setting.alternateValue)}”；实际为“${format(state.value)}”。${effectCheck.detail}`;
    return { status: state.valid && effectCheck.status !== 'fail' ? 'pass' : 'fail', detail,
      expected: setting.alternateValue, actual: state.value,
      evidence: { control: setting.control.label || setting.control.context, original: setting.originalValue,
        alternate: setting.alternateValue, afterSave: state.value, phase, effectCheck } };
  };
  const saveBatch = async () => {
    await session.save();
    await session.open(); await session.read(); await session.cancel(); await session.open();
    await (args.savePageOperation || (() => savePage(page)))();
    await session.open();
  };
  const lifecycle = createFreshLifecycle('settings-dialog', {
    open: () => session.open(), read: () => session.read(), apply: async () => {},
    commit: () => session.save(), cancel: () => session.cancel(),
  });
  const freshCandidates = candidates.map((setting) => {
    const captureEffect = setting.captureEffect;
    const fresh = bindFreshBatchSettingSession(setting, session);
    const apply = fresh.apply;
    const restore = fresh.restore;
    fresh.lifecycle = lifecycle;
    fresh.apply = async () => { await lifecycle.apply(); await apply(); };
    fresh.restore = async () => { await lifecycle.apply(); await restore(); };
    fresh.captureEffect = () => captureEffect?.();
    fresh.check = async (ctx) => {
      await lifecycle.open();
      try { return await checkBatch(setting, { phase: ctx?.phase || 'fresh-batch' }); }
      finally { await lifecycle.cancel(); }
    };
    return fresh;
  });
  const region = capability?.dialogTitle || '设置产品列表';
  const persistedControls = candidates.map((setting) => ({ settingId: setting.id, region,
    controlIndex: setting.control?.index, type: setting.control?.type })).filter((item) => Number.isInteger(item.controlIndex) && item.type);
  // Definitions are captured during sequential adapter preparation. Leave the
  // modal closed so a later capability (for example, a canvas rail flyout)
  // does not inherit an open dialog/backdrop.
  await session.cancel();
  return { settings: freshCandidates, metadata: batchSaveMetadata, checkBatch, saveBatch, persistedControls,
    staticResults: [...checksById.values()] };
}

export async function runBatchSettingsLayer(args) {
  const { page, canvas, context, config, capability, profile, report } = args;
  const definitions = await createProductListBatchDefinitions(args);
  const session = listSession({ page, canvas, config, capability });
  const checksById = new Map(definitions.staticResults.map((check) => [check.id, check]));
  const candidates = definitions.settings;
  if (candidates.length === 0 && definitions.staticResults.some((item) => item.id === 'pld-settings')) {
    return runSettingsLayer(args);
  }

  if (candidates.length) {
    config.batchSaveUsed = true;
    const execution = await executeSettingBatches({ settings: candidates, metadata: batchSaveMetadata, adapter: {
      capture: async (settings) => new Map(settings.map((setting) => [setting.id, setting.originalValue])),
      apply: async (setting) => { await setting.captureEffect?.({ canvas, config, profile, report }); await setting.apply({ session }); },
      restore: async (setting) => setting.restore(session),
      save: definitions.saveBatch,
      check: definitions.checkBatch,
    } });
    for (const item of execution.results) {
      const details = [item.batchResult?.detail].filter(Boolean);
      if (item.rerunAloneResult) details.push(`单项复跑：${item.rerunAloneResult.status}；${item.rerunAloneResult.detail || item.rerunAloneResult.error || ''}`);
      if (item.status === 'pass') details.push('所有批量改动在收尾时统一恢复并保存。');
      checksById.set(item.id, result(item.id, item.status, details.join('；') || '批量保存检查结束。', {
        batchResult: item.batchResult, ...(item.rerunAloneResult ? { rerunAloneResult: item.rerunAloneResult } : {}),
      }));
      const effect = item.batchResult?.evidence?.effectCheck;
      if (effect) {
        const effectId = ({ 'pld-data-source-persist': 'pld-data-source-batch-effect',
          'pld-page-size-persist': 'pld-size-batch-effect', 'pld-pagination-persist': 'pld-pagination-batch-effect',
          'pld-compare-persist': 'pld-compare-batch-effect', 'pld-display-field-persist': 'pld-display-field-batch-effect' })[item.id];
        checksById.set(effectId, result(effectId, effect.status, effect.detail, effect.evidence));
      }
    }
    report.batchSave ||= { enabled: true, capabilities: [] };
    report.batchSave.capabilities.push({ id: 'product-list-display', batches: execution.batches,
      results: execution.results.map(({ id, status, batchResult, rerunAloneResult }) => ({ id, status, batchResult, rerunAloneResult })),
      timing: execution.timing });
  }

  checksById.set('pld-data-source-category-front', config.deferFront
    ? result('pld-data-source-category-front', 'deferred', 'deferred-to-front-runner', { deferred: true })
    : await dataSourceCategoryFrontCheck({ session, page, canvas, context, config, capability, profile, report }));
  checksById.set('pld-compare-front', config.deferFront
    ? result('pld-compare-front', 'deferred', 'deferred-to-front-runner', { deferred: true })
    : await compareFrontCheck({ session, page, canvas, context, config, capability, profile, report }));
  try { await session.cancel(); } catch (error) {
    const last = [...checksById.values()].at(-1);
    if (last) { last.status = 'fail'; last.detail += `；最终取消失败：${error.message}`; }
  }
  const order = ['pld-fields', 'pld-data-source-persist', 'pld-data-source-category-front', 'pld-page-size-persist',
    'pld-data-source-batch-effect', 'pld-pagination-persist', 'pld-pagination-batch-effect', 'pld-compare-persist',
    'pld-compare-batch-effect', 'pld-compare-front', 'pld-display-field-persist', 'pld-display-field-batch-effect', 'pld-size-batch-effect'];
  return [...order.map((id) => checksById.get(id)).filter(Boolean), ...await runJournaledProductListEffects({ page, canvas, context, config, capability, profile, report }, 'front')];
}

export async function runFrontEffectsLayer(args) {
  const session = listSession(args);
  return [await dataSourceCategoryFrontCheck({ ...args, session }), await compareFrontCheck({ ...args, session }),
    ...await runJournaledProductListEffects(args, 'front')];
}

export async function runFrontLayer({ frame, config }) {
  // searchnav-probe.json: generic [class*=prodlist] also matches an empty shell.
  // Count actual product items/names rather than treating the shell as a list.
  const selectors = ['.one-pruduct-item', '.prodlist-pro-name', '.product-item', '.prod-item',
    '[data-product-id]', '[data-productid]'];
  try {
    const root = frame.locator(previewSelector(config.blockId)).first();
    await root.waitFor({ state: 'attached', timeout: TIMEOUT });
    const counts = await root.evaluate((node, selectors) => Object.fromEntries(
      selectors.map((selector) => [selector, node.querySelectorAll(selector).length])), selectors);
    const hasProducts = Object.values(counts).some((count) => count > 0);
    return [result('pld-front-note', 'record', hasProducts
      ? '当前预览检测到产品列表候选元素，前台不可观察的前提已变化；本项仅验证设置保存后是否保持，未判断列表效果是否正确。'
      : '本区块预览内未发现产品列表元素，列表类设置的前台效果不可观察，仅做设置层保存回读验证。',
    { root: previewSelector(config.blockId), counts, hasProducts })];
  } catch (error) {
    return [result('pld-front-note', 'record', `列表可观察性探查不可用，不能确认列表缺失：${error.message}`,
      { observation: 'unavailable', selectors })];
  }
}

Object.assign(NAMES, {
  'pld-fields-backend': '画布产品卡展示字段完整集合',
  'pld-fields-front': '预览产品卡展示字段完整集合',
  'pld-source-all-backend': '所有产品来源在画布生效',
  'pld-source-all-front': '所有产品来源在预览生效',
  'pld-source-filter-backend': '筛选条件来源在画布生效',
  'pld-source-filter-front': '筛选条件来源在预览生效',
  'pld-source-products-backend': '指定产品来源在画布生效',
  'pld-source-products-front': '指定产品来源在预览生效',
  'pld-source-category-backend': '所选分类的产品在画布生效',
  'pld-size-backend': '画布产品数量与新数量一致',
  'pld-size-front': '预览产品数量与新数量一致',
  'pld-pagination-backend': '画布分页条显隐与设置一致',
  'pld-pagination-front': '预览分页条显隐与设置一致',
  'pld-compare-backend': '画布产品对比入口显隐',
  'pld-compare-off-front': '关闭产品对比后预览无入口',
});
export { displayFieldRequirements } from './product-list-effects.mjs';
import { runProductListEffects } from './product-list-effects.mjs';
export async function runBackendLayer(args) { return runJournaledProductListEffects(args, 'backend'); }

// The list's effect implementations live in a separate file and use effectCheck.
function runJournaledProductListEffects(args, layer) {
  const mutation = mutationContext(args.canvas, args.config, args.profile);
  return runProductListEffects(mutation ? { ...args, mutation } : args, layer);
}
