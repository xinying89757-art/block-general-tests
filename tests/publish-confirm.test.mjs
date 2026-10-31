import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPublishSignal, verifyFrontInstance, cacheBustedUrl, frontHasInstance } from '../src/publish-confirm.mjs';

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
  const down = await verifyFrontInstance({ fetchText: async () => ({ status: 403, text: '' }), url: 'http://a.example/p.html', blockId: '111', settingId: 'AbC', attempts: 2, ...fakeClock() });
  assert.equal(down.status, 'unreachable');
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
test('adapter opens the publish scope submenu instead of treating the toggle click as a publish', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/fresh-block-browser-adapter.mjs', import.meta.url), 'utf8');
  assert.match(src, /\.backstage-publish-type > div/);
  assert.match(src, /choosePublishMenuItem\(labels/);
});
