import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrowserName, loadBrowserConfig } from '../src/config.mjs';

test('系统 BROWSER 为打开器路径时忽略，回落 chromium', () => {
  assert.equal(resolveBrowserName({ BROWSER: '/usr/local/bin/box-chrome' }), 'chromium');
  assert.equal(loadBrowserConfig({ BROWSER: '/usr/local/bin/box-chrome' }).browser, 'chromium');
});

test('BGT_BROWSER 优先于 BROWSER', () => {
  assert.equal(resolveBrowserName({ BGT_BROWSER: 'firefox', BROWSER: '/usr/local/bin/box-chrome' }), 'firefox');
  assert.equal(resolveBrowserName({ BGT_BROWSER: 'chromium', BROWSER: 'firefox' }), 'chromium');
  assert.throws(() => resolveBrowserName({ BGT_BROWSER: 'webkit' }));
});

test('BROWSER 写 firefox/chromium 仍生效，写其他浏览器名仍报错', () => {
  assert.equal(resolveBrowserName({ BROWSER: 'Firefox' }), 'firefox');
  assert.equal(resolveBrowserName({}), 'chromium');
  assert.throws(() => resolveBrowserName({ BROWSER: 'webkit' }));
});
