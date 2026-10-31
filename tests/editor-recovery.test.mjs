import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentPageLabel, hasActivePageMarker, resolveCurrentPageLabel, resolveEditorSiteHosts,
  verifyCurrentPageIdentity } from '../src/editor.mjs';

test('current page identity uses the one active page label instead of page-menu contents', () => {
  const snapshot = { toolbarText: '页面: 保存  Products Product Detail Product Category News', activeItems: [
    { label: 'Products', active: true }, { label: 'Product Detail', active: false },
    { label: 'Product Category', active: false }, { label: 'News', active: false },
  ] };
  assert.equal(resolveCurrentPageLabel(snapshot), 'Products');
  assert.equal(assertCurrentPageLabel(snapshot, 'Products'), 'Products');
});

test('current page identity fails closed when the active page differs from the requested page', () => {
  const snapshot = { toolbarText: '页面: 保存 Products Product Detail', activeItems: [
    { label: 'Product Detail', active: true }, { label: 'Products', active: false },
  ] };
  assert.throws(() => assertCurrentPageLabel(snapshot, 'Products'), /当前活动页为「Product Detail」/);
});

test('toolbar page identity stops at the first editor action instead of absorbing toolbar history text', () => {
  const snapshot = { activeItems: [], toolbarText: '页面: Products 智能优化当前页面 操作记录 暂无历史记录 显示更多 没有更多了' };
  assert.equal(resolveCurrentPageLabel(snapshot), 'Products');
  assert.equal(assertCurrentPageLabel(snapshot, 'Products'), 'Products');
  assert.throws(() => assertCurrentPageLabel(snapshot, 'Catalog'), /当前活动页为「Products」/);
  assert.equal(resolveCurrentPageLabel({ activeItems: [], toolbarText: '页面: 智能优化当前页面 操作记录 暂无历史记录' }), '');
  assert.throws(() => assertCurrentPageLabel({ activeItems: [], toolbarText: '页面: 智能优化当前页面' }, 'Products'),
    /无法读取当前页面自己的活动标签/);
});

test('page identity reads active markers from any page-row ancestor and waits for editor masks', async () => {
  assert.equal(hasActivePageMarker([{ className: 'row-container selected' }]), true);
  assert.equal(hasActivePageMarker([{ className: 'row-container on' }]), true);
  assert.equal(hasActivePageMarker([{ className: 'page-row' }]), false);
  let maskReads = 0;
  const page = {
    locator: () => ({ evaluate: async () => { maskReads++; return []; } }),
    evaluate: async () => ({ activeItems: [{ label: 'Products', ancestors: [{ className: 'page-row selected' }] },
      { label: 'News', ancestors: [{ className: 'page-row' }] }],
      toolbarText: '智能优化当前页面 操作记录' }),
  };
  assert.equal(await verifyCurrentPageIdentity(page, 'Products'), 'Products');
  assert.equal(maskReads, 1);
});

test('editor host identity is read from the canvas frame and ignores platform frames', () => {
  assert.deepEqual(resolveEditorSiteHosts({
    pageUrl: 'https://www.leadong.com/phoenix/pagebuilder/index',
    frameUrls: ['https://www.leadong.com/phoenix/frame', 'http://en-site79106751.ldwebsite.com/phoenix/page'],
  }, 'en-site79106751.ldwebsite.com'), ['en-site79106751.ldwebsite.com']);
});

test('editor host identity can be read from the builder pageurl attributes', () => {
  assert.deepEqual(resolveEditorSiteHosts({
    pageUrl: 'https://website.leadong.com/phoenix/pagebuilder/layout',
    frameUrls: ['https://website.leadong.com/phoenix/pagebuilder?_=abc'],
    domHosts: ['http://en-site79106751.ldwebsite.com/products.html'],
  }, 'en-site79106751.ldwebsite.com'), ['en-site79106751.ldwebsite.com']);
});

test('editor host identity rejects a different readable host and fails closed when absent', () => {
  assert.throws(() => resolveEditorSiteHosts({
    pageUrl: 'https://www.leadong.com/phoenix/pagebuilder/index',
    frameUrls: ['https://other.example/products'],
  }, 'en-site79106751.ldwebsite.com'), /站点身份不匹配/);
  assert.throws(() => resolveEditorSiteHosts({
    pageUrl: 'https://www.leadong.com/phoenix/pagebuilder/index',
  }, 'en-site79106751.ldwebsite.com'), /无法确认当前编辑器对应的站点 host/);
});
