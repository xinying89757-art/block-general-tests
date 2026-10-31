// Read-only view of the module library for an explicit editor page.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, gotoTargetPage } from '../src/editor.mjs';
import { inspectActiveModuleLibraryOpener, probeModuleLibraryModes,
  waitForUniqueVisibleModuleLibraryPanel } from '../src/module-library-browser.mjs';
import { summarizeTargetSearch } from '../src/module-library-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const optionKeys = new Set(['--block', '--page-kind', '--page-id', '--page-url', '--page-name']);
const env = { ...process.env };
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const args = process.argv.slice(2);
  const key = args[index];
  if (!optionKeys.has(key) || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error('Usage: node scripts/list-module-library.mjs --block <id> --page-kind system --page-id <id> --page-url <path>');
  }
  const value = args[++index];
  if (key === '--block') env.BLOCK_ID = value;
  if (key === '--page-kind') env.FRESH_PAGE_KIND = value;
  if (key === '--page-id') env.FRESH_PAGE_ID = value;
  if (key === '--page-url') env.FRESH_PAGE_URL = value;
  if (key === '--page-name') env.FRESH_PAGE_NAME = value;
}
const blockId = String(env.BLOCK_ID || '').trim();
if (!blockId) throw new Error('--block <id> is required as the lookup target.');
const kind = String(env.FRESH_PAGE_KIND || '').trim().toLowerCase();
if (!['system', 'custom'].includes(kind)) throw new Error('--page-kind system|custom is required.');
const page = kind === 'system' ? { kind, id: String(env.FRESH_PAGE_ID || ''), url: String(env.FRESH_PAGE_URL || '') }
  : { kind, name: String(env.FRESH_PAGE_NAME || '') };
if (kind === 'system' && (!page.id || !page.url)) throw new Error('--page-id and --page-url are required for system pages.');
if (kind === 'custom' && !page.name) throw new Error('--page-name is required for custom pages.');
const config = loadConfig();
config.blockId = blockId;
config.projectRoot = root;
if (!config.siteDomain) throw new Error('SITE_DOMAIN is required.');
const siteHost = new URL(/^https?:\/\//i.test(config.siteDomain) ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
config.siteDomain = siteHost;
let pageData = null;
if (kind === 'system') {
  const source = JSON.parse(await fs.readFile(path.join(root, 'sites', siteHost, 'pages.json'), 'utf8'));
  const matches = Object.entries(source.pages || {}).filter(([, item]) => String(item.id) === page.id
    && String(item.url).replace(/\/$/, '') === page.url.replace(/\/$/, ''));
  if (source.siteHost !== siteHost || matches.length !== 1) throw new Error('Page does not uniquely match host-scoped site data.');
  const [pageKey, matchedPage] = matches[0];
  pageData = matchedPage;
  page.editorHref = pageData.editorHref;
  page.name = pageData.name || pageData.title || pageKey;
}

const session = await launchSession(config);
let panel;
let result;
let stage = 'editor-entry';
try {
  session.page = (await openEditor(session.page, config)).page;
  stage = 'page-selection';
  const selected = await gotoTargetPage(session.page, { ...config, resolvedTarget: {
    page: page.name || page.id, kind, ...(kind === 'system' ? { id: page.id, url: page.url } : { name: page.name }),
  }, blockId });
  const canvas = selected.frame;
  const { locator: addButton, matchCount: addCount } = await inspectActiveModuleLibraryOpener(canvas);
  if (addCount !== 1) throw new Error(`Module-library opener matched ${addCount} controls; refusing ambiguous open.`);
  await addButton.click({ timeout: config.actionTimeoutMs });
  stage = 'library-open';
  panel = await waitForUniqueVisibleModuleLibraryPanel(session.page, config.actionTimeoutMs);
  stage = 'library-inventory';
  const modes = await probeModuleLibraryModes({ page: session.page, panel, targetBlockId: blockId, config });
  result = summarizeTargetSearch({ modes, targetBlockId: blockId });
  result.moduleLibraryOpenerMatchCount = addCount;
  result.siteHost = siteHost;
  result.page = { kind, id: page.id || null, name: page.name || null, url: page.url || pageData?.url || null };
  result.links = { editor: page.editorHref || session.page.url(), front: pageData?.frontUrl || page.url || null };
} catch (error) {
  result = { status: 'error', stage, siteHost, targetBlockId: blockId,
    page: { kind, id: page.id || null, name: page.name || null, url: page.url || pageData?.url || null },
    links: { editor: page.editorHref || null, front: pageData?.frontUrl || page.url || null },
    error: { code: error.code || null, message: String(error.message || error) } };
  process.exitCode = 1;
} finally {
  if (panel) {
    try {
      const close = panel.locator('.addmodules_searchContainer > .block-iconbaseline-close');
      if (await close.count() === 1 && await close.first().isVisible()) await close.first().click({ timeout: 5_000 });
      else await session.page.keyboard.press('Escape').catch(() => {});
      await panel.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    } catch { /* The editor session is closed below; no add/save action is performed. */ }
  }
  await session.browser.close();
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = path.join(root, 'reports');
await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `module-library-${timestamp}.json`);
await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
const summaryPath = reportPath.replace(/\.json$/, '-zh.md');
const modeSummary = (result.modes || []).map(({ mode, found, query, screenshot, error }) => `### ${mode}\n\n- 查询编号：${query}\n- 结果：${found ? '找到目标' : '未找到目标'}${error ? `\n- 错误：${error}` : ''}${screenshot ? `\n- 截图：\`${screenshot}\`` : ''}`).join('\n\n');
const summaryBody = result.status === 'error'
  ? `- 结果：盘点未完成，停在阶段「${result.stage}」。\n- 错误：${result.error.code || ''} ${result.error.message}\n`
  : `- 目标区块 ${result.targetBlockId}：${result.targetFound ? '找到' : '未找到'}\n\n${modeSummary}\n`;
await fs.writeFile(summaryPath, `# 模块库只读盘点\n\n- 站点：${result.siteHost}\n- 页面：${result.page.name || result.page.id} (${result.page.url})\n- 前台：${result.links.front}\n- 编辑器：${result.links.editor}\n${summaryBody}\n本脚本只打开并关闭模块库；没有点击添加、保存或发布。在线目录是搜索式，本次仅对目标区块号做查询，并非完整在线目录。\n`);
console.log(`[module-library] report: ${reportPath}`);
console.log(`[module-library] summary: ${summaryPath}`);
if (result.status === 'error') console.error(`[module-library] stopped at ${stage}: ${result.error.code || result.error.message}`);
else console.log(`[module-library] target ${blockId}: ${result.targetFound ? 'found' : 'not found'}; modes=${result.modes.length}`);
