import test from 'node:test';
import assert from 'node:assert/strict';
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
