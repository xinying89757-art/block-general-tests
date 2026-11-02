import { retryEnvironmentTimeout, saveAndWait, waitForEditorLoadingToClear, waitForStable } from './ui-waits.mjs';
import { selectedBlockInstance, waitForCanvasRender } from './block-render.mjs';
import { waitForUniquePageSaveControl } from './page-save-control.mjs';

const CANVAS = 'iframe.backstage-pc-proview';
const PANEL = '.backstage-addmodules-chooseWrapper';
const PAGE_LABELS = { products: 'Products' };

export function resolveCurrentPageLabel({ activeItems = [], toolbarText = '' } = {}) {
  const active = activeItems.filter((item) => item.active && String(item.label || '').trim());
  if (active.length === 1) return String(active[0].label).replace(/\s+/g, ' ').trim();
  const normalized = String(toolbarText || '').replace(/\s+/g, ' ').trim();
  const afterPagePrefix = normalized.match(/(?:^|\s)页面:\s*(.*)$/)?.[1] || '';
  const action = afterPagePrefix.match(/(?:^|\s)(?:智能优化当前页面|操作记录|保存|发布|预览)(?:\s|$)/);
  return (action ? afterPagePrefix.slice(0, action.index) : afterPagePrefix).trim();
}

export function assertCurrentPageLabel(snapshot, expected) {
  const actual = typeof snapshot === 'string' ? snapshot : resolveCurrentPageLabel(snapshot);
  if (!actual) throw new Error('刷新编辑器后无法读取当前页面自己的活动标签。');
  if (actual !== expected) throw new Error(`刷新后目标页核对失败：应为「${expected}」，当前活动页为「${actual}」。`);
  return actual;
}

export function hasActivePageMarker(ancestors = []) {
  return ancestors.some((node) => {
    const attrs = ['aria-current', 'aria-selected', 'data-active'].map((key) => node?.[key] || '');
    const classes = String(node?.className || '');
    return attrs.some((value) => value && value !== 'false')
      || /(?:^|\s)(?:active|current|selected|on)(?:\s|$)/i.test(classes);
  });
}

async function readCurrentPageSnapshot(page) {
  await waitForEditorLoadingToClear(page);
  const snapshot = await page.evaluate(() => {
    const toolbar = document.querySelector('.backstage-topToolbar');
    const pageBox = toolbar?.querySelector('.backstage-topToolbar-pageBox');
    const activeItems = pageBox ? [...pageBox.querySelectorAll('a[data-href]')].map((anchor) => {
      const ancestors = [];
      for (let node = anchor; node && node !== pageBox; node = node.parentElement) {
        ancestors.push({ className: typeof node.className === 'string' ? node.className : node.className?.baseVal || '',
          'aria-current': node.getAttribute?.('aria-current'), 'aria-selected': node.getAttribute?.('aria-selected'),
          'data-active': node.getAttribute?.('data-active') });
      }
      return { label: (anchor.textContent || '').replace(/\s+/g, ' ').trim(), ancestors };
    }) : [];
    const clone = toolbar?.cloneNode(true);
    clone?.querySelector('.backstage-topToolbar-pageBox')?.remove();
    return { activeItems, toolbarText: (clone?.innerText || '').replace(/\s+/g, ' ').trim() };
  });
  return { ...snapshot, activeItems: snapshot.activeItems.map(({ label, ancestors }) => ({
    label, active: hasActivePageMarker(ancestors),
  })) };
}

/** Read and optionally verify the selected page through one shared, mask-aware path. */
export async function verifyCurrentPageIdentity(page, expected) {
  const snapshot = await readCurrentPageSnapshot(page);
  const actual = resolveCurrentPageLabel(snapshot);
  if (!actual) throw new Error('刷新编辑器后无法读取当前页面自己的活动标签。');
  return expected === undefined ? actual : assertCurrentPageLabel(actual, expected);
}

async function visiblePageMenuLinkCount(page) {
  return page.evaluate(() => [...document.querySelectorAll('.backstage-topToolbar-pageBox a[data-href]')]
    .filter((anchor) => anchor.getClientRects().length > 0
      && getComputedStyle(anchor).visibility !== 'hidden' && getComputedStyle(anchor).display !== 'none').length);
}

