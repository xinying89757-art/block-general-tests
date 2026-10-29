import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpsUpgradeEnabled, parseHttpsUpgradeHosts } from './network-https-upgrade.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');

// dotenv does not replace variables already supplied by the process, so CI or
// shell values retain precedence over the local .env file.
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function parseBoolean(value, name) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(`${name} must be true or false; received ${JSON.stringify(value)}`);
}

// Also used by the login script, which does not require BLOCK_ID.
export function loadBrowserConfig(env = process.env) {
  const browser = firstDefined(env.BROWSER, 'chromium').trim().toLowerCase();
  if (!['firefox', 'chromium'].includes(browser)) {
    throw new Error('BROWSER 仅支持 firefox 或 chromium。');
  }
  const isCI = Boolean(env.CI) && !['false', '0'].includes(String(env.CI).trim().toLowerCase());
  const headless = parseBoolean(firstDefined(env.HEADLESS, isCI || browser === 'firefox'), 'HEADLESS');
  const slowMo = Number(firstDefined(env.SLOW_MO, '0'));
  if (!Number.isSafeInteger(slowMo) || slowMo < 0) {
    throw new Error('SLOW_MO must be a non-negative integer in milliseconds.');
  }
  const hostRules = env.HTTPS_UPGRADE_HOSTS ?? '';
  return {
    browser, headless, slowMo,
    httpsUpgrade: httpsUpgradeEnabled(env.HTTPS_UPGRADE),
    httpsUpgradeHosts: String(hostRules).trim() ? parseHttpsUpgradeHosts(hostRules) : parseHttpsUpgradeHosts(),
  };
}

/**
 * Load the parameterized block test configuration.
 * Values from process.env take precedence over the project .env file.
 */
export function loadConfig() {
  const blockId = firstDefined(process.env.BLOCK_ID)?.trim();
  if (!blockId) {
    throw new Error('BLOCK_ID is required. Set BLOCK_ID in .env or process.env (for example: BLOCK_ID=40838).');
  }

  const moduleType = firstDefined(process.env.MODULE_TYPE, 'review').trim().toLowerCase();
  if (!['develop', 'review', 'online'].includes(moduleType)) {
    throw new Error(`MODULE_TYPE must be one of develop, review, online; received ${JSON.stringify(moduleType)}`);
  }
  const capabilityFilter = (firstDefined(process.env.CAPABILITY_FILTER) || '').split(',').map((id) => id.trim()).filter(Boolean);

  return {
    blockId,
    capabilityFilter: capabilityFilter.length ? capabilityFilter : null,
    profile: (firstDefined(process.env.PROFILE) || '').trim(),
    targetPage: firstDefined(process.env.TARGET_PAGE, 'products').trim(),
    // Page kind: 'system' (default) or 'custom'. The runner resolves the
    // final value from the block profile when the env var is absent; see run.mjs.
    targetPageKind: (firstDefined(process.env.TARGET_PAGE_KIND) || '').trim().toLowerCase(),
    siteDomain: firstDefined(process.env.SITE_DOMAIN, 'https://www.leadong.com').trim().replace(/\/$/, ''),
    siteName: (process.env.SITE_NAME || '').trim(),
    account: firstDefined(
      process.env.ACCOUNT,
      process.env.PLAYWRIGHT_ACCOUNT,
      process.env.PLAYWRIGHT_USERNAME,
      '',
    ).trim(),
    password: firstDefined(process.env.PASSWORD, process.env.PLAYWRIGHT_PASSWORD, ''),
    moduleType,
    ...loadBrowserConfig(),
    ignoreHTTPSErrors: parseBoolean(firstDefined(process.env.IGNORE_HTTPS_ERRORS, 'true'), 'IGNORE_HTTPS_ERRORS'),
    httpsProxy: firstDefined(process.env.HTTPS_PROXY, process.env.https_proxy, ''),
    editSiteUrl: firstDefined(process.env.EDIT_SITE_URL, process.env.PLAYWRIGHT_EDIT_SITE_URL) || '',
    storageState: firstDefined(process.env.STORAGE_STATE, ''),
    // Force one baseline application even when the block is already on the
    // page (re-apply the profile baseline to a block already in place).
    applyBaseline: parseBoolean((firstDefined(process.env.APPLY_BASELINE) || '').trim() || 'false', 'APPLY_BASELINE'),
    reportDir: firstDefined(process.env.REPORT_DIR, 'reports').trim(),
    screenshotDir: firstDefined(process.env.SCREENSHOT_DIR, 'screenshots').trim(),
  };
}
