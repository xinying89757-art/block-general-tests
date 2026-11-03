#!/usr/bin/env node
/**
 * Explicit, read-only preview doctor. No browser or configuration is loaded
 * unless --run is supplied. Uses the configured site and existing login state.
 * @example node scripts/check-preview.mjs --help
 * @example node scripts/check-preview.mjs --run
 */
const args = process.argv.slice(2);
if (args.includes('--help') || !args.includes('--run')) {
  console.log('用法：node scripts/check-preview.mjs --run\n读取 .env 的测试站与登录态，进入编辑器并探测预览（10s），随后关闭浏览器；不保存、不发布页面。\n不带 --run 或使用 --help 时只显示说明。');
} else {
  let browser;
  try {
    const [{ loadConfig }, { launchSession }, { openEditor }, { detectPreviewAvailable, selectFrontProvider }] = await Promise.all([
      import('../src/config.mjs'), import('../src/browser.mjs'),
      import('../src/editor.mjs'), import('../src/front-provider.mjs'),
    ]);
    const config = loadConfig();
    if (!config.siteDomain) throw new Error('SITE_DOMAIN_REQUIRED');
    const session = await launchSession(config);
    browser = session.browser;
    const { page } = await openEditor(session.page, config);
    const preview = await detectPreviewAvailable(page, session.context);
    console.log(JSON.stringify({ ...preview, selection: selectFrontProvider() }, null, 2));
  } catch {
    console.error('预览探测未完成：请检查 .env 中的测试站、BLOCK_ID、浏览器配置及已有登录态。');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}