export function selectNeutralToolbarCandidate(candidates = []) {
  return candidates.find((candidate) => candidate.insideToolbar && !candidate.insideChooser
    && !candidate.insideCanvas && !candidate.interactive && !candidate.hasClickHandler) || null;
}

async function clickNeutralToolbarArea(page) {
  const candidates = await page.evaluate(() => {
    const toolbar = document.querySelector('.backstage-topToolbar');
    if (!toolbar) return [];
    const rect = toolbar.getBoundingClientRect();
    const interactive = 'button,a,[role="button"],input,select,textarea,[tabindex]:not([tabindex="-1"]),[onclick]';
    const points = [];
    const xs = [rect.left + rect.width * 0.32, rect.left + rect.width * 0.5, rect.left + rect.width * 0.68];
    const ys = [rect.top + rect.height * 0.5];
    for (const x of xs) for (const y of ys) {
      const target = document.elementFromPoint(x, y);
      if (!target) continue;
      points.push({ x, y, insideToolbar: toolbar.contains(target),
        insideChooser: Boolean(target.closest('.backstage-topToolbar-pageBox')),
        insideCanvas: Boolean(target.closest('iframe, .backstage-pc-proview')),
        interactive: Boolean(target.closest(interactive)), hasClickHandler: Boolean(target.onclick) });
    }
    return points;
  });
  const point = selectNeutralToolbarCandidate(candidates);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

async function savePageChooserFailureScreenshot(page) {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const directory = path.resolve(process.cwd(), 'reports', 'screenshots');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `page-chooser-dismiss-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true, timeout: 10_000 });
    return path.relative(process.cwd(), file);
  } catch { return null; }
}

/** Close an open page chooser without navigating or saving the page. */
export async function closePageMenuIfOpen(page, { triggerTimeoutMs = 5_000, neutralTimeoutMs = 3_000 } = {}) {
  await waitForEditorLoadingToClear(page);
  if (await visiblePageMenuLinkCount(page) === 0) return false;
  // Dropdowns can remain open after the toolbar label is clicked (the page
  // chooser may own a nested overlay). Escape is a non-mutating dismissal and
  // is attempted first; only fall back to the unique toolbar trigger if it did
  // not close the menu.
  try { await page.keyboard?.press('Escape'); } catch {}
  if (await visiblePageMenuLinkCount(page) === 0) return true;
  const triggers = page.getByText('页面:', { exact: true }).filter({ visible: true });
  const count = await triggers.count();
  let triggerFailure = count === 1 ? null : new Error(`关闭触发器匹配 ${count} 个；拒绝点击。`);
  if (count === 1) {
    try {
      await triggers.click({ timeout: triggerTimeoutMs });
      await waitForStable(() => visiblePageMenuLinkCount(page), (links) => links === 0,
        { timeout: triggerTimeoutMs, stableMs: 200 });
      return true;
    } catch (error) { triggerFailure = error; }
  }
  let remaining = await visiblePageMenuLinkCount(page).catch(() => -1);
  let neutralAttempted = false;
  if (remaining > 0) {
    neutralAttempted = await clickNeutralToolbarArea(page).catch(() => false);
    if (neutralAttempted) {
      try {
        await waitForStable(() => visiblePageMenuLinkCount(page), (links) => links === 0,
          { timeout: neutralTimeoutMs, stableMs: 200 });
        return true;
      } catch { remaining = await visiblePageMenuLinkCount(page).catch(() => -1); }
    }
  }
  const screenshot = await savePageChooserFailureScreenshot(page);
  throw new Error(`页面选择菜单关闭失败：唯一触发器匹配 ${count} 个；关闭后仍有 ${remaining} 个可见链接；中立非画布点击${neutralAttempted ? '已尝试' : '不可用'}；${triggerFailure?.message || '触发器路径未能关闭菜单'}; screenshot=${screenshot || 'unavailable'}`);
}

/** Resolve a Playwright Frame/Page to its owning Page and close a visible page chooser before a generic canvas action. */
export async function closeToolbarMenusBeforeAction(scope) {
  const page = typeof scope?.page === 'function' ? scope.page() : scope;
  if (!page || typeof page.locator !== 'function' || typeof page.evaluate !== 'function') return false;
  return closePageMenuIfOpen(page);
}

const EDITOR_DIALOGS = '.backstage-dialog:visible, [role="dialog"]:visible, dialog:visible';
const EDITOR_OVERLAYS = '.backstage-dialog-overlay, .layui-layer-shade, [data-editor-overlay]';

async function blockingEditorOverlays(scope) {
  return scope.locator('body').evaluate((body, selector) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        && style.pointerEvents !== 'none';
    };
    return [...body.ownerDocument.querySelectorAll(selector)].filter(visible).map((element) => {
      const style = getComputedStyle(element);
      const classes = typeof element.className === 'string' ? element.className.trim() : '';
      const name = element.tagName.toLowerCase() + (classes ? `.${classes.split(/\s+/).join('.')}` : '');
      return `${name} (pointer-events:${style.pointerEvents}, z-index:${style.zIndex})`;
    });
  }, EDITOR_OVERLAYS).catch(() => []);
}

/** Dismiss open editor dialogs, then briefly wait for stale backdrops to stop intercepting input. */
export async function waitForEditorOverlaysBeforeAction(scope, { timeoutMs = 800, intervalMs = 50 } = {}) {
  if (!scope || typeof scope.locator !== 'function') return [];
  const dialogs = scope.locator(EDITOR_DIALOGS);
  const dialogCount = await dialogs.count().catch(() => 0);
  if (dialogCount) {
    const page = typeof scope.page === 'function' ? scope.page() : scope;
    try { await page.keyboard?.press('Escape'); } catch {}
    for (let index = 0; index < dialogCount; index += 1) {
      const dialog = dialogs.nth(index);
      if (!await dialog.isVisible().catch(() => false)) continue;
      const cancel = dialog.locator('.backstage-dialog-bottom').getByText(/^(取消|关闭)$/, { exact: true }).filter({ visible: true });
      const cancelCount = await cancel.count().catch(() => 0);
      if (cancelCount === 1) await cancel.click({ timeout: 500 }).catch(() => {});
    }
  }

  const deadline = Date.now() + timeoutMs;
  let remaining = await blockingEditorOverlays(scope);
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
    remaining = await blockingEditorOverlays(scope);
  }
  return remaining;
}

function blockSelector(blockId) {
  // Quote an attribute value rather than assuming BLOCK_ID is numeric.
  return `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(blockId))}]`;
}

export const SITE_LIST_URL = 'https://www.leadong.com/website.html';
export const DEFAULT_SITE_LIST_TIMEOUT_MS = 30_000;
export const DEFAULT_SITE_LIST_ATTEMPTS = 2;
const PLATFORM_HOSTS = new Set(['www.leadong.com', 'website.leadong.com', 'jianzhan.leadong.com']);
const LANGUAGE_NAMES = { 0: '英语', 1: '中文（简体）', 3: '阿拉伯语', 4: '法语', 10: '日语', 11: '韩语' };
const LANGUAGE_PREFIXES = { en: 0, cn: 1, sa: 3, fr: 4, jp: 10, kr: 11 };

export function hostOf(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).host.toLowerCase(); }
  catch { return ''; }
}

export function classifyEditorEntryState({ url = '', loginVisible = false, siteCardCount = 0 } = {}) {
  if (loginVisible || /\/login(?:\.html)?(?:[?#]|$)/i.test(String(url))) return 'logged-out';
  if (/\/phoenix\/pagebuilder(?:\/|$)/i.test(String(url))) return 'editor';
  if (Number(siteCardCount) > 0) return 'site-list';
  return 'site-list-unavailable';
}

function safeLocation(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return ''; }
}

export async function isLoggedOutPage(page) {
  if (/\/login(?:\.html)?(?:[?#]|$)/i.test(page.url())) return true;
  for (const scope of [page, ...page.frames()]) {
    for (const selector of ['#loginName', 'input[type="password"]']) {
      if (await scope.locator(selector).first().isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

/** Bounded site-list polling with one generic navigation retry. */
export async function waitForSiteList(page, { timeoutMs = DEFAULT_SITE_LIST_TIMEOUT_MS,
  maxAttempts = DEFAULT_SITE_LIST_ATTEMPTS, pollMs = 250 } = {}) {
  const cards = page.locator('.mySiteBox');
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isLoggedOutPage(page)) return { status: 'logged-out', attempts: attempt + 1 };
      if (await cards.count().catch(() => 0)) return { status: 'ready', attempts: attempt + 1 };
      await page.waitForTimeout(Math.min(pollMs, Math.max(1, deadline - Date.now()))).catch(() => {});
    }
    if (attempt + 1 < maxAttempts) {
      await page.goto(SITE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
    }
  }
  return { status: await isLoggedOutPage(page) ? 'logged-out' : 'unavailable', attempts: maxAttempts };
}

function entryError(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code, environment: true });
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

export function publicBaseUrlFromCardValues(values, { targetHost = '', baseUrl = SITE_LIST_URL } = {}) {
  const candidates = [];
  for (const value of values) {
    try {
      const url = new URL(value, baseUrl);
      if (!/^https?:$/i.test(url.protocol)) continue;
      if (PLATFORM_HOSTS.has(url.hostname.toLowerCase()) || /\/phoenix\//i.test(url.pathname)) continue;
      candidates.push(url);
    } catch { /* Ignore relative links and javascript handlers. */ }
  }
  const exact = candidates.find((url) => url.host.toLowerCase() === String(targetHost).toLowerCase());
  return (exact || candidates[0])?.origin || '';
}

export async function discoverPublicBaseUrl(card, targetHost = '') {
  const urls = await card.locator('a[href], [data-url], [data-href]').evaluateAll((nodes) =>
    nodes.flatMap((node) => ['href', 'data-url', 'data-href'].map((attr) => node.getAttribute(attr)).filter(Boolean)),
  );
  return publicBaseUrlFromCardValues(urls, { targetHost });
}

export async function enterSiteFromList(page, config) {
  const cards = page.locator('.mySiteBox');
  if (await cards.count() === 0) {
    if (config.editSiteUrl) {
      console.warn('[editor] 站点列表未找到 .mySiteBox，退回备选 EDIT_SITE_URL。');
      await retryEnvironmentTimeout(() => page.goto(config.editSiteUrl, { waitUntil: 'domcontentloaded',
        timeout: Number(config.navigationTimeoutMs) || 60_000 }), { stage: 'navigation' });
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
    const publicUrl = await discoverPublicBaseUrl(card, targetHost);
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
  await retryEnvironmentTimeout(() => page.goto(SITE_LIST_URL,
    { waitUntil: 'domcontentloaded', timeout: Number(config.navigationTimeoutMs) || 60_000 }),
  { stage: 'navigation' });
  const siteList = await waitForSiteList(page, { timeoutMs: Number(config.siteListTimeoutMs) || DEFAULT_SITE_LIST_TIMEOUT_MS,
    maxAttempts: Number(config.siteListAttempts) || DEFAULT_SITE_LIST_ATTEMPTS });
  if (siteList.status === 'logged-out') {
    throw entryError('ENV_LOGIN_REQUIRED', `站点列表入口检测到登录页或登录表单（${safeLocation(page.url())}）；请运行 scripts/explore-login.mjs --force-login 刷新登录态。`);
  }
  if (siteList.status !== 'ready') {
    if (!config.editSiteUrl) {
      throw entryError('ENV_SITE_LIST_TIMEOUT', `等待站点列表卡片超时（${siteList.attempts} 次有界尝试，${safeLocation(page.url())}）；检查网络、登录态或站点列表加载状态。`);
    }
    await retryEnvironmentTimeout(() => page.goto(config.editSiteUrl,
      { waitUntil: 'domcontentloaded', timeout: Number(config.navigationTimeoutMs) || 60_000 }),
    { stage: 'navigation' });
    if (await isLoggedOutPage(page)) {
      throw entryError('ENV_LOGIN_REQUIRED', `备选编辑器入口检测到登录态失效（${safeLocation(page.url())}）；请运行 scripts/explore-login.mjs --force-login。`);
    }
  }
  let editorPage;
  try {
    editorPage = await enterSiteFromList(page, config);
  } catch (error) {
    if (!config.editSiteUrl || !String(error.message).includes('未找到 .mySiteBox')) throw error;
    console.warn('[editor] 站点列表结构变化，退回备选 EDIT_SITE_URL。');
    await retryEnvironmentTimeout(() => page.goto(config.editSiteUrl, { waitUntil: 'domcontentloaded',
      timeout: Number(config.navigationTimeoutMs) || 60_000 }), { stage: 'navigation' });
    editorPage = page;
  }
  if (!editorPage.url().includes('/phoenix/pagebuilder')) {
    if (await isLoggedOutPage(editorPage)) {
      throw entryError('ENV_LOGIN_REQUIRED', `未进入编辑器且检测到登录态失效（${safeLocation(editorPage.url())}）；请运行 scripts/explore-login.mjs --force-login。`);
    }
    throw entryError('ENV_EDITOR_ENTRY_FAILED', `未进入领动编辑器（${safeLocation(editorPage.url())}）；站点入口重试已用尽，请检查目标站权限或编辑器入口。`);
  }
  await waitForEditorReady(editorPage);
  await verifyEditorSiteIdentity(editorPage, config);
  return { page: editorPage };
}

export function resolveEditorSiteHosts({ pageUrl, frameUrls = [], domHosts = [] }, expectedHost) {
  const ignored = PLATFORM_HOSTS;
  const hosts = new Set();
  for (const value of [pageUrl, ...frameUrls, ...domHosts]) {
    const raw = String(value || '').trim();
    const host = hostOf(raw) || (/^[a-z0-9.-]+(?::\d+)?$/i.test(raw) ? hostOf(`https://${raw}`) : '');
    if (host && !ignored.has(host)) hosts.add(host);
  }
  if (!hosts.size) throw new Error(`无法确认当前编辑器对应的站点 host（目标 host: ${expectedHost}）；登录刷新后仍无可验证 host，已停止。`);
  if (!hosts.has(expectedHost)) {
    throw new Error(`编辑器站点身份不匹配：目标 host 为 ${expectedHost}，页面可识别 host 为 ${[...hosts].join(', ')}。`);
  }
  return [...hosts];
}

