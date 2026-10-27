// Log in, persist storageState, and discover editor entries from the console
// navigation response. Read-only on the site; only EDIT_SITE_URL is updated locally.
import { firefox, chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadBrowserConfig } from "../src/config.mjs";
import { browserLaunchOptions } from "../src/browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

function proxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw) return undefined;
  const u = new URL(raw);
  return { server: `${u.protocol}//${u.host}` };
}

// Validate the live response instead of assuming the SPA payload shape.
export function navigationSites(payload) {
  const sites = payload?.data?.headerNavigation?.webSite?.webSiteList;
  if (!Array.isArray(sites)) {
    throw new Error("navigation4 响应结构不符：缺少 data.headerNavigation.webSite.webSiteList 数组。");
  }
  for (const site of sites) {
    if (!site || !Array.isArray(site.languageList)) {
      throw new Error("navigation4 响应结构不符：站点缺少 languageList 数组。");
    }
  }
  return sites;
}

export function editorUrl(site, language) {
  if (!site.comId || !language?.siteSettingId || language.lanCode == null || language.lanCode === "") {
    throw new Error("navigation4 站点语种缺少 comId、siteSettingId 或 lanCode，无法生成编辑器入口。");
  }
  const query = new URLSearchParams({
    s: language.siteSettingId, c: site.comId, d: "", l: String(language.lanCode),
  });
  return `https://www.leadong.com/phoenix/admin/user/editSite?${query}`;
}

const normalizeUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
function hostOf(value) {
  try { return new URL(value).host; } catch { return null; }
}

export function matchSiteLanguage(sites, siteDomain) {
  const domain = normalizeUrl(siteDomain);
  const host = hostOf(domain);
  if (!host) throw new Error("SITE_DOMAIN 必须是完整的站点语种地址（包含 http:// 或 https://）。");
  const exact = sites.flatMap((site) => site.languageList
    .filter((language) => normalizeUrl(language.url) === domain)
    .map((language) => ({ site, language })));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error("SITE_DOMAIN 精确匹配到多个站点或语种，请检查站点列表，未修改 .env。");

  const hostMatches = sites.filter((site) => site.languageList.some((language) => hostOf(language.url) === host));
  if (hostMatches.length === 0) {
    throw new Error("账号下没有 SITE_DOMAIN 对应的站点，请换有该站访问权限的账号");
  }
  if (hostMatches.length > 1) throw new Error("SITE_DOMAIN 的 host 匹配到多个站点，请填写精确语种地址，未修改 .env。");
  const site = hostMatches[0];
  const english = site.languageList.filter((language) => String(language.lanCode) === "0");
  if (english.length !== 1) throw new Error("SITE_DOMAIN 的 host 已匹配，但英语语种（lanCode=0）不唯一或不存在，未修改 .env。");
  return { site, language: english[0] };
}

export function writeEditorUrl(envPath, url) {
  const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const line = `EDIT_SITE_URL=${url}`;
  const pattern = /^[ \t]*(?:export[ \t]+)?EDIT_SITE_URL[ \t]*=[^\r\n]*/gm;
  const matches = [...original.matchAll(pattern)];
  if (matches.length > 1) throw new Error(".env 有多个 EDIT_SITE_URL 行，请保留一行后重试，未修改文件。");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const updated = matches.length
    ? original.replace(pattern, () => line)
    : `${original}${original && !original.endsWith("\n") ? eol : ""}${line}${eol}`;
  if (updated !== original) writeFileSync(envPath, updated, "utf8");
  return updated !== original;
}

async function findInputs(page) {
  for (const scope of [page, ...page.frames()]) {
    const placeholderUser = scope.getByPlaceholder('用户名/邮箱/手机号码', { exact: true }).first();
    const placeholderPass = scope.getByPlaceholder('密码', { exact: true }).first();
    const user = await placeholderUser.isVisible().catch(() => false) ? placeholderUser : scope.locator('#loginName').first();
    const pass = await placeholderPass.isVisible().catch(() => false) ? placeholderPass : scope.locator('#password').first();
    if (await user.isVisible().catch(() => false) && await pass.isVisible().catch(() => false)) return { user, pass, scope };
  }
  return null;
}

async function isLoginPage(page) {
  if (/login/i.test(page.url())) return true;
  for (const scope of [page, ...page.frames()]) {
    if (await scope.locator('#loginName').first().isVisible().catch(() => false)) return true;
  }
  return false;
}

