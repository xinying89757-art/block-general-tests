const CANVAS = 'iframe.backstage-pc-proview';
const PANEL = '.backstage-addmodules-chooseWrapper';
const PAGE_LABELS = { products: 'Products' };

function blockSelector(blockId) {
  // Quote an attribute value rather than assuming BLOCK_ID is numeric.
  return `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(blockId))}]`;
}

export async function openEditor(page, config) {
  if (!config.editSiteUrl) throw new Error('请配置 EDIT_SITE_URL（编辑器入口）。');
  await page.goto(config.editSiteUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  // The editor dialog appears after the initial page load settles.
  await page.waitForTimeout(5_000);
  const know = page.getByText('我知道了', { exact: true }).first();
  if (await know.isVisible()) await know.click();
  await page.getByText('页面:', { exact: true }).first().waitFor({ state: 'visible' });
}

// Resolve the page to test on: env TARGET_PAGE wins, then the block profile's
// target (recorded at first-run setup), then the default. pageKind is
// 'system' (default) or 'custom'; a custom page the flow created once is
// reused by name afterwards and is never deleted.
export function resolveTargetPage(config, profile) {
  const target = profile?.target || {};
  const page = (config.targetPage && config.targetPage !== 'products')
    ? config.targetPage
    : (target.page || config.targetPage || 'products');
  const kind = config.targetPageKind || target.pageKind || 'system';
  return { page, kind: kind === 'custom' ? 'custom' : 'system', createdByTest: Boolean(target.createdByTest) };
}

async function openPageMenu(page) {
  await page.getByText('页面:', { exact: true }).first().click();
  await page.waitForTimeout(2000);
}

async function clickPageTab(page, kind) {
  const tab = kind === 'custom' ? '自定义页面' : '系统页面';
  await page.locator('.backstage-topToolbar-pageBox .backstage-tab-title span', { hasText: tab }).first().click();
  await page.waitForTimeout(2000);
}

// List the pages in the currently open tab of the page menu. Returns
// [{ name, pageurl, href }]. System pages live in a <dl>, custom pages in a <ul>.
// Both tabs' lists stay in the DOM, so only visible links count.
async function listMenuPages(page) {
  return page.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const panel = document.querySelector('.backstage-topToolbar-pageBox');
    if (!panel) return [];
    return [...panel.querySelectorAll('a')].filter((a) => {
      if (a.offsetParent === null) return false;
      const li = a.closest('li, dt, dd');
      return li && a.getAttribute('data-href');
    }).map((a) => ({ name: norm(a.textContent), title: a.getAttribute('title'), pageurl: a.getAttribute('pageurl'), href: a.getAttribute('data-href') }));
  });
}

export async function gotoTargetPage(page, config) {
  const { page: targetPage, kind } = config.resolvedTarget || { page: config.targetPage, kind: 'system' };
  const label = PAGE_LABELS[targetPage.toLowerCase()] || targetPage;
  await openPageMenu(page);
  await clickPageTab(page, kind);
  const items = await listMenuPages(page);
  const match = items.find((item) => item.name === label || item.title === label)
    || items.find((item) => item.name.toLowerCase() === label.toLowerCase());
  if (!match) {
    const names = items.map((item) => item.name).join('、') || '（空）';
    throw new Error(`在${kind === 'custom' ? '自定义页面' : '系统页面'}中没有找到页面「${label}」（现有：${names}）。系统页无法新建，请改走新建自定义页面。`);
  }
  await page.locator(`.backstage-topToolbar-pageBox a[data-href=${JSON.stringify(match.href)}]`).first().click();
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  const frame = page.frameLocator(CANVAS);
  await frame.locator('body').waitFor({ state: 'attached', timeout: 60_000 });
  await page.waitForTimeout(3_000);
  return { frame, created: false };
}

async function ensurePageMenuOpen(page) {
  const visible = await page.locator('.backstage-topToolbar-pageBox').isVisible().catch(() => false);
  if (!visible) await openPageMenu(page);
}

// Create a blank custom page (editor 3.0): 新建页面 → 网页编辑器3.0 →
// template 空白 → 选取 → 页面设置（填名称 + URL）→ 确定.
// The page is a permanent test fixture and is never deleted (user decision).
// Assumes the editor is open. Returns { frame } on the new page.
export async function createCustomPage(page, name, urlPath) {
  await ensurePageMenuOpen(page);
  await page.locator('.backstage-topToolbar-pageBox').locator('text=新建页面').last().click();
  await page.waitForTimeout(2500);
  const dlg = page.locator('.backstage-dialog:visible', { hasText: '新建页面' }).first();
  await dlg.locator('text=网页编辑器3.0').first().click();
  await page.waitForTimeout(2500);
  const tpl = page.locator('.backstage-dialog:visible', { hasText: '新建页面' }).first();
  await tpl.locator('text=添加空白页').first().click();
  await page.waitForTimeout(1500);
  await tpl.locator('text=选取').first().click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  const settings = page.locator('.backstage-dialog:visible', { hasText: '页面设置' }).first();
  await settings.locator('input[name="page.pageTitle"]').waitFor({ state: 'visible', timeout: 15000 });
  await settings.locator('input[name="page.pageTitle"]').fill(name);
  await settings.locator('input[name="page.pageUrl"]').fill(urlPath);
  await settings.locator('text=/^确定$/').first().click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  const topBar = await page.evaluate(() => (document.querySelector('.backstage-topToolbar')?.innerText || '').replace(/\s+/g, ' ').trim());
  if (!topBar.includes(`页面: ${name}`)) {
    throw new Error(`新建页面后编辑器未切到「${name}」（顶栏：${topBar.slice(0, 120)}）。`);
  }
  const frame = page.frameLocator(CANVAS);
  await frame.locator('body').waitFor({ state: 'attached', timeout: 60_000 });
  await page.waitForTimeout(3_000);
  return { frame, created: true };
}

