/** Offline provider, preview lifecycle and deferral/restoration regression tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FRONT_PROVIDERS, FrontProviderPublishedError, selectFrontProvider, detectPreviewAvailable } from '../src/front-provider.mjs';
import { openPreview } from '../src/editor.mjs';
import { effectCheck, withEffectPreview } from '../src/capabilities/effect-checks.mjs';
import { persistControl } from '../src/capabilities/shared.mjs';

function environment(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function previewMock(urls = []) {
  const tab = new EventEmitter();
  let closed = false;
  tab.frames = () => urls.map((url) => ({ url: () => url }));
  tab.isClosed = () => closed;
  tab.close = async () => { closed = true; };
  const calls = [];
  const context = { waitForEvent: async (event, options) => {
    calls.push({ event, timeout: options.timeout });
    return tab;
  } };
  const page = { locator: (selector) => ({ click: async (options) => {
    calls.push({ selector, timeout: options.timeout });
  } }) };
  return { tab, context, page, calls };
}

test('provider defaults, explicit values, auto before detection and invalid fallback', (t) => {
  assert.ok(Object.isFrozen(FRONT_PROVIDERS));
  assert.equal(selectFrontProvider({}).provider, 'preview');
  assert.equal(selectFrontProvider({ FRONT_PROVIDER: 'preview' }).provider, 'preview');
  assert.equal(selectFrontProvider({ FRONT_PROVIDER: 'published' }).provider, 'published');
  assert.deepEqual(selectFrontProvider({ FRONT_PROVIDER: 'auto' }), {
    provider: 'preview', mode: 'auto', needsDetection: true,
  });
  for (const value of ['', 'invalid']) {
    assert.equal(selectFrontProvider({ FRONT_PROVIDER: value }).provider, 'preview');
  }
  environment(t, 'FRONT_PROVIDER', 'published');
  assert.equal(selectFrontProvider().provider, 'published');
  assert.equal(selectFrontProvider({}).provider, 'preview');
});

test('published error has a stable name/code and supports custom messages', () => {
  const error = new FrontProviderPublishedError();
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'FrontProviderPublishedError');
  assert.equal(error.code, 'FRONT_PROVIDER_PUBLISHED');
  assert.match(error.message, /延期到 Mac/);
  assert.equal(new FrontProviderPublishedError('custom').message, 'custom');
});

test('probe timeout returns unavailable, closes the preview and updates auto', async () => {
  const { page, context, tab, calls } = previewMock(['about:blank']);
  const result = await detectPreviewAvailable(page, context, { timeoutMs: 10 });
  assert.equal(result.available, false);
  assert.match(result.reason, /10ms/);
  assert.equal(tab.isClosed(), true);
  assert.equal(tab.listenerCount('framenavigated'), 0);
  assert.deepEqual(calls, [
    { event: 'page', timeout: 10 }, { selector: '.clickToPreview', timeout: 10 },
  ]);
  assert.equal(selectFrontProvider({ FRONT_PROVIDER: 'auto' }).provider, 'published');
  assert.equal(selectFrontProvider({ FRONT_PROVIDER: 'preview' }).provider, 'preview');
});

test('probe finds an existing content frame, uses a 10s default and closes on success', async () => {
  const { page, context, tab, calls } = previewMock(['about:blank', 'http://site.preview.leadong.com/products.html']);
  assert.equal((await detectPreviewAvailable(page, context)).available, true);
  assert.equal(calls[0].timeout, 10_000);
  assert.equal(tab.isClosed(), true);
  assert.equal(tab.listenerCount('framenavigated'), 0);
  assert.equal(selectFrontProvider({ FRONT_PROVIDER: 'auto' }).provider, 'preview');
  assert.equal(selectFrontProvider({ FRONT_PROVIDER: 'published' }).provider, 'published');
});

test('probe observes navigation after opening the tab', async () => {
  const { page, context, tab } = previewMock();
  page.locator = () => ({ click: async () => {
    setImmediate(() => tab.emit('framenavigated', { url: () => 'https://site.preview.leadong.com/' }));
  } });
  assert.equal((await detectPreviewAvailable(page, context, { timeoutMs: 100 })).available, true);
  assert.equal(tab.isClosed(), true);
});

test('probe rejects hostname lookalikes and invalid frame URLs', async () => {
  const { page, context, tab } = previewMock([
    'invalid', 'https://site.preview.leadong.com.evil.example/',
    'https://example.com/?frame=site.preview.leadong.com',
  ]);
  assert.equal((await detectPreviewAvailable(page, context, { timeoutMs: 10 })).available, false);
  assert.equal(tab.isClosed(), true);
});

test('popup failure returns unavailable without exposing browser errors', async () => {
  const { page, context } = previewMock();
  context.waitForEvent = async () => { throw new Error('secret-token'); };
  const result = await detectPreviewAvailable(page, context, { timeoutMs: 10 });
  assert.equal(result.available, false);
  assert.doesNotMatch(result.reason, /secret-token/);
});

test('one deadline also bounds a stalled click and closes its opened preview', async () => {
  const { page, context, tab } = previewMock(['https://site.preview.leadong.com/']);
  page.locator = () => ({ click: () => new Promise(() => {}) });
  const result = await detectPreviewAvailable(page, context, { timeoutMs: 10 });
  assert.equal(result.available, false);
  assert.equal(tab.isClosed(), true);
});

test('a preview that arrives after the deadline is closed', async () => {
  const { page, context, tab } = previewMock();
  let deliver;
  context.waitForEvent = () => new Promise((resolve) => { deliver = resolve; });
  assert.equal((await detectPreviewAvailable(page, context, { timeoutMs: 10 })).available, false);
  deliver(tab);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tab.isClosed(), true);
  assert.equal(tab.listenerCount('framenavigated'), 0);
});

test('published openPreview and shared preview wrapper reject before any browser operation', async (t) => {
  environment(t, 'FRONT_PROVIDER', 'published');
  const untouched = new Proxy({}, { get: () => assert.fail('unexpected browser operation') });
  for (const open of [openPreview, withEffectPreview]) {
    await assert.rejects(open(untouched, untouched), (error) => error.code === 'FRONT_PROVIDER_PUBLISHED');
  }
});

const result = (id, status, detail, evidence) => ({ id, status, detail, evidence });
test('published front effects defer before entering a transaction', async (t) => {
  environment(t, 'FRONT_PROVIDER', 'published');
  const check = await effectCheck({ id: 'front', layer: 'front', result,
    run: () => assert.fail('must not mutate settings') });
  assert.equal(check.status, 'deferred');
});

test('published does not defer backend checks or hide unrelated failures', async (t) => {
  environment(t, 'FRONT_PROVIDER', 'published');
  const check = await effectCheck({ id: 'backend', layer: 'backend', config: {}, result,
    session: { cancel: async () => {} },
    run: async () => { throw new Error('actual backend failure'); } });
  assert.equal(check.status, 'fail');
  assert.equal(check.evidence.error, 'actual backend failure');
});

test('deferred effects still execute restoration and preserve actual restoration failures', async (t) => {
  environment(t, 'FRONT_PROVIDER', 'preview');
  environment(t, 'UI_STABLE_MS', '1');
  for (const restoreFails of [false, true]) {
    let restored = false;
    const check = await effectCheck({ id: 'effect', layer: 'front', context: {}, config: {}, result,
      session: { cancel: async () => {}, open: async () => {} },
      run: async (tx) => {
        tx.remember('original', async () => {
          restored = true;
          if (restoreFails) throw new Error('restore failed');
        });
        // No settings write is needed for this mocked custom restore.
        throw new FrontProviderPublishedError();
      },
      page: savePageMock(),
    });
    assert.equal(restored, true);
    assert.equal(check.status, restoreFails ? 'fail' : 'deferred');
  }
});

function savePageMock() {
  const page = new EventEmitter();
  const frame = { url: () => 'https://editor.example/',
    evaluate: async () => ({ ready: true }),
    locator: () => ({ evaluateAll: async () => [{ id: 'saveLayout', visible: true }],
      nth: () => ({ evaluate: async () => {} }) }),
  };
  page.mainFrame = () => frame;
  page.frames = () => [frame];
  return page;
}

test('persistControl defers only the preview, restores original values and keeps restore failures', async (t) => {
  environment(t, 'UI_STABLE_MS', '1');
  for (const restoreFails of [false, true]) {
    const target = { index: 0, type: 'checkbox', label: '字段', checked: false };
    let checked = false, attemptedRestore = false;
    const session = { open: async () => {}, cancel: async () => {}, save: async () => {},
      read: async () => [{ ...target, checked }],
      set: async (_, value) => {
        if (!value) {
          attemptedRestore = true;
          if (restoreFails) throw new Error('restore failed');
        }
        checked = value;
      },
    };
    const check = await persistControl({ session, page: savePageMock(), target, alternate: true,
      afterSwitch: async () => { throw new FrontProviderPublishedError(); } });
    assert.equal(attemptedRestore, true);
    assert.equal(check.status, restoreFails ? 'fail' : 'deferred');
    if (!restoreFails) assert.equal(checked, false);
  }
});
