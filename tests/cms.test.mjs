import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { exactProductId } from '../src/cms.mjs';

test('exact CMS product lookup returns only an exact visible-row match', () => {
  const rows = [
    { productName: 'AUTOTEST-产品A', productId: 'id-a' },
    { productName: 'AUTOTEST-产品A-备份', productId: 'id-b' },
  ];
  assert.equal(exactProductId(rows, 'AUTOTEST-产品A'), 'id-a');
  assert.equal(exactProductId(rows, 'AUTOTEST-不存在'), null);
});

test('exact CMS product lookup rejects duplicate names', () => {
  assert.throws(() => exactProductId([
    { productName: 'AUTOTEST-产品A', productId: 'id-a' },
    { productName: 'AUTOTEST-产品A', productId: 'id-b' },
  ], 'AUTOTEST-产品A'), /不唯一/);
});

test('product custom text field is resolved by its own title, written and read back', async () => {
  const { chromium } = await import('playwright-core');
  const { productFields } = await import('../src/cms.mjs');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<table><tr><th>AUTOTEST-文本字段</th><td><input type="text" name="txt_42"></td></tr><tr><th>其他</th><td><input type="text" value="keep"></td></tr></table>');
    const value = await page.evaluate(productFields, { names: ['AUTOTEST-文本字段'], values: { 'AUTOTEST-文本字段': '文本字段-A' } });
    assert.equal(value['AUTOTEST-文本字段'], '文本字段-A');
    assert.equal(await page.locator('input').nth(1).inputValue(), 'keep');
    assert.equal((await page.evaluate(productFields, { names: ['AUTOTEST-文本字段'] }))['AUTOTEST-文本字段'], '文本字段-A');
  } finally { await browser.close(); }
});

const prodSpaUrls = ['/prod', '/prod/', '/phoenix/website', '/phoenix/website/']
  .map((pathname) => `https://website.leadong.com${pathname}`);

function mockCmsEntry({ popup = false, entryCount = 1, loggedOut = false, siteMatches = true, timeout = false,
  cmsUrl = prodSpaUrls[0], passwordCount = 0, missingProdList = false } = {}) {
  const events = [];
  const pages = [];
  const prodList = { filter: () => ({ first: () => ({ waitFor: async () => {
    if (missingProdList) throw new Error('missing prod_list');
  } }) }) };
  const cmsPage = {
    url: () => cmsUrl, isClosed: () => false,
    locator: (selector) => selector.includes('password') ? { count: async () => passwordCount } : prodList,
    close: async () => { events.push('close-cms'); },
  };
  const entry = { filter: () => entry, count: async () => entryCount, click: async () => {
    events.push('click-content');
    if (!timeout) { if (popup) pages.push(cmsPage); else currentUrl = cmsPage.url(); }
  } };
  const card = {
    locator: (selector) => selector.startsWith('a[href]')
      ? { evaluateAll: async () => [siteMatches ? 'https://example.test/' : 'https://other.test/'] }
      : { count: async () => 0 },
    scrollIntoViewIfNeeded: async () => {}, getByText: () => entry,
  };
  let currentUrl = 'about:blank';
  const page = {
    goto: async (url) => { events.push(`goto:${url}`); currentUrl = loggedOut ? 'https://www.leadong.com/login.html' : url; },
    url: () => currentUrl, frames: () => [], isClosed: () => false,
    locator: (selector) => {
      if (selector === '.mySiteBox') return { count: async () => 1, nth: () => card };
      if (selector.includes('password') && currentUrl === cmsUrl) return { count: async () => passwordCount };
      if (selector.includes('prod_list')) return prodList;
      return { first: () => ({ isVisible: async () => false }) };
    },
    waitForTimeout: async () => {}, close: async () => { events.push('close-entry'); },
  };
  const context = { newPage: async () => { pages.push(page); return page; }, pages: () => pages };
  return { context, events, page, cmsPage };
}

test('CMS entry accepts both SPA paths and trailing slashes via same-tab and popup navigation', async (t) => {
  const { openProdPage } = await import('../src/cms.mjs');
  for (const cmsUrl of prodSpaUrls) {
    for (const popup of [false, true]) {
      await t.test(`${new URL(cmsUrl).pathname} ${popup ? 'popup' : 'same-tab'}`, async () => {
        const mock = mockCmsEntry({ popup, cmsUrl });
        const result = await openProdPage(mock.context, { siteDomain: 'https://example.test' });
        assert.equal(result, popup ? mock.cmsPage : mock.page);
        assert.deepEqual(mock.events.slice(0, 2), ['goto:https://www.leadong.com/website.html', 'click-content']);
        assert.equal(mock.events.filter((event) => event.startsWith('goto:')).length, 1);
        assert.equal(mock.events.includes('close-entry'), popup);
      });
    }
  }
});

test('CMS follow-on product lookup accepts both SPA paths before and after the unchanged /prod action navigation', async (t) => {
  const { findProduct } = await import('../src/cms.mjs');
  for (const cmsUrl of prodSpaUrls) {
    await t.test(new URL(cmsUrl).pathname, async () => {
      const mock = mockCmsEntry({ cmsUrl });
      const navigations = [];
      const page = mock.cmsPage;
      page.goto = async (url, options) => { navigations.push({ url, options }); };
      page.waitForTimeout = async () => {};
      page.evaluate = async () => [{ productName: 'AUTOTEST-lookup', productId: 'id-exact' }];
      assert.equal(await findProduct(page, 'AUTOTEST-lookup'), 'id-exact');
      assert.deepEqual(navigations, [{
        url: 'https://website.leadong.com/prod?invokeAction=prod_list_sub',
        options: { waitUntil: 'load', timeout: 60_000 },
      }]);
    });
  }
});

