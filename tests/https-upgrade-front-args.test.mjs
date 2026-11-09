import test from 'node:test';
import assert from 'node:assert/strict';
import { CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS, isFrontendHost, matchesHttpsUpgradeHost } from '../src/network-https-upgrade.mjs';
import { browserLaunchOptions } from '../src/browser.mjs';

test('editor chromium launch does not disable HTTPS upgrades', () => {
  const options = browserLaunchOptions({ browser: 'chromium', headless: true });
  assert.ok(!(options.args || []).some(arg => arg.includes('HttpsUpgrades')));
});
import { readFileSync } from 'node:fs';

test('frontend hosts are excluded from forced https upgrade rules', () => {
  assert.equal(isFrontendHost('en-site79106751.ldwebsite.com'), true);
  assert.equal(matchesHttpsUpgradeHost('en-site79106751.ldwebsite.com'), false);
});

test('front-style-only launches chromium with https-upgrade features disabled', () => {
  assert.ok(CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS.some((a) => a.includes('HttpsUpgrades')));
  const source = readFileSync(new URL('../scripts/front-style-only.mjs', import.meta.url), 'utf8');
  assert.match(source, /CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS/);
  assert.match(source, /args:\s*\[\.\.\.CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS\]/);
});
