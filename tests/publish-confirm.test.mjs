import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPublishSignal, verifyFrontInstance, cacheBustedUrl, frontHasInstance,
  publishStageDiagnostics } from '../src/publish-confirm.mjs';
import { applyExternalFrontVerification } from '../src/external-front-verification.mjs';

const fakeClock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };

test('publish signal: success toast confirms', async () => {
  let n = 0; const c = fakeClock();
  const r = await waitForPublishSignal({ readTexts: async () => (++n > 2 ? ['页面 发布成功'] : ['发布中']), ...c });
  assert.equal(r.status, 'confirmed');
});
test('publish signal: failure wins and no signal times out (click alone is not success)', async () => {
  assert.equal((await waitForPublishSignal({ readTexts: async () => ['发布失败，请重试'], ...fakeClock() })).status, 'failed');
  assert.equal((await waitForPublishSignal({ readTexts: async () => [], timeoutMs: 2000, ...fakeClock() })).status, 'no-signal');
});
test('cacheBustedUrl keeps scheme and sets t', () => {
  assert.equal(cacheBustedUrl('http://a.example/p.html', 5), 'http://a.example/p.html?t=5');
  assert.equal(cacheBustedUrl('http://a.example/p.html?x=1&t=1', 7), 'http://a.example/p.html?x=1&t=7');
});
test('frontHasInstance needs exact block number and settingId', () => {
  const html = '<div class="siteblocks-setting-wrap" data-appid="111" data-settingid="AbC"></div>';
  assert.deepEqual(frontHasInstance(html, { blockId: '111', settingId: 'AbC' }), { hasBlock: true, hasSetting: true });
  assert.deepEqual(frontHasInstance(html, { blockId: '11', settingId: 'Zz' }), { hasBlock: false, hasSetting: false });
});
test('verifyFrontInstance: absent after retries, present when it appears, unreachable on errors', async () => {
  const other = '<div data-appid="222"></div>'; const mine = '<div data-appid="111" data-settingid="AbC"></div>';
  const seen = [];
  const absent = await verifyFrontInstance({ fetchText: async (u) => { seen.push(u); return { status: 200, text: other }; }, url: 'http://a.example/p.html', blockId: '111', settingId: 'AbC', attempts: 3, ...fakeClock() });
  assert.equal(absent.status, 'absent'); assert.equal(absent.tries.length, 3); assert.ok(seen.every((u) => /\?t=\d+$/.test(u)));
  let k = 0;
  const present = await verifyFrontInstance({ fetchText: async () => ({ status: 200, text: ++k > 1 ? mine : other }), url: 'http://a.example/p.html', blockId: '111', settingId: 'AbC', attempts: 3, ...fakeClock() });
  assert.equal(present.status, 'present');
  const down = await verifyFrontInstance({ fetchText: async (url) => url.includes('/p.html?')
    ? ({ status: 500, text: '', headers: { server: 'Pingora' } })
    : ({ status: 500, text: '', headers: { server: 'Pingora' } }),
  url: 'http://a.example/p.html', blockId: '111', settingId: 'AbC', attempts: 2, ...fakeClock() });
  assert.equal(down.status, 'front-unreachable-from-runner');
  assert.equal(down.reachability.rootProbe.status, 500);
  assert.equal(down.reachability.rootProbe.server, 'Pingora');
  assert.equal(down.reachability.targetFailures[0].status, 500);
});

test('target verification failure is not classified as runner-unreachable when site root responds', async () => {
  const result = await verifyFrontInstance({ fetchText: async (url) => url.includes('/p.html?')
    ? { status: 500, text: '' } : { status: 200, text: '<html>site</html>' },
  url: 'http://a.example/p.html', blockId: '111', settingId: 'AbC', attempts: 1, ...fakeClock() });
  assert.equal(result.status, 'unreachable');
  assert.equal(result.reachability.rootProbe.status, 200);
  assert.equal(result.reachability.rootProbe.empty, false);
});