export async function verifyEditorSiteIdentity(page, config) {
  const expectedHost = hostOf(config.siteDomain);
  if (!expectedHost) return;
  let domHosts = [];
  try {
    domHosts = await page.evaluate(() => {
      const values = [...document.querySelectorAll('[data-site-domain], [data-domain], [pageurl]')]
        .flatMap((node) => ['data-site-domain', 'data-domain', 'pageurl'].map((key) => node.getAttribute(key)).filter(Boolean));
      return values;
    });
  } catch { /* The frame URL remains a separate identity source. */ }
  return resolveEditorSiteHosts({ pageUrl: page.url(), frameUrls: page.frames().map((frame) => frame.url()), domHosts }, expectedHost);
}

async function waitForEditorReady(page) {
  await page.waitForTimeout(5_000);
  const know = page.getByText('我知道了', { exact: true }).first();
  if (await know.isVisible()) await know.click();
  try {
    await retryEnvironmentTimeout(() => page.getByText('页面:', { exact: true }).first()
      .waitFor({ state: 'visible', timeout: Number(process.env.EDITOR_READY_TIMEOUT_MS) || 60_000 }),
    { stage: 'editor-load' });
  } catch (error) {
    throw entryError('ENV_EDITOR_LOAD_TIMEOUT', `编辑器未显示“页面:”，登录态可能已过期或编辑器未完成加载：${error.message}`);
  }
}

