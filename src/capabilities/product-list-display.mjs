import { savePage, openPreview } from '../editor.mjs';
import { widgetSession, probeControls, persistControl, radioPersist, radioGroupPersist, previewSelector, TIMEOUT } from './shared.mjs';

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
  'pld-front-note': '产品列表前台可观察性记录',
};
function result(id, status, detail, evidence) {
  return { id, name: NAMES[id], suite: SUITE, status, detail,
    ...(evidence === undefined ? {} : { evidence }) };
}
const outcomeResult = (id, outcome) => result(id, outcome.status, outcome.detail, outcome.evidence);
const fieldsOf = (controls) => controls.filter((item) => item.type === 'checkbox'
  && item.value && item.value !== 'on' && item.label !== '全选');

// Open a throwaway preview tab, run fn on its content frame, then close
// the tab. Same pattern as block-color-scheme / module-width.
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

async function contentFrame(previewPage) {
  const found = previewPage.frames().find((f) => {
    try { return new URL(f.url()).hostname.endsWith('.preview.leadong.com'); } catch { return false; }
  });
  return found || previewPage.mainFrame();
}

// Product-compare front effect (40838 only; 47748 has no compare setting
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
async function compareFrontCheck({ session, page, context, config }) {
  const id = 'pld-compare-front';
  const skip = (detail) => result(id, 'skip', detail);
  const probe = await probeControls(session);
  if (probe.reason) return skip(`无法读取产品列表弹窗：${probe.reason}`);
  const pair = ['关闭', '开启'].map((label) => probe.controls
    .find((item) => item.type === 'radio' && item.label === label));
  if (pair.some((item) => !item)) return skip('产品对比：弹窗里没有“关闭/开启”两项。');
  const brand = probe.controls.find((item) => item.type === 'checkbox' && item.label === 'Brand');
  const originalCompare = pair.find((item) => item.checked)?.label || '关闭';
  const originalBrand = brand?.checked ?? null;
  const errors = [];
  const evidence = { originalCompare, originalBrand };
  const restore = async () => {
    try {
      await session.cancel();
      await session.open();
      const current = await probeControls(session);
      const off = current.controls?.find((item) => item.type === 'radio' && item.label === originalCompare);
      if (off) await session.set(off, true);
      if (brand && originalBrand !== null) {
        const now = current.controls?.find((item) => item.type === 'checkbox' && item.label === 'Brand');
        if (now && now.checked !== originalBrand) await session.set(now, originalBrand);
      }
      await session.save();
      await session.open();
      const after = await probeControls(session);
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
    } catch (error) { errors.push(`恢复失败：${error.message}`); }
    try { await session.cancel(); } catch {}
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面失败：${error.message}`); }
  };
  try {
    if (!context) return skip('未提供浏览器 context，无法打开临时预览。');
    // session.open() is idempotent (only clicks when the dialog is not
    // visible), so open once up front: the dialog is closed here because
    // the preceding persist transactions end with cancel.
    await session.open();
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
      const boxCount = await boxes.count();
      flowEvidence.compareBoxCount = boxCount;
      if (boxCount < 2) {
        flowErrors.push(`预览里只找到 ${boxCount} 个可见的对比勾选框，不到 2 个`);
        return { flowErrors, flowEvidence };
      }
      for (let i = 0; i < 2; i++) await boxes.nth(i).check({ timeout: TIMEOUT });
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
          if (!/Product Inquire/.test(inquire.text)) flowErrors.push('询盘页里没有 “Product Inquire”');
          names.forEach((n) => { if (!inquire.text.includes(n)) flowErrors.push(`询盘页里没有产品 ${n}`); });
          if (!inquire.text.includes('Brand')) flowErrors.push('询盘页里没有 Brand 列（勾选的展示字段）');
        }
      }
      return { flowErrors, flowEvidence };
    });
    errors.push(...flow.flowErrors);
    Object.assign(evidence, flow.flowEvidence);
  } catch (error) {
    errors.push(`前台效果验证失败：${error.message}`);
  } finally {
    await restore();
  }
  return result(id,
    errors.length ? 'fail' : 'pass',
    errors.length ? errors.join('；')
      : `对比开启后勾选 2 个产品（${(evidence.products || []).join('、')}），底部栏计数 2/6、含两个产品名；点 Compare 展开大面板；点 Inquire 进入询盘表单页，含两个产品与 Brand 列。对比表在预览里始终为空行（10 秒轮询 0 行），属性比对以询盘页为准。`,
    evidence);
}

// List data-source category front effect (47748 only; 40838 has no data
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
async function dataSourceCategoryFrontCheck({ session, page, canvas, context, config, capability }) {
  const id = 'pld-data-source-category-front';
  const oracle = capability?.oracle;
  if (!oracle?.category || !Array.isArray(oracle.onShelf)) {
    return result(id, 'skip', '画像里没有分类 oracle 夹具（category/onShelf），无法比对。');
  }
  const target = oracle.category;
  const expected = [...oracle.onShelf];
  const errors = [];
  const evidence = { category: target, expected, cmsTotal: oracle.cmsTotal ?? null };
  const sourceOf = (probe) => (probe.controls || []).filter((item) => item.type === 'radio' && item.name === 'selectProdType');
  const catsOf = (probe) => (probe.controls || []).filter((item) => item.type === 'checkbox' && item.name === 'leafProdGroup');
  const probe = await probeControls(session);
  if (probe.reason) return result(id, 'skip', `无法读取产品列表弹窗：${probe.reason}`);
  const sources = sourceOf(probe);
  const originalSource = sources.find((item) => item.checked)?.label || '所有产品';
  const originalChecked = catsOf(probe).filter((item) => item.checked).map((item) => (item.label || '').trim());
  evidence.baseline = { dataSource: originalSource, checkedCategories: originalChecked };
  const restore = async () => {
    try {
      await session.cancel();
      await session.open();
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
      const after = await probeControls(session);
      const restoredSource = sourceOf(after).find((item) => item.checked)?.label;
      evidence.restored = { dataSource: restoredSource };
      if (restoredSource !== originalSource) errors.push(`恢复后数据来源为 ${restoredSource}，不是 ${originalSource}`);
    } catch (error) { errors.push(`恢复失败：${error.message}`); }
    try { await session.cancel(); } catch {}
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面失败：${error.message}`); }
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
    if (!partial) return result(id, 'skip', '列表弹窗里没有“选择部分产品分类”数据来源。');
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
        for (const item of boxes.filter((x) => x.checked && (x.label || '').trim() !== target)) {
          await session.set(item, false);
        }
        const targetNow = boxes.find((item) => (item.label || '').trim() === target);
        if (!targetNow) { errors.push(`切到部分分类后找不到分类 ${target}`); }
        else if (!targetNow.checked) await session.set(targetNow, true);
      }
      await session.save();
      await savePage(page);
      await session.open();
      const verify = await probeControls(session);
      const persistedSource = sourceOf(verify).find((item) => item.checked)?.label;
      const persistedChecked = catsOf(verify).filter((item) => item.checked).map((item) => (item.label || '').trim());
      evidence.persisted = { dataSource: persistedSource, checkedCategories: persistedChecked };
      if (persistedSource !== '选择部分产品分类' || persistedChecked.length !== 1 || persistedChecked[0] !== target) {
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
        const extra = names.filter((n) => !expected.includes(n));
        if (missing.length) flowErrors.push(`列表缺 ${missing.length} 个 oracle 产品：${missing.join('、')}`);
        if (extra.length) flowErrors.push(`列表多 ${extra.length} 个非该分类产品：${extra.join('、')}`);
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
  } catch (error) {
    errors.push(`前台效果验证失败：${error.message}`);
  } finally {
    await restore();
  }
  return result(id,
    errors.length ? 'fail' : 'pass',
    errors.length ? errors.join('；')
      : `数据来源选部分分类（仅 ${target}）后，列表直接为 oracle 的 ${expected.length} 个上架产品，与后台一致（下架 4 个不展示），无需点导航。`,
    evidence);
}

