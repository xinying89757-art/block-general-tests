import test from 'node:test';
import assert from 'node:assert/strict';
import { findAndClickCategoryLink } from '../src/capabilities/product-category-select.mjs';

// Minimal DOM mock: wrap.querySelectorAll('a') returns link-like objects.
const makeWrap = (texts) => {
  const links = texts.map((innerText) => ({
    innerText,
    clicked: false,
    click() { this.clicked = true; },
  }));
  return {
    querySelectorAll: (sel) => {
      assert.equal(sel, 'a');
      return links;
    },
    __links: links,
  };
};

test('unique matching link is clicked', () => {
  const wrap = makeWrap(['全部产品', '测试分类', '其他分类']);
  const res = findAndClickCategoryLink(wrap, '测试分类');
  assert.deepEqual(res, { clicked: true });
  assert.equal(wrap.__links[1].clicked, true);
  assert.equal(wrap.__links[0].clicked, false);
  assert.equal(wrap.__links[2].clicked, false);
});

test('no matching link → not-found, nothing clicked', () => {
  const wrap = makeWrap(['全部产品', '其他分类']);
  const res = findAndClickCategoryLink(wrap, '测试分类');
  assert.deepEqual(res, { clicked: false, reason: 'not-found' });
  assert.ok(wrap.__links.every((l) => !l.clicked));
});

test('duplicate link names → ambiguous, nothing clicked (同名链接先出现也不点)', () => {
  // Two links with the same normalized text: the old code would have
  // clicked the first one (possibly in another block/nav). Now it must
  // refuse and report ambiguity.
  const wrap = makeWrap(['测试分类', '测试分类']);
  const res = findAndClickCategoryLink(wrap, '测试分类');
  assert.deepEqual(res, { clicked: false, reason: 'ambiguous', count: 2 });
  assert.ok(wrap.__links.every((l) => !l.clicked));
});

test('whitespace is normalized before matching', () => {
  const wrap = makeWrap(['  测试\n分类  ']);
  const res = findAndClickCategoryLink(wrap, '测试 分类');
  assert.deepEqual(res, { clicked: true });
  assert.equal(wrap.__links[0].clicked, true);
});

test('search is scoped to wrap, not document', () => {
  // The function only calls wrap.querySelectorAll — it never touches
  // the global document. A same-named link outside wrap is invisible.
  let calledOn = null;
  const wrap = {
    querySelectorAll(sel) {
      calledOn = 'wrap';
      assert.equal(sel, 'a');
      return [];
    },
  };
  const res = findAndClickCategoryLink(wrap, '测试分类');
  assert.equal(calledOn, 'wrap');
  assert.deepEqual(res, { clicked: false, reason: 'not-found' });
});
