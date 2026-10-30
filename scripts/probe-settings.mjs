// Read-only inventory: never create pages, add blocks, save, or publish.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { launchSession } from '../src/browser.mjs';
import { openEditor, gotoTargetPage, resolveTargetPage } from '../src/editor.mjs';
import { inventoryRightPanel } from '../src/inventory-rail.mjs';
import { inventorySettings } from '../src/baseline.mjs';
import { compareWithProfile, checkRequirements, checkDisplayFieldRequirement } from '../src/probe-settings.mjs';

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
  console.log('[probe] 只读盘点右侧图标栏…');
  inventory.push(...await inventoryRightPanel({ page: session.page, canvas, config, blockId: config.blockId,
    onProgress: ({ index, total, title }) => console.log(`[probe] 右侧图标 ${index}/${total}：${title} …`) }));
  const result = checkRequirements(inventory, profile?.requirements);
  const displayFieldRequirement = checkDisplayFieldRequirement(inventory, profile);
  const draft = { inventory, ...result, displayFieldRequirement };
  draft.profileComparison = compareWithProfile(draft, profile);
  const clean = scrub(draft);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  console.log('\n需求核对');
  if (clean.requirementMessage) console.log(`- ${clean.requirementMessage}`);
  for (const c of clean.requirementCheck) {
    const locations = c.locations || (c.location ? [c.location] : []);
    console.log(`- ${c.id}：${c.status === 'located' ? '已定位' : '缺失（问题）'}；位置 ${JSON.stringify(locations)}；证据 ${JSON.stringify(c.evidence)}${c.dependsOn ? `；依赖${c.dependsOn.setting}，当前=${c.dependsOn.currentValue}，生效含义=${c.dependsOn.effectiveMeaning}` : ''}`);
  }
  console.log('\n显示字段类型核对');
  if (clean.displayFieldRequirement.message) console.log(`- ${clean.displayFieldRequirement.message}`);
  for (const c of clean.displayFieldRequirement.types) console.log(`- ${c.type}：${c.status}；${c.field || ''}；${c.message}`);
  console.log('\n需求外设置');
  for (const u of clean.outOfScope) console.log(`- ${u.kind || 'dialog'} ${u.type} #${u.wrapIndex}「${u.title || '无标题'}」：${u.controls.map(c => `${(c.label || c.context || '无标签').slice(0, 30)}[${c.type}${c.name ? ' name=' + c.name : ''}]`).join('、') || u.skipped || '无控件'}`);
  console.log('\n与现有画像对比');
  if (!clean.profileComparison.available) console.log('- 无画像');
  for (const c of clean.profileComparison.comparisons) console.log(`- ${c.subject}：${c.status}；探查 ${JSON.stringify(c.observed)}；画像 ${JSON.stringify(c.expected)}`);
  console.log(`[probe] 草稿已写入 ${out}；探查仅在接入、换站或区块改版时运行，结果保存复用。`);
} finally { await session.browser.close(); }
