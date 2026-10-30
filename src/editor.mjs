import { saveAndWait } from './ui-waits.mjs';

const CANVAS = 'iframe.backstage-pc-proview';
const PANEL = '.backstage-addmodules-chooseWrapper';
const PAGE_LABELS = { products: 'Products' };

function blockSelector(blockId) {
  // Quote an attribute value rather than assuming BLOCK_ID is numeric.
  return `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(blockId))}]`;
}

export const SITE_LIST_URL = 'https://www.leadong.com/website.html';
const PLATFORM_HOSTS = new Set(['www.leadong.com', 'website.leadong.com', 'jianzhan.leadong.com']);
const LANGUAGE_NAMES = { 0: '英语', 1: '中文（简体）', 3: '阿拉伯语', 4: '法语', 10: '日语', 11: '韩语' };
const LANGUAGE_PREFIXES = { en: 0, cn: 1, sa: 3, fr: 4, jp: 10, kr: 11 };

function hostOf(value) {
  try { return new URL(value).host.toLowerCase(); } catch { return ''; }
}

export function targetLanguage(config) {
  if (config.editSiteUrl) {
    try {
      const code = new URL(config.editSiteUrl).searchParams.get('l');
      if (code !== null && LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
    } catch { /* Fall back to the public hostname. */ }
  }
  const prefix = hostOf(config.siteDomain).split(/[.-]/)[0];
  return LANGUAGE_NAMES[LANGUAGE_PREFIXES[prefix] ?? 0];
}

export function matchAttachedCardIndexes(hosts, targetHost) {
  return hosts.flatMap((host, index) => host === targetHost ? [index] : []);
}

export async function discoverPublicBaseUrl(card) {
  const urls = await card.locator('a[href], [data-url], [data-href]').evaluateAll((nodes) =>
    nodes.flatMap((node) => ['href', 'data-url', 'data-href'].map((attr) => node.getAttribute(attr)).filter(Boolean)),
  );
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (!/^https?:$/i.test(url.protocol)) continue;
      if (['website.leadong.com', 'jianzhan.leadong.com'].includes(url.hostname.toLowerCase()) || /\/phoenix\//i.test(url.pathname)) continue;
      return url.origin;
    } catch { /* Ignore relative links and javascript handlers. */ }
  }
  return '';
}

export async function enterSiteFromList(page, config) {
  const cards = page.locator('.mySiteBox');
  if (await cards.count() === 0) {
    if (config.editSiteUrl) {
      console.warn('[editor] 站点列表未找到 .mySiteBox，退回备选 EDIT_SITE_URL。');
      await page.goto(config.editSiteUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
      return page;
    }
    throw new Error(`站点列表结构可能已变化，未找到 .mySiteBox，且未配置备选 EDIT_SITE_URL；需要重新探查选择器。当前地址：${page.url()}`);
  }

  const availableCards = [];
  const hosts = [];
  const targetHost = hostOf(config.siteDomain);
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    const publicUrl = await discoverPublicBaseUrl(card);
    hosts.push(hostOf(publicUrl));
    availableCards.push(card);
  }
  const matches = matchAttachedCardIndexes(hosts, targetHost).map((index) => availableCards[index]);
  // A name is an optional fallback, never a way to hide ambiguous host matches.
  if (!matches.length && config.siteName) {
    for (const card of availableCards) {
      if (await card.getByText(config.siteName, { exact: true }).count()) matches.push(card);
    }
  }
  if (matches.length !== 1) {
    throw new Error(`站点列表匹配到 ${matches.length} 张卡片（SITE_DOMAIN=${config.siteDomain}，SITE_NAME=${config.siteName || '未设置'}）。必须唯一；请检查站名、语言和站点权限，账号无目标站权限时请换账号。当前地址：${page.url()}`);
  }
  const card = matches[0];
  await card.scrollIntoViewIfNeeded();
  const name = targetLanguage(config);
  const languages = card.locator('.lansSelect .lanItem');
  let language;
  for (let index = 0; index < await languages.count(); index += 1) {
    const candidate = languages.nth(index);
    if ((await candidate.innerText()).trim() === name) { language = candidate; break; }
  }
  if (language) {
    const selected = await language.evaluate((element) => element.classList.contains('on') || element.getAttribute('aria-selected') === 'true');
    if (!selected) await language.click();
  } else {
    console.warn(`[editor] 目标站卡片未找到语言“${name}”，继续使用卡片当前语言。`);
  }

  const context = page.context();
  const knownPages = new Set(context.pages());
  // Even a subsequent navigation must not revive an editor left by an earlier run.
  const oldEditors = new Set([...knownPages].filter((candidate) => candidate.url().includes('/phoenix/pagebuilder')));
  const navigatedPages = new Set();
  const listeners = new Map();
  const listen = (candidate) => {
    const listener = (frame) => { if (frame === candidate.mainFrame()) navigatedPages.add(candidate); };
    candidate.on('framenavigated', listener);
    listeners.set(candidate, listener);
  };
  for (const candidate of knownPages) listen(candidate);
  context.on('page', listen);
  try {
    await card.locator('.userEditSite').first().click();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const editors = context.pages().filter((candidate) => !candidate.isClosed() &&
        !oldEditors.has(candidate) && candidate.url().includes('/phoenix/pagebuilder'));
      const editor = editors.find((candidate) => !knownPages.has(candidate)) ||
        editors.find((candidate) => candidate === page) ||
        editors.find((candidate) => navigatedPages.has(candidate));
      if (editor) {
        await editor.waitForLoadState('domcontentloaded');
        return editor;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`点击编辑网站后 60 秒内未进入本次 pagebuilder，拒绝复用旧编辑器。当前地址：${context.pages().filter((candidate) => !candidate.isClosed()).map((candidate) => candidate.url()).join(', ')}。请检查站名、语言和站点权限。`);
  } finally {
    context.off('page', listen);
    for (const [candidate, listener] of listeners) candidate.off('framenavigated', listener);
  }
}