test('external front result confirms only when HTTP succeeds and both target identifiers are found', () => {
  const base = { blockId: '111', block: { settingId: 'AbC' }, published: false, publishedConfirmed: false,
    confirmationSource: null };
  const good = applyExternalFrontVerification(base, { url: 'http://a.example/p.html?t=4&token=secret',
    httpStatus: 200, blockFound: true, settingIdFound: true, checkedAt: '2026-11-01T00:00:00Z' });
  assert.equal(good.publishedConfirmed, true);
  assert.equal(good.published, true);
  assert.equal(good.confirmationSource, 'external-front-check');
  assert.equal(good.externalFrontVerification.confirmed, true);
  assert.equal(good.externalFrontVerification.url, 'http://a.example/p.html?t=4');
  assert.equal(JSON.stringify(good).includes('secret'), false);
  for (const values of [
    { httpStatus: 200, blockFound: true, settingIdFound: false },
    { httpStatus: 200, blockFound: false, settingIdFound: true },
    { httpStatus: 500, blockFound: true, settingIdFound: true },
  ]) {
    const result = applyExternalFrontVerification(base, { url: 'https://a.example/p.html', ...values,
      checkedAt: '2026-11-01T00:00:00Z' });
    assert.equal(result.publishedConfirmed, false);
    assert.equal(result.published, false);
    assert.equal(result.externalFrontVerification.confirmed, false);
  }
});

test('external front result rejects malformed data and incomplete reports', () => {
  assert.throws(() => applyExternalFrontVerification({}, {}));
  assert.throws(() => applyExternalFrontVerification({ blockId: '1', block: { settingId: 'x' } }, {
    url: 'file:///tmp/x', httpStatus: 200, blockFound: true, settingIdFound: true,
    checkedAt: '2026-11-01T00:00:00Z' }));
});

test('fresh flow fails the run when the adapter cannot confirm the publish', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/fresh-block-flow.mjs', import.meta.url), 'utf8');
  assert.match(src, /publishPage\(\{ settingId: fresh\.settingId \}\)/);
  assert.match(src, /fresh-publish-confirmed/);
});

test('publish menu: picks exactly the scoped entry, refuses unknown or ambiguous', async () => {
  const { choosePublishMenuItem } = await import('../src/publish-confirm.mjs');
  assert.equal(choosePublishMenuItem(['\n整站发布 ', ' 当前页面发布\n']), 1);
  assert.equal(choosePublishMenuItem(['整站发布', '当前页面发布'], 'all'), 0);
  assert.throws(() => choosePublishMenuItem(['整站发布'], 'current'));
  assert.throws(() => choosePublishMenuItem(['当前页面发布', '当前页面发布']));
  assert.throws(() => choosePublishMenuItem(['当前页面发布'], 'x'));
});

test('publish diagnostics report only workflow stage and menu/dialog visibility counts', () => {
  const diagnostics = publishStageDiagnostics({ stage: 'wait-confirm-dialog', chooserVisibleCount: 0,
    publishMenuVisibleCount: 0, confirmDialogVisibleCount: 0 });
  assert.deepEqual(diagnostics, { stage: 'wait-confirm-dialog', chooserVisibleCount: 0,
    publishMenuVisibleCount: 0, confirmDialogVisibleCount: 0 });
});

test('publish adapter requires the chooser closed, confirmation dialog, and confirmed front verification', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/fresh-block-browser-adapter.mjs', import.meta.url), 'utf8');
  assert.match(src, /afterDismiss\.chooserVisibleCount !== 0/);
  assert.match(src, /stage = 'wait-confirm-dialog'/);
  assert.doesNotMatch(src, /dialog\.first\(\)\.waitFor\([^;]+\.catch\(\(\) => \{\}\)/);
  assert.match(src, /confirmed: publishSignal\.status === 'confirmed' && frontVerification\.status === 'present'/);
});
test('adapter opens the publish scope submenu instead of treating the toggle click as a publish', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/fresh-block-browser-adapter.mjs', import.meta.url), 'utf8');
  assert.match(src, /\.backstage-publish-type > div/);
  assert.match(src, /choosePublishMenuItem\(labels, 'current'\)/);
  assert.doesNotMatch(src, /publishScope \|\| process\.env\.PUBLISH_SCOPE/);
});