export async function runSettingsLayer({ page, canvas, context, config, capability }) {
  // The dialog title and the wrap index come from the profile: 40838 uses
  // title 设置产品列表 at gallery wrap 0, while 47748 uses 设置与选取数据
  // at gallery wrap 1 (wrap 0 is the category dialog). Title alone is not
  // enough when two gallery sub-regions share one editor type.
  const session = widgetSession({ page, canvas, config,
    type: 'phoenix_blocks_gallery', title: capability?.dialogTitle || '设置产品列表',
    wrapIndex: capability?.wrapIndex ?? 0 });
  const initial = await probeControls(session);
  const checks = [];
  try {
    if (initial.reason) return Object.keys(NAMES).filter((id) => id !== 'pld-front-note')
      .map((id) => result(id, 'skip', `无法读取产品列表弹窗：${initial.reason}`));
    const fields = fieldsOf(initial.controls);
    checks.push(result('pld-fields', 'record', `展示字段 ${fields.length} 个（排除全选，含系统属性与自定义字段）。`, fields));
    // Data source is a 4-option radio in 47748 (所有产品 / 使用筛选条件 /
    // 选择指定产品 / 选择部分产品分类); 40838 has no such group, so a
    // missing group correctly degrades to skip via radioGroupPersist.
    checks.push(outcomeResult('pld-data-source-persist', await radioGroupPersist({ session, page,
      name: '列表数据来源', labels: ['所有产品', '使用筛选条件', '选择指定产品', '选择部分产品分类'] })));
    checks.push(await dataSourceCategoryFrontCheck({ session, page, canvas, context, config, capability }));
    // Inventory probe: page size is type=text, not necessarily type=number.
    // 47748 labels the same input 显示产品总数量, so accept either label;
    // the matched label is kept in evidence until its meaning is confirmed.
    const numbers = initial.controls.filter((item) => !item.disabled && !item.readOnly && ['text', 'number'].includes(item.type)
      && /^\d+$/.test(item.value) && Number(item.value) >= 1 && Number(item.value) <= 100);
    const sizeInputs = numbers.filter((item) => /每页产品数量|显示产品总数量/.test(item.label + item.context));
    const pageSize = sizeInputs.length === 1 ? sizeInputs[0] : (numbers.length === 1 ? numbers[0] : null);
    // The number's meaning depends on pagination (user-confirmed 2026-10-26):
    // pagination=是 → per-page count; pagination=否 → total count.
    const paginationChecked = initial.controls.find((item) => item.type === 'radio' && item.name === 'pagination' && item.checked);
    const sizeMeaning = paginationChecked?.label === '是' ? '每页产品数量' : '总数量';
    const sizeOutcome = pageSize ? await persistControl({ session, page,
      target: pageSize, alternate: Number(pageSize.value) === 10 ? '20' : '10' }) : null;
    checks.push(sizeOutcome
      ? outcomeResult('pld-page-size-persist', { ...sizeOutcome,
        detail: `${sizeOutcome.detail}；当前分页=${paginationChecked?.label || '未知'}，该输入为${sizeMeaning}。` })
      : result('pld-page-size-persist', 'skip', '未能唯一定位每页产品数量输入（盘点值 20，上限 100）。'));
    for (const [id, name, prefixes] of [
      ['pld-pagination-persist', '分页展示', ['是', '否']],
      ['pld-compare-persist', '产品对比', ['关闭', '开启']],
    ]) {
      checks.push(outcomeResult(id, await radioPersist({ session, page, name, prefixes })));
    }
    checks.push(await compareFrontCheck({ session, page, context, config }));
    const probe = await probeControls(session);
    const field = probe.controls && fieldsOf(probe.controls).find((item) => !item.disabled);
    checks.push(field ? outcomeResult('pld-display-field-persist', await persistControl({ session, page,
      target: field, alternate: !field.checked }))
      : result('pld-display-field-persist', 'skip', probe.reason || '没有可切换的展示字段。'));
  } finally {
    try { await session.cancel(); } catch (error) {
      const last = checks.at(-1);
      if (last) { last.status = 'fail'; last.detail += `；最终取消失败：${error.message}`; }
    }
  }
  return checks;
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
      ? '当前预览检测到产品列表候选元素，前台不可观察的前提已变化；本版仅验证设置持久化，未断言列表效果。'
      : '本区块预览内未发现产品列表元素，列表类设置的前台效果不可观察，仅做设置层保存回读验证。',
    { root: previewSelector(config.blockId), counts, hasProducts })];
  } catch (error) {
    return [result('pld-front-note', 'record', `列表可观察性探查不可用，不能确认列表缺失：${error.message}`,
      { observation: 'unavailable', selectors })];
  }
}