// Navigate to the profile's target page; create it first when it is a custom
// page that does not exist yet. System pages cannot be created.
export async function ensureTargetPage(page, config) {
  const { page: targetPage, kind } = config.resolvedTarget;
  try {
    return await gotoTargetPage(page, config);
  } catch (error) {
    if (kind !== 'custom' || !/没有找到页面/.test(error.message)) throw error;
    const slug = targetPage === `测试-${config.blockId}`
      ? `test-${config.blockId}`
      : targetPage.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test-page';
    return createCustomPage(page, targetPage, `/${slug}.html`);
  }
}

export async function addBlockIfNeeded(page, frame, config) {
  const containers = frame.locator(blockSelector(config.blockId));
  const countBefore = await containers.count();
  if (countBefore > 0) return { added: false, countBefore, countAfter: countBefore };

  const addButton = frame
    .locator('#backstage-bodyArea .backstage-creatmodules-wrapper').first()
    .locator('.backstage-creatmodules-addbtn').first();
  await addButton.scrollIntoViewIfNeeded();
  try {
    await addButton.click({ timeout: 5_000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    await addButton.click({ force: true });
  }
  const panel = page.locator(PANEL);
  await panel.waitFor({ state: 'visible' });

  const order = [...new Set([config.moduleType, 'develop', 'review', 'online'])];
  const attempts = [];
  for (const moduleType of order) {
    if (moduleType === 'online') {
      const search = panel.locator('.addmodules_searchWrap input');
      await search.fill(String(config.blockId));
      await search.press('Enter');
    } else {
      // The panel may not have this tab at all (47748: only the review tab
      // exists, no develop tab). Skip a missing tab instead of timing out.
      const value = moduleType === 'develop' ? '-1' : '-2';
      const tab = panel.locator(`.user-handle-module[value="${value}"]`).first();
      if (!await tab.count()) { attempts.push({ moduleType, found: false, reason: '页签不存在' }); continue; }
      await tab.click();
    }

    const candidate = panel.locator(`.btn.add[appid=${JSON.stringify(String(config.blockId))}]`).first();
    try {
      // The add button is hidden until hover; attachment is the useful signal.
      await candidate.waitFor({ state: 'attached', timeout: 15_000 });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      attempts.push({ moduleType, found: false });
      continue;
    }

    const clicked = await page.evaluate(({ panelSelector, blockId }) => {
      const buttons = document.querySelector(panelSelector)?.querySelectorAll('.btn.add[appid]') || [];
      const button = [...buttons].find((el) => el.getAttribute('appid') === blockId);
      if (!button) return false;
      button.style.display = 'block';
      button.scrollIntoView({ block: 'center' });
      button.click();
      return true;
    }, { panelSelector: PANEL, blockId: String(config.blockId) });
    attempts.push({ moduleType, found: clicked });
    if (!clicked) continue;

    // Once clicked, do not try another list: a slow render could duplicate the block.
    await containers.first().waitFor({ state: 'attached', timeout: 60_000 });
    const close = panel.locator('.addmodules_searchContainer > .block-iconbaseline-close').first();
    if (await close.isVisible()) await close.click();
    await panel.waitFor({ state: 'hidden' });
    return { added: true, addedVia: moduleType, countBefore, countAfter: await containers.count(), attempts };
  }
  throw new Error(`区块 ${config.blockId} 在模块列表中未找到（已尝试 ${order.join(' → ')}）。`);
}

export async function savePage(page) {
  const save = page.locator('#saveLayout');
  await save.waitFor({ state: 'visible' });
  // No stable business-success selector is known yet. Observe save HTTP errors,
  // then wait for network quiescence and the save control to become available.
  const failedResponses = [];
  const onResponse = (response) => {
    const request = response.request();
    if (/save/i.test(response.url()) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !response.ok()) {
      failedResponses.push(response.status());
    }
  };
  page.on('response', onResponse);
  try {
    await save.click();
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    await page.waitForFunction(() => {
      const button = document.querySelector('#saveLayout');
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    });
    if (failedResponses.length) throw new Error(`保存请求失败：HTTP ${failedResponses.join(', ')}。`);
  } finally {
    page.off('response', onResponse);
  }
}

export async function openPreview(page, context) {
  const [previewPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 30_000 }),
    page.locator('.clickToPreview').click(),
  ]);
  await previewPage.waitForLoadState('domcontentloaded');
  const isContent = (frame) => {
    try {
      return new URL(frame.url()).hostname.endsWith('.preview.leadong.com');
    } catch {
      return false;
    }
  };

  // Register before inspecting existing frames so a navigation cannot be missed.
  let onFrame;
  let timer;
  const pending = new Promise((resolve, reject) => {
    onFrame = (frame) => { if (isContent(frame)) resolve(frame); };
    previewPage.on('framenavigated', onFrame);
    timer = setTimeout(() => reject(new Error(
      '预览页中未找到 URL 属于 .preview.leadong.com 的内容 frame，请检查预览加载和登录态。',
    )), 30_000);
    const existing = previewPage.frames().find(isContent);
    if (existing) resolve(existing);
  });
  try {
    const frame = await pending;
    await frame.locator('body').waitFor({ state: 'attached' });
    await frame.waitForLoadState('load', { timeout: 45_000 });
    return { previewPage, frame };
  } finally {
    clearTimeout(timer);
    previewPage.off('framenavigated', onFrame);
  }
}