test('CMS SPA assertions still reject password forms and missing product controls on either path', async () => {
  const { openProdPage } = await import('../src/cms.mjs');
  for (const cmsUrl of prodSpaUrls) {
    for (const [options, expected] of [[{ passwordCount: 1 }, /登录态\/SSO 不可用/], [{ missingProdList: true }, /未看到产品管理入口 prod_list/]]) {
      const mock = mockCmsEntry({ popup: true, cmsUrl, ...options });
      await assert.rejects(openProdPage(mock.context, { siteDomain: 'https://example.test' }), expected);
      assert.ok(mock.events.includes('close-cms'));
      assert.ok(mock.events.includes('close-entry'));
    }
  }
});

test('CMS entry refuses expired login, wrong site and ambiguous controls and closes its page', async () => {
  const { openProdPage } = await import('../src/cms.mjs');
  for (const [options, expected] of [[{ loggedOut: true }, /登录态/], [{ siteMatches: false }, /匹配到 0/], [{ entryCount: 2 }, /应唯一/]]) {
    const mock = mockCmsEntry(options);
    await assert.rejects(openProdPage(mock.context, { siteDomain: 'https://example.test' }), expected);
    assert.ok(mock.events.includes('close-entry'));
    assert.ok(!mock.events.includes('click-content'));
  }
});

test('CMS entry times out with diagnostics and follow-on checks reject URLs outside the two SPA paths', async (t) => {
  const { openProdPage, findProduct } = await import('../src/cms.mjs');
  for (const cmsUrl of [
    'https://website.leadong.com/',
    'https://website.leadong.com/phoenix/website/other',
    'https://website.leadong.com/phoenix/websites',
    'https://website.leadong.com/prod/doUpdate',
    'https://website.leadong.com/prod/group/doAdd',
    'https://website.leadong.com/prod//',
    'http://website.leadong.com/prod',
    'https://other.example.test/phoenix/website',
    'about:blank',
    'invalid-url',
  ]) {
    await t.test(cmsUrl, async (subtest) => {
      const mock = mockCmsEntry({ popup: true, cmsUrl });
      await assert.rejects(findProduct(mock.cmsPage, 'AUTOTEST-lookup'), /登录态\/SSO 不可用/);
      const screenshots = [];
      for (const page of [mock.page, mock.cmsPage]) {
        page.screenshot = async ({ path: file }) => { screenshots.push(file); };
      }
      let polls = 0;
      let now = Date.now();
      subtest.mock.method(Date, 'now', () => now);
      mock.page.waitForTimeout = async () => { polls++; now += 10; };
      const logs = [];
      const originalError = console.error;
      console.error = (...args) => logs.push(args.join(' '));
      try {
        await assert.rejects(openProdPage(mock.context, { siteDomain: 'https://example.test' }, { timeoutMs: 10 }), /点击内容管理后未进入产品管理 SPA/);
        assert.ok(polls > 0);
        assert.match(logs.join('\n'), /CMS entry timeout pages:.*page-1 \(entry\):.*page-2 \(other\):/);
        assert.equal(screenshots.length, 2);
        assert.equal(path.basename(path.dirname(path.dirname(screenshots[0]))), 'cms-entry-timeout');
        assert.ok(mock.events.includes('close-cms'));
        assert.ok(mock.events.includes('close-entry'));
      } finally {
        console.error = originalError;
        if (screenshots.length) await rm(path.dirname(screenshots[0]), { recursive: true, force: true });
      }
    });
  }
});


test('CMS entry timeout records sanitized open page URLs and requests screenshots even if one fails', async () => {
  const { openProdPage } = await import('../src/cms.mjs');
  const mock = mockCmsEntry({ timeout: true });
  const screenshots = [];
  mock.page.url = () => 'https://user:password@entry.example.test/list?token=secret#private';
  // Keep site-list readiness intact until after the click.
  const originalUrl = mock.page.url;
  mock.page.url = () => mock.events.includes('click-content') ? originalUrl() : 'https://www.leadong.com/website.html';
  mock.page.screenshot = async ({ path: file }) => { screenshots.push(file); throw new Error('secret screenshot error'); };
  const other = {
    url: () => 'http://other.example.test/landing?key=secret#private', isClosed: () => false,
    screenshot: async ({ path: file }) => { screenshots.push(file); }, close: async () => {},
  };
  const closed = { isClosed: () => true, url: () => 'https://closed.example.test/', close: async () => {} };
  const originalPages = mock.context.pages;
  mock.context.pages = () => [...originalPages(), other, closed];
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await assert.rejects(openProdPage(mock.context, { siteDomain: 'https://example.test' }, { timeoutMs: 0 }), (error) => {
      assert.match(error.message, /page-1 \(entry\): https:\/\/entry\.example\.test\/list/);
      assert.match(error.message, /page-2 \(other\): http:\/\/other\.example\.test\/landing/);
      assert.doesNotMatch(error.message, /secret|password|private|closed/);
      return true;
    });
    const output = logs.join('\n');
    assert.match(output, /https:\/\/entry\.example\.test\/list/);
    assert.match(output, /http:\/\/other\.example\.test\/landing/);
    assert.match(output, /screenshot failed for page-1/);
    assert.doesNotMatch(output, /secret|password|private|closed/);
    assert.equal(screenshots.length, 2);
    assert.equal(path.basename(screenshots[0]), 'page-1.png');
    assert.equal(path.basename(screenshots[1]), 'page-2.png');
    assert.ok(path.isAbsolute(path.dirname(screenshots[0])));
    assert.ok(output.includes(path.dirname(screenshots[0])));
  } finally {
    console.error = originalError;
    if (screenshots.length) await rm(path.dirname(screenshots[0]), { recursive: true, force: true });
  }
});
