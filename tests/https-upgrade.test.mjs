import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installHttpsUpgrade, matchesHttpsUpgradeHost, parseHttpsUpgradeHosts,
  rewriteUpgradeLocation, httpsUpgradeEnabled, upgradeHttpUrl,
} from '../src/network-https-upgrade.mjs';
import { loadBrowserConfig } from '../src/config.mjs';
import { prepareContext } from '../src/browser.mjs';

test('parses exact and wildcard host rules', () => {
  assert.deepEqual(parseHttpsUpgradeHosts(' example.com, *.preview.example.com,example.com '), [
    'example.com', '*.preview.example.com',
  ]);
  assert.deepEqual(parseHttpsUpgradeHosts(), [
    'website.leadong.com', 'www.leadong.com', '*.preview.leadong.com', '*.leadongcdn.com',
  ]);
  assert.throws(() => parseHttpsUpgradeHosts('https://example.com/path'), /host names/);
});

test('matches wildcard subdomains but not the suffix apex', () => {
  const rules = parseHttpsUpgradeHosts('*.preview.leadong.com');
  assert.equal(matchesHttpsUpgradeHost('a.preview.leadong.com', rules), true);
  assert.equal(matchesHttpsUpgradeHost('preview.leadong.com', rules), false);
  assert.equal(matchesHttpsUpgradeHost('a.other.com', rules), false);
});

test('frontend domains are never upgraded, even if explicitly configured', () => {
  const rules = parseHttpsUpgradeHosts('*.ldwebsite.com,ldyjz.com,*.ldmfyh.com');
  for (const host of ['en.ldwebsite.com', 'ldyjz.com', 'store.ldmfyh.com']) {
    assert.equal(matchesHttpsUpgradeHost(host, rules), false);
    assert.equal(upgradeHttpUrl(`http://${host}/products.html`, rules), `http://${host}/products.html`);
  }
});

test('HTTPS_UPGRADE=0 disables the feature', () => {
  assert.equal(httpsUpgradeEnabled('0'), false);
  assert.equal(loadBrowserConfig({ HTTPS_UPGRADE: '0' }).httpsUpgrade, false);
  assert.equal(httpsUpgradeEnabled('off'), false);
  assert.equal(httpsUpgradeEnabled(undefined), true);
});

test('disabled configuration does not install a context route', async () => {
  let installed = false;
  await prepareContext({ route: async () => { installed = true; } }, { httpsUpgrade: false });
  assert.equal(installed, false);
});

test('rewrites matching HTTP Location headers to HTTPS', () => {
  const headers = rewriteUpgradeLocation({
    location: 'http://x.preview.leadong.com/products.html?a=1',
    'content-type': 'text/html',
  });
  assert.equal(headers.location, 'https://x.preview.leadong.com/products.html?a=1');
  assert.equal(headers['content-type'], 'text/html');
  assert.equal(rewriteUpgradeLocation({ Location: 'http://store.ldyjz.com/' }).Location, 'http://store.ldyjz.com/');
  assert.equal(rewriteUpgradeLocation({ location: 'http://other.example/login' }).location, 'http://other.example/login');
  assert.equal(rewriteUpgradeLocation({ location: '/login' }).location, '/login');
});

