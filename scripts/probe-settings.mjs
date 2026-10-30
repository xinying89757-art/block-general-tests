// Read-only inventory: never create pages, add blocks, save, or publish.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, gotoTargetPage, resolveTargetPage } from '../src/editor.mjs';
import { inventorySettings } from '../src/baseline.mjs';
import { openProdPage, listCustomFields } from '../src/cms.mjs';
import { matchCapabilities } from '../src/capabilities/signatures.mjs';
import { compareWithProfile, inspectDisplayFields } from '../src/probe-settings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[2]) process.env.BLOCK_ID = process.argv[2];
const config = loadConfig();
if (!/^[\w-]+$/.test(config.blockId)) throw new Error('BLOCK_ID 格式无效。');
const profilePath = path.resolve(root, config.profile || `profiles/${config.blockId}.json`);
let profile = null;
try { profile = JSON.parse(await readFile(profilePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
config.resolvedTarget = resolveTargetPage(config, profile);
const siteHost = new URL(config.siteDomain.includes('://') ? config.siteDomain : `https://${config.siteDomain}`).host;
const out = path.resolve(root, process.env.PROBE_OUT || `drafts/${siteHost}/${config.blockId}.json`);
// Exclude credential-bearing keys and scrub configured secrets and URL credentials
// from all strings, including error messages and control text.
const secrets = [config.password, config.account, (() => { try { const u = new URL(config.httpsProxy); return decodeURIComponent(u.password); } catch { return ''; } })()].filter(Boolean);
function scrub(value, key = '') {
  if (/cookie|token|password|passwd|authorization|credential|secret/i.test(key)) return '[已脱敏]';
  if (Array.isArray(value)) return value.map(v => scrub(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  if (typeof value !== 'string') return value;
  let text = value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已脱敏]@')
    .replace(/([?&](?:token|access_token|key|password|auth|session|sid)=)[^&#\s]*/gi, '$1[已脱敏]');
  for (const secret of secrets) text = text.split(secret).join('[已脱敏]');
  return text;
}
console.log('[probe] 打开编辑器…');
const session = await launchSession(config);
try {
  session.page = (await openEditor(session.page, config)).page;
  console.log('[probe] 进入已有目标页…');
  const { frame: canvas } = await gotoTargetPage(session.page, config);
  const present = await canvas.locator('.siteblocks-setting-wrap[data-appid]').evaluateAll(
    (nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-appid')))]);
  console.log(`[probe] 当前页已有区块：${present.join(', ') || '无'}`);
  if (!present.includes(String(config.blockId))) {
    throw new Error(`区块 ${config.blockId} 不在目标页（探查只读，不会添加区块）。可用 TARGET_PAGE 指向已放置该区块的页面。`);
  }
  console.log('[probe] 读取设置区域…');
  const inventory = await inventorySettings({ page: session.page, canvas, config, blockId: config.blockId,
    onProgress: ({ index, total, type, wrapIndex }) => console.log(`[probe] 区域 ${index}/${total}：${type} #${wrapIndex} …`) });
  console.log('[probe] 读取 CMS 自定义字段列表…');
  let fields = null, cmsReason = null, cmsPage;
  try { cmsPage = await openProdPage(session.context); fields = await listCustomFields(cmsPage); }
  catch (error) { cmsReason = scrub(error.message); console.log(`[probe] CMS 字段列表不可用：${cmsReason}`); }
  finally { if (cmsPage) await cmsPage.close(); }
  const result = matchCapabilities(inventory);
  const displayFields = inspectDisplayFields(inventory, result.matched, fields);
  if (cmsReason) displayFields.reason = `CMS 读取失败：${cmsReason}`;
  const draft = { inventory, ...result, displayFields };
  draft.profileComparison = compareWithProfile(draft, profile);
  const clean = scrub(draft);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  console.log('\n已匹配能力');
  for (const m of clean.matched) console.log(`- ${m.id} (${m.parentModule})：${m.type} #${m.wrapIndex}「${m.title || '按钮浮层'}」；${m.evidence.map(e => `${e.label}: ${e.value ?? ''}`).join('、')}`);
  console.log('\n无此设置项（未识别到，不代表隐藏设置不存在）');
  for (const a of clean.absent) console.log(`- ${a.id} (${a.parentModule})`);
  console.log('\n未识别设置项');
  for (const u of clean.unrecognized) console.log(`- ${u.type} #${u.wrapIndex}「${u.title || '无标题'}」：${u.controls.map(c => `${(c.label || c.context || '无标签').slice(0, 30)}[${c.type}${c.name ? ' name=' + c.name : ''}]`).join('、') || u.skipped || '无控件'}`);
  console.log('\n与现有画像对比');
  if (!clean.profileComparison.available) console.log('- 无画像');
  for (const c of clean.profileComparison.comparisons) console.log(`- ${c.subject}：${c.status}；探查 ${JSON.stringify(c.observed)}；画像 ${JSON.stringify(c.expected)}`);
  console.log(`[probe] 草稿已写入 ${out}`);
} finally { await session.browser.close(); }
