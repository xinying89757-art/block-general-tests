import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { blockingEditorOverlays } from '../src/editor.mjs';

test('编辑器遮罩按精确隐藏类名排除已关闭元素', async (t) => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const scope = { locator: (selector) => page.locator(selector) };
    const style = 'position:fixed;inset:0;z-index:9999';

    await t.test('站点入口遮罩带 hide 且透明时不阻塞', async () => {
      await page.setContent(`<div class="backstage-dialog-overlay hide" style="${style};opacity:0"></div>`);
      assert.deepEqual(await blockingEditorOverlays(scope), []);
    });

    await t.test('移除 hide 后仍检测为阻塞遮罩', async () => {
      await page.setContent(`<div class="backstage-dialog-overlay" style="${style};opacity:0"></div>`);
      assert.deepEqual(await blockingEditorOverlays(scope), [
        'div.backstage-dialog-overlay (pointer-events:auto, z-index:9999)',
      ]);
    });

    for (const hiddenClass of ['hidden', 'invisible']) {
      await t.test(`已知遮罩带 ${hiddenClass} 时不阻塞`, async () => {
        await page.setContent(`<div class="layui-layer-shade ${hiddenClass}" style="${style}"></div>`);
        assert.deepEqual(await blockingEditorOverlays(scope), []);
      });
    }

    await t.test('未知全屏固定遮罩带 hide 时不阻塞，移除后仍阻塞', async () => {
      await page.setContent(`<div class="unknown-overlay hide" style="${style}"></div>`);
      assert.deepEqual(await blockingEditorOverlays(scope), []);
      await page.locator('.unknown-overlay').evaluate((element) => element.classList.remove('hide'));
      assert.deepEqual(await blockingEditorOverlays(scope), [
        'div.unknown-overlay (generic-fixed-overlay, pointer-events:auto, z-index:9999)',
      ]);
    });

    await t.test('包含隐藏词的其他类名不会被误排除', async () => {
      await page.setContent(`<div class="layui-layer-shade hideable hidden-panel invisible-mask" style="${style}"></div>
        <div class="unknown-overlay hideable hidden-panel invisible-mask" style="${style}"></div>`);
      const blockers = await blockingEditorOverlays(scope);
      assert.equal(blockers.length, 2);
      assert.match(blockers[0], /^div\.layui-layer-shade\./);
      assert.match(blockers[1], /generic-fixed-overlay/);
    });
  } finally { await browser.close(); }
});