test('context route upgrades matching requests and leaves other hosts alone', async () => {
  let predicate;
  let handler;
  const calls = [];
  const response = {
    headers: () => ({ location: 'http://x.preview.leadong.com/final' }),
    status: () => 302,
    body: async () => Buffer.from('redirect'),
    dispose: async () => {},
  };
  const context = {
    route: async (match, callback) => { predicate = match; handler = callback; },
    request: { fetch: async (url, options) => { calls.push({ url, options }); return response; } },
  };
  await installHttpsUpgrade(context);
  assert.equal(predicate(new URL('http://website.leadong.com/phoenix/pagebuilder/preview')), true);
  assert.equal(predicate(new URL('https://website.leadong.com/prod')), true);
  assert.equal(predicate(new URL('http://store.ldyjz.com/products.html')), false);
  assert.equal(predicate(new URL('https://store.ldyjz.com/products.html')), false);
  assert.equal(predicate(new URL('http://unrelated.example/products.html')), false);

  let fulfilled;
  const route = {
    request: () => ({
      url: () => 'http://website.leadong.com/phoenix/pagebuilder/preview',
      method: () => 'GET', allHeaders: async () => ({ accept: 'text/html' }),
      postDataBuffer: () => null,
    }),
    fulfill: async options => { fulfilled = options; },
  };
  await handler(route);
  assert.equal(calls[0].url, 'https://website.leadong.com/phoenix/pagebuilder/preview');
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(fulfilled.headers.location, 'https://x.preview.leadong.com/final');
  assert.equal(fulfilled.status, 302);
});

test('rewrites a downgrade Location on the original HTTPS response before the browser follows it', async () => {
  let handler;
  let fetched;
  let fulfilled;
  let disposed = false;
  const context = {
    route: async (_match, callback) => { handler = callback; },
    request: { fetch: async (url, options) => {
      fetched = { url, options };
      return {
        headers: () => ({ location: 'http://website.leadong.com/login', 'content-type': 'text/html' }),
        status: () => 302, body: async () => Buffer.from('redirect'),
        dispose: async () => { disposed = true; },
      };
    } },
  };
  await installHttpsUpgrade(context);
  await handler({
    request: () => ({ url: () => 'https://website.leadong.com/prod', method: () => 'GET',
      allHeaders: async () => ({ cookie: 'session=value' }), postDataBuffer: () => null }),
    fulfill: async options => { fulfilled = options; },
  });
  assert.equal(fetched.url, 'https://website.leadong.com/prod');
  assert.equal(fetched.options.maxRedirects, 0);
  assert.equal(fetched.options.headers.cookie, 'session=value');
  assert.equal(fulfilled.status, 302);
  assert.equal(fulfilled.headers.location, 'https://website.leadong.com/login');
  assert.equal(fulfilled.body.toString(), 'redirect');
  assert.equal(disposed, true);
});

test('aborts a downgrade loop from an HTTPS request', async () => {
  let handler;
  let aborted;
  const context = {
    route: async (_match, callback) => { handler = callback; },
    request: { fetch: async () => ({ headers: () => ({ location: 'http://website.leadong.com/login' }),
      status: () => 302, dispose: async () => {} }) },
  };
  await installHttpsUpgrade(context);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await handler({ request: () => ({ url: () => 'https://website.leadong.com/login', method: () => 'GET',
      allHeaders: async () => ({}), postDataBuffer: () => null }),
    fulfill: async () => assert.fail('loop response must not be fulfilled'),
    abort: async reason => { aborted = reason; } });
  } finally { console.warn = originalWarn; }
  assert.equal(aborted, 'failed');
});

test('aborts (does not crash) on an HTTPS-to-HTTP redirect loop and warns with a recognizable code', async () => {
  let handler;
  const source = 'http://website.leadong.com/phoenix/pagebuilder/preview';
  const response = {
    headers: () => ({ location: source }), status: () => 302,
    body: async () => Buffer.alloc(0), dispose: async () => {},
  };
  const context = {
    route: async (_match, callback) => { handler = callback; },
    request: { fetch: async () => response },
  };
  await installHttpsUpgrade(context);
  const route = { request: () => ({ url: () => source, method: () => 'GET', allHeaders: async () => ({}), postDataBuffer: () => null }),
    fulfill: async () => assert.fail('loop response must not be fulfilled'),
    abort: async (reason) => { aborted = reason; } };
  let aborted;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try { await handler(route); } finally { console.warn = originalWarn; }
  assert.equal(aborted, 'failed');
  assert.ok(warnings.some((message) => message.includes('HTTPS upgrade downgrade loop')));
  assert.ok(warnings.some((message) => message.includes('HTTPS_UPGRADE_DOWNGRADE_LOOP') && message.includes('Pingora')));
});