// CMS field changes become visible after an editor reload; no publishing.
// Without config preserve the current page; fixture preparation supplies config.
export async function reloadEditor(page, config) {
  const before = await verifyCurrentPageIdentity(page);
  const target = config?.resolvedTarget;
  const wanted = target ? target.page : before;
  if (!wanted) throw new Error('刷新编辑器前无法确定目标页。');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: Number(config?.navigationTimeoutMs) || 60_000 });
  await waitForEditorReady(page);
  await closePageMenuIfOpen(page);
  await verifyCurrentPageIdentity(page, wanted);
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
  const rawEntries = await page.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const panel = document.querySelector('.backstage-topToolbar-pageBox');
    if (!panel) return [];
    return [...panel.querySelectorAll('a')].filter((a) => {
      if (a.offsetParent === null) return false;
      const li = a.closest('li, dt, dd');
      return li && a.getAttribute('data-href');
    }).map((a) => {
      const row = a.closest('.backstage-topToolbar-list') || a.parentElement;
      const linkView = row?.querySelector('.page_linkview');
      const identity = row?.querySelector('.page_edit_btn[pk], .page_setting[pk]');
      return { name: norm(a.textContent), title: a.getAttribute('title'), pageurl: a.getAttribute('pageurl'),
        frontUrl: linkView?.getAttribute('url') || '', id: a.getAttribute('data-id') || a.getAttribute('pageid') ||
          a.id || identity?.getAttribute('pk') || '', href: a.getAttribute('data-href') };
    });
  });
  return rawEntries.map(normalizeFreshPageEntry);
}

