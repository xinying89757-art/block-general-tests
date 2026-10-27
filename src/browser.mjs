import { firefox, chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { loadBrowserConfig } from './config.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function browserLaunchOptions(config) {
  const { browser, headless, slowMo } = loadBrowserConfig({
    BROWSER: config.browser, HEADLESS: config.headless, SLOW_MO: config.slowMo, CI: process.env.CI,
  });
  return { headless, slowMo, ...(browser === 'chromium' ? { channel: 'chrome' } : {}) };
}

export async function launchSession(config) {
  const browserName = config.browser || 'chromium';
  if (!['firefox', 'chromium'].includes(browserName)) {
    throw new Error('BROWSER 仅支持 firefox 或 chromium。');
  }

  let proxy;
  if (config.httpsProxy) {
    const url = new URL(config.httpsProxy);
    proxy = { server: `${url.protocol}//${url.host}` };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
  }

  const storageState = config.storageState
    ? path.resolve(projectRoot, config.storageState)
    : path.join(projectRoot, 'src/fixtures', `storageState-${config.account}.json`);
  await access(storageState).catch(() => {
    throw new Error('登录态文件不可读，请配置 STORAGE_STATE 或准备账号对应的 src/fixtures/storageState-<account>.json。');
  });

  const browser = await ({ firefox, chromium })[browserName].launch({ ...browserLaunchOptions(config), proxy });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: config.ignoreHTTPSErrors,
      storageState,
      viewport: { width: 1600, height: 1000 },
    });
    context.setDefaultTimeout(30_000);
    context.setDefaultNavigationTimeout(60_000);
    const page = await context.newPage();
    return { browser, context, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