export async function dismissBlockingModals(page) {
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const modals = page.locator('[role="dialog"], .el-dialog, .modal, .modal-dialog, [class*="modal"]');
      let dismissed = false;
      for (let index = 0; index < await modals.count(); index += 1) {
        if (Date.now() >= deadline) return;
        const modal = modals.nth(index);
        if (!await modal.isVisible() || !await modal.locator('video').count()) continue;
        const close = modal.locator('button[aria-label*="close" i], [aria-label*="关闭"], .el-dialog__close, .close, .modal-close, button.close').first();
        if (await close.isVisible()) await close.click({ timeout: Math.min(1000, Math.max(1, deadline - Date.now())) }).catch(() => {});
        else await page.keyboard.press('Escape').catch(() => {});
        dismissed = true;
        break;
      }
      if (!dismissed) return;
      await page.waitForTimeout(Math.min(100, Math.max(0, deadline - Date.now())));
    }
  } catch { /* Best-effort removal of landing-page video overlays. */ }
}

export async function enterCloudPlatform(page) {
  try {
    const avatar = page.locator('.wrap-login-container, .wrap-login-dropdown').first();
    if (await avatar.isVisible()) await avatar.hover({ timeout: 2000 });
    const link = page.getByRole('link', { name: /返回.*领动云平台/ }).first();
    if (await link.isVisible()) {
      await link.click({ timeout: 2000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    }
  } catch { /* Some accounts already land inside the cloud platform. */ }
}

export async function login(page, account, password) {
  let lastError;
  // One initial attempt plus two retries, each starting from the login page.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto('https://www.leadong.com/login.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      const inputs = await findInputs(page);
      if (!inputs) throw new Error('login inputs not found on page or frames');
      await inputs.user.fill(account);
      await inputs.pass.fill(password);
      await inputs.pass.press('Enter');
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      if (await isLoginPage(page)) {
        await inputs.scope.locator('#loginSubmit').first().click();
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      }
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(800);
      if (await isLoginPage(page)) throw new Error('登录后仍停留在登录页');
      await dismissBlockingModals(page);
      await enterCloudPlatform(page);
      await dismissBlockingModals(page);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await page.waitForTimeout(1000);
    }
  }
  // Playwright fill errors may include the supplied value in their call log.
  const detail = String(lastError?.message || '未知错误').split(password).join('[REDACTED]');
  throw new Error(`自动登录失败（首次尝试 + 重试 2 次）：${detail}`);
}

async function main() {
  const ACCOUNT = process.env.PLAYWRIGHT_USERNAME || "";
  const PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "";
  if (!ACCOUNT || !PASSWORD) throw new Error("missing credentials in .env");

  const browserConfig = loadBrowserConfig(process.env);
  const browser = await ({ firefox, chromium })[browserConfig.browser].launch({
    ...browserLaunchOptions(browserConfig), proxy: proxyFromEnv(),
  });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    await login(page, ACCOUNT, PASSWORD);

    mkdirSync(path.join(root, "src/fixtures"), { recursive: true, mode: 0o700 });
    mkdirSync(path.join(root, "screenshots"), { recursive: true });
    const statePath = path.join(root, "src/fixtures", `storageState-${ACCOUNT}.json`);
    await context.storageState({ path: statePath });
    chmodSync(statePath, 0o600);
    await page.screenshot({ path: path.join(root, "screenshots", "after-login.png"), fullPage: false });

    console.log("POST_LOGIN_URL:", page.url());
    console.log("TITLE:", await page.title());
    console.log("STORAGE_STATE:", statePath);

    // The SPA supplies authentication headers itself. Register before navigating;
    // a separate fetch from page.evaluate would receive 401.
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/menu/navigation4"), { timeout: 60000 }),
      page.goto("https://www.leadong.com/phoenix2/composite/middle/platform/index.html#/", {
        waitUntil: "domcontentloaded", timeout: 60000,
      }),
    ]);
    if (!response.ok()) throw new Error(`navigation4 请求失败：HTTP ${response.status()}`);
    const sites = navigationSites(await response.json());
    console.log(`SITES: ${sites.length}`);
    for (const site of sites) {
      console.log(JSON.stringify({
        name: site.name, comId: site.comId,
        languageList: site.languageList.map((language) => ({
          name: language.name, url: language.url,
          siteSettingId: language.siteSettingId, lanCode: language.lanCode,
          editSiteUrl: editorUrl(site, language),
        })),
      }));
    }
    const siteDomain = (process.env.SITE_DOMAIN || "").trim();
    if (siteDomain) {
      const { site, language } = matchSiteLanguage(sites, siteDomain);
      const url = editorUrl(site, language);
      const changed = writeEditorUrl(path.join(root, ".env"), url);
      console.log(`MATCHED_SITE: ${site.name} / ${language.name} / ${language.url}`);
      console.log(`${changed ? "已写入" : "已确认"} .env: EDIT_SITE_URL=${url}`);
    } else {
      console.log("SITE_DOMAIN 为空；未修改 .env。请从以上列表选择测试站点语种并填写：");
      console.log("SITE_DOMAIN=<站点语种 url>");
      console.log("EDIT_SITE_URL=<该语种 editSiteUrl，填写 SITE_DOMAIN 后重跑可自动写入>");
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