export function normalizeFreshPageEntry(entry) {
  return { ...entry, name: String(entry.name || '').replace(/\s+/g, ' ').trim(),
    title: String(entry.title || '').trim(), id: String(entry.id || ''),
    pageurl: String(entry.pageurl || entry.frontUrl || '').trim(), href: String(entry.href || '').trim() };
}

export async function listFreshEditorPages(page, kind = 'system') {
  if (!['system', 'custom'].includes(kind)) throw new Error('Page-list kind must be system or custom.');
  await openPageMenu(page);
  await clickPageTab(page, kind);
  return listMenuPages(page);
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

// Fresh-block flow requires an explicit identity for system pages: an exact
// editor page id or URL supplied by the caller. It never falls back to a
// familiar/default page name.
export async function gotoFreshTargetPage(page, target) {
  if (target?.kind === 'custom') {
    if (!target.name) throw new Error('FRESH_PAGE_NAME is required for a custom page.');
    const config = { resolvedTarget: { page: target.name, kind: 'custom' }, blockId: target.blockId };
    const selected = await ensureTargetPage(page, config);
    await openPageMenu(page);
    await clickPageTab(page, 'custom');
    const matches = (await listMenuPages(page)).filter((item) => item.name === target.name || item.title === target.name);
    if (matches.length !== 1) throw new Error(`Fresh custom page name matched ${matches.length} menu entries; cannot report an unambiguous front URL.`);
    return { ...selected, pageItem: matches[0] };
  }
  if (target?.kind !== 'system' || !target.id || !target.url) {
    throw new Error('Fresh system page requires both FRESH_PAGE_ID and FRESH_PAGE_URL.');
  }
  await openPageMenu(page);
  await clickPageTab(page, 'system');
  const items = await listMenuPages(page);
  const matches = items.filter((item) => item.id === String(target.id) || item.pageurl === target.url || item.href === target.url);
  if (matches.length !== 1) throw new Error(`Fresh system page selector matched ${matches.length} menu entries; expected one by id/url.`);
  await page.locator(`.backstage-topToolbar-pageBox a[data-href=${JSON.stringify(matches[0].href)}]`).click();
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  const frame = page.frameLocator(CANVAS);
  await frame.locator('body').waitFor({ state: 'attached', timeout: 60_000 });
  await page.waitForTimeout(3_000);
  return { frame, created: false, pageItem: matches[0] };
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
  const inspectCanvas = () => frame.locator('body').evaluate((body, blockId) => {
    const canvas = body.querySelector('#backstage-bodyArea');
    const blocks = canvas ? [...canvas.querySelectorAll('.siteblocks-setting-wrap[data-appid]')] : [];
    const targets = blocks.flatMap((element, index) => {
      if (element.getAttribute('data-appid') !== String(blockId)) return [];
      const rect = element.getBoundingClientRect();
      const settingAttr = [...element.attributes].find((attr) => /setting.?id/i.test(attr.name));
      const nested = [...element.querySelectorAll('*')].flatMap((node) => [...node.attributes]
        .filter((attr) => /setting.?id/i.test(attr.name)).map((attr) => attr.value))[0];
      return [{ index, position: { x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height) },
        settingId: settingAttr?.value || nested || null }];
    });
    const loading = [...document.querySelectorAll('[aria-busy="true"], .backstage-loading, .loading-mask, .layui-layer-loading')]
      .some((element) => element.getClientRects().length > 0);
    const signature = blocks.map((element) => {
      const rect = element.getBoundingClientRect();
      return [element.getAttribute('data-appid'), element.childElementCount,
        (element.innerText || '').length, Math.round(rect.width), Math.round(rect.height)];
    });
    return { ready: document.readyState === 'complete', canvasReady: Boolean(canvas?.getClientRects().length),
      loading, blockCount: blocks.length, targets, signature };
  }, String(config.blockId));
  const rendered = await waitForCanvasRender(inspectCanvas, {
    timeoutMs: Number(process.env.CANVAS_RENDER_TIMEOUT_MS) || 45_000,
    stableMs: Number(process.env.CANVAS_RENDER_STABLE_MS) || 8_000,
    allowEmptyCanvas: Boolean(config.addAnotherInstance),
  });
  const countBefore = rendered.targets.length;
  const chosenBefore = selectedBlockInstance(rendered.targets);
  if (countBefore > 0 && !config.addAnotherInstance) return { added: false, countBefore, countAfter: countBefore,
    instances: rendered.targets, selectedInstance: chosenBefore };

  const addButton = frame
    .locator('#backstage-bodyArea .backstage-creatmodules-wrapper').first()
    .locator('.backstage-creatmodules-addbtn').first();
  await addButton.scrollIntoViewIfNeeded();
  await closeToolbarMenusBeforeAction(page);
  try {
    await addButton.click({ timeout: 5_000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    await addButton.click({ force: true });
  }
  const panel = page.locator(PANEL);
  await retryEnvironmentTimeout(() => panel.waitFor({ state: 'visible', timeout: Number(config.actionTimeoutMs) || 30_000 }),
    { stage: 'library-load' });

  const order = [...new Set([config.moduleType, 'develop', 'review', 'online'])];
  const attempts = [];
  for (const moduleType of order) {
    // Preserve the known-good G27 mechanics: use the configured mode first,
    // select tabs by their persisted values, and search only in the online
    // mode. The exact target appid is the only result ever inspected.
    if (moduleType === 'online') {
      const search = panel.locator('.addmodules_searchWrap input');
      await search.fill(String(config.blockId));
      await search.press('Enter');
    } else {
      const value = moduleType === 'develop' ? '-1' : '-2';
      const tab = panel.locator(`.user-handle-module[value="${value}"]`).first();
      if (!await tab.count()) { attempts.push({ moduleType, found: false, reason: '页签不存在' }); continue; }
      await tab.click();
    }

    const candidate = panel.locator(`.btn.add[appid=${JSON.stringify(String(config.blockId))}]`).first();
    try {
      // The library's add control is attached but hidden until hover.
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
    const afterRender = await waitForCanvasRender(inspectCanvas, {
      timeoutMs: Number(process.env.CANVAS_RENDER_TIMEOUT_MS) || 45_000,
      stableMs: Number(process.env.CANVAS_RENDER_STABLE_MS) || 8_000,
    });
    const countAfter = afterRender.targets.length;
    if (countAfter === 0) throw new Error(`区块 ${config.blockId} 添加后未在稳定画布中出现。`);
    const close = panel.locator('.addmodules_searchContainer > .block-iconbaseline-close').first();
    if (await close.isVisible()) await close.click();
    await panel.waitFor({ state: 'hidden' });
    return { added: true, addedVia: moduleType, countBefore, countAfter, attempts,
      instances: afterRender.targets, selectedInstance: config.addAnotherInstance
        ? { ...afterRender.targets.at(-1), order: afterRender.targets.length, total: afterRender.targets.length }
        : selectedBlockInstance(afterRender.targets) };
  }
  const error = new Error(`区块 ${config.blockId} 在模块列表中未找到（已按目标编号搜索模式：${attempts.map(({ mode, found }) => `${mode}=${found ? 'found' : 'not-found'}`).join(', ')}）。`);
  error.libraryLookup = attempts;
  throw error;
}

export async function savePage(page) {
  await closeToolbarMenusBeforeAction(page);
  const selected = await waitForUniquePageSaveControl({ readScopes: async () => {
    const frames = [page.mainFrame(), ...page.frames().filter((frame) => frame !== page.mainFrame())];
    return Promise.all(frames.map(async (frame, index) => {
      const locator = frame.locator('#saveLayout');
      const controls = await locator.evaluateAll((nodes) => nodes.map((element) => ({
        id: element.id,
        visible: Boolean(element.getClientRects().length)
          && getComputedStyle(element).visibility !== 'hidden'
          && getComputedStyle(element).display !== 'none',
      }))).catch(() => []);
      return { name: index === 0 ? 'page' : `frame-${index}`, frameUrl: frame.url(), locator, controls };
    }));
  } });
  const save = selected.locator.nth(selected.index);
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
