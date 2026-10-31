import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { login, attemptStorageStateReuse, matchSiteLanguage, matchSiteListCards, readAuthCredentials } from '../scripts/explore-login.mjs';
import { SITE_LIST_URL, hostOf, matchAttachedCardIndexes, normalizeFreshPageEntry, publicBaseUrlFromCardValues } from '../src/editor.mjs';

function loginPage({ rejected = false } = {}) {
  const actions = [];
  let url = 'https://www.leadong.com/login.html';
  const field = (name) => ({
    isVisible: async () => /login\.html/.test(url),
    click: async () => actions.push(`${name}:click`),
    pressSequentially: async (value, options) => actions.push(`${name}:type:${value}:${options.delay}`),
    press: async () => actions.push(`${name}:press`),
  });
  const user = field('user');
  const pass = field('password');
  const scope = {
    getByPlaceholder: () => ({ first: () => ({ isVisible: async () => false }) }),
    locator: (selector) => {
      if (selector === '#loginName') return { first: () => user };
      if (selector === '#password') return { first: () => pass };
      if (selector === '#loginSubmit') return { first: () => ({ click: async () => {
        actions.push('submit:click');
        if (!rejected) url = 'https://www.leadong.com/phoenix2/composite/middle/platform/index.html#/';
      } }) };
      if (selector === 'body') return { innerText: async () => rejected ? '登录名或密码错误' : '' };
      return { first: () => ({ isVisible: async () => false }) };
    },
  };
  const page = {
    actions,
    url: () => url,
    frames: () => [],
    goto: async (next) => { url = next; },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    getByPlaceholder: scope.getByPlaceholder,
    locator: scope.locator,
    waitForURL: async () => { if (!rejected) url = 'https://www.leadong.com/phoenix2/composite/middle/platform/index.html#/'; },
    keyboard: { press: async () => {} },
  };
  return page;
}

test('login types each credential and clicks submit without Enter', async () => {
  const page = loginPage();
  await login(page, 'sample-user', 'sample-password');
  assert.deepEqual(page.actions.slice(0, 5), [
    'user:click', 'user:type:sample-user:50', 'password:click', 'password:type:sample-password:50', 'submit:click',
  ]);
  assert.equal(page.actions.some((action) => action.endsWith(':press')), false);
});

test('login stops after password error and redacts credentials', async () => {
  const page = loginPage({ rejected: true });
  await assert.rejects(login(page, 'private-user', 'private-password'), (error) => {
    assert.match(error.message, /登录名或密码错误/);
    assert.match(error.message, /不再重试/);
    assert.doesNotMatch(error.message, /private-user|private-password/);
    return true;
  });
  assert.equal(page.actions.filter((action) => action === 'submit:click').length, 1);
});

test('existing storage state can be reused; force-login bypasses it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'login-state-test-'));
  const state = path.join(dir, 'state.json');
  writeFileSync(state, '{}');
  try {
    let navigated = 0;
    const page = { goto: async () => { navigated += 1; }, url: () => 'https://www.leadong.com/phoenix2/composite/index.html', frames: () => [], locator: () => ({ first: () => ({ isVisible: async () => false }) }) };
    assert.equal(await attemptStorageStateReuse(page, state), true);
    assert.equal(navigated, 1);
    assert.equal(await attemptStorageStateReuse(page, state, true), false);
    assert.equal(navigated, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('navigation4 miss falls back to host matching in site-list cards', () => {
  const domain = 'http://en-site79106751.ldwebsite.com';
  assert.throws(() => matchSiteLanguage([], domain), /账号下没有 SITE_DOMAIN/);
  assert.deepEqual(matchSiteListCards([
    { host: 'other.ldwebsite.com', name: 'other' },
    { host: 'en-site79106751.ldwebsite.com', name: '目标站' },
  ], domain), { host: 'en-site79106751.ldwebsite.com', name: '目标站' });
  assert.equal(matchSiteListCards([], domain), null);
});

test('editor enters through the www site-list; attached offscreen cards remain eligible', () => {
  assert.equal(SITE_LIST_URL, 'https://www.leadong.com/website.html');
  assert.deepEqual(matchAttachedCardIndexes(['elsewhere.test', 'target.test'], 'target.test'), [1]);
  assert.equal(hostOf('en-site79106751.ldwebsite.com'), 'en-site79106751.ldwebsite.com');
  assert.equal(hostOf('http://en-site79106751.ldwebsite.com'), 'en-site79106751.ldwebsite.com');
});

test('site-card host discovery handles relative references and prefers the exact target host', () => {
  assert.equal(publicBaseUrlFromCardValues([
    '/phoenix/pagebuilder/editor',
    'https://www.leadong.com/website.html',
    '//target.example/products',
    'https://other.example/',
  ], { targetHost: 'target.example' }), 'https://target.example');
  assert.equal(publicBaseUrlFromCardValues(['javascript:openEditor()', null]), '');
});

test('system page menu entries use sibling page id and public link metadata', () => {
  assert.deepEqual(normalizeFreshPageEntry({ name: ' Products ', title: null, id: 'page-id', pageurl: '',
    frontUrl: '/products.html', href: '/phoenix/pagebuilder/page-id' }), {
    name: 'Products', title: '', id: 'page-id', pageurl: '/products.html', frontUrl: '/products.html',
    href: '/phoenix/pagebuilder/page-id',
  });
});

test('auth-file loader accepts the private account/password shape without exposing values', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'login-auth-file-'));
  const file = path.join(dir, 'auth.json');
  writeFileSync(file, JSON.stringify({ account: 'unit-account', password: 'unit-password' }));
  try { assert.deepEqual(readAuthCredentials(file), { account: 'unit-account', password: 'unit-password' }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
