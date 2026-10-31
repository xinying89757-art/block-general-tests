import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEditorSiteHosts } from '../src/editor.mjs';

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