export async function openEditor(page, config) {
  await page.goto(SITE_LIST_URL, { waitUntil: 'domcontentloaded' });
  if (/\/login(?:\.html)?(?:[?#]|$)/i.test(page.url())) {
    throw new Error(`站点列表已跳转到登录页（${page.url()}），请重跑 scripts/explore-login.mjs 刷新登录态。`);
  }
  try {
    await page.locator('.mySiteBox').first().waitFor({ state: 'attached', timeout: 30_000 });
  } catch {
    if (!config.editSiteUrl) throw new Error(`等待站点列表 .mySiteBox 超时，当前地址：${page.url()}。`);
  }
  let editorPage;
  try {
    editorPage = await enterSiteFromList(page, config);
  } catch (error) {
    if (!config.editSiteUrl || !String(error.message).includes('未找到 .mySiteBox')) throw error;
    console.warn('[editor] 站点列表结构变化，退回备选 EDIT_SITE_URL。');
    await page.goto(config.editSiteUrl, { waitUntil: 'domcontentloaded' });
    editorPage = page;
  }
  if (!editorPage.url().includes('/phoenix/pagebuilder')) {
    throw new Error(`未进入领动编辑器，当前地址：${editorPage.url()}。请检查站名、语言和站点权限；登录态失效时重跑 scripts/explore-login.mjs。`);
  }
  await verifyEditorSiteIdentity(editorPage, config);
  await waitForEditorReady(editorPage);
  return { page: editorPage };
}

export async function verifyEditorSiteIdentity(page, config) {
  const expectedHost = hostOf(config.siteDomain);
  if (!expectedHost) return;
  const foundHosts = new Set();
  const current = hostOf(page.url());
  if (current && !PLATFORM_HOSTS.has(current)) foundHosts.add(current);
  try {
    const hosts = await page.evaluate(() => {
      const values = [...document.querySelectorAll('[data-site-domain], [data-domain]')]
        .flatMap((node) => ['data-site-domain', 'data-domain'].map((key) => node.getAttribute(key)).filter(Boolean));
      return values.map((value) => { try { return new URL(value, location.href).host.toLowerCase(); } catch { return ''; } });
    });
    for (const host of hosts) if (host && !PLATFORM_HOSTS.has(host)) foundHosts.add(host);
  } catch { /* Some editor shells prevent DOM inspection; identity remains unverified. */ }
  if (!foundHosts.size) {
    console.warn(`[editor] 无法从编辑器页面确认当前站点身份（目标 host: ${expectedHost}）。`);
    return;
  }
  if (!foundHosts.has(expectedHost)) {
    throw new Error(`编辑器站点身份不匹配：目标 host 为 ${expectedHost}，页面可识别 host 为 ${[...foundHosts].join(', ')}。`);
  }
}

async function waitForEditorReady(page) {
  await page.waitForTimeout(5_000);
  const know = page.getByText('我知道了', { exact: true }).first();
  if (await know.isVisible()) await know.click();
  await page.getByText('页面:', { exact: true }).first().waitFor({ state: 'visible' });
}

// CMS field changes become visible after an editor reload; no publishing.
// Without config preserve the current page; fixture preparation supplies config.
export async function reloadEditor(page, config) {
  const currentPageName = () => page.evaluate(() => {
    const text = (document.querySelector('.backstage-topToolbar')?.innerText || '').replace(/\s+/g, ' ').trim();
    return text.match(/页面:\s*(.*?)\s+(?:智能优化当前页面\s+)?保存(?:\s|$)/)?.[1] || '';
  });
  const before = await currentPageName();
  const target = config?.resolvedTarget;
  const wanted = target ? (PAGE_LABELS[target.page.toLowerCase()] || target.page) : before;
  if (!wanted) throw new Error('刷新编辑器前无法确定目标页。');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForEditorReady(page);
  if (await currentPageName() !== wanted) {
    if (!config) throw new Error(`刷新编辑器后未停留在目标页「${wanted}」，请提供目标页配置。`);
    await ensureTargetPage(page, config);
  }
  const actual = await currentPageName();
  if (actual !== wanted) throw new Error(`刷新后目标页核对失败：应为「${wanted}」，顶栏读到「${actual}」。`);
  return { frame: page.frameLocator(CANVAS) };
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
      // The panel may not have this tab at all (另一样本区块: only the review tab
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
  // then require completed writes, an available save control and a stable canvas.
  const failedResponses = [];
  const onResponse = (response) => {
    const request = response.request();
    if (/save/i.test(response.url()) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !response.ok()) {
      failedResponses.push(response.status());
    }
  };
  page.on('response', onResponse);
  try {
    // A leftover hidden dialog backdrop (.backstage-dialog-overlay.hide) can
    // intercept pointer events on the save button for the full click timeout
    // even though the button is visible, enabled and stable; a DOM click
    // bypasses the hit-target check, as the CMS sidebar clicks do.
    await saveAndWait(page, () => save.evaluate((el) => el.click()));
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

// The share panel is rendered on the preview shell, not in the editor page.
// Read only its visible text and close it before front checks begin.
export async function getPreviewShareLink(previewPage) {
  const qr = previewPage.locator('a.backstage-icon-QR-code').first();
  try {
    await qr.waitFor({ state: 'visible', timeout: 5_000 });
    await qr.click({ timeout: 5_000 });
    const panel = previewPage.locator('div').filter({ hasText: '预览链接有效期' }).filter({ visible: true });
    await panel.first().waitFor({ state: 'visible', timeout: 5_000 });
    const text = await panel.evaluateAll((nodes) => {
      const candidates = nodes.filter((node) => /预览链接有效期/.test(node.innerText || ''))
        .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      return candidates[0]?.innerText || '';
    });
    const match = text.match(/https?:\/\/website\.leadong\.com\/share\/preview\/index\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}/i);
    let link = match?.[0] || null;
    if (!link) {
      const src = await panel.locator('img').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src') || ''));
      for (const value of src) {
        const candidate = value.match(/[?&]previewShareLink=([^&]+)/)?.[1];
        if (candidate) { try { link = decodeURIComponent(candidate); } catch { link = candidate; } break; }
      }
    }
    try { await qr.click({ timeout: 2_000 }); } catch { try { await previewPage.keyboard.press('Escape'); } catch {} }
    await panel.first().waitFor({ state: 'hidden', timeout: 2_000 }).catch(async () => {
      try { await previewPage.keyboard.press('Escape'); } catch {}
    });
    return link;
  } catch {
    try { await previewPage.keyboard.press('Escape'); } catch {}
    return null;
  }
}
