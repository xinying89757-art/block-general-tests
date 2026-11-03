import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const usage = `用法：node scripts/handoff.mjs --from VM --to Mac [--block 47498] [--help]

生成 VM ↔ Mac 站点交接卡，只读取本地报告，不操作站点。
  --from <VM|Mac>  交出方（大小写不敏感）
  --to <VM|Mac>    接收方，必须与交出方不同
  --block <ID>     目标区块；省略时采用所有区块中最新的报告
  --help          显示帮助，不写文件

输出：reports/handoff-YYYYMMDD-HHmm.md（UTC）；无报告时保留待填字段。
同一分钟已存在的交接卡不会覆盖，请保留原卡片，下一分钟再生成。
当前占用方默认为交出方，双方勾选确认后手动改为接收方。`;

// 仅输出明确允许的摘要字段；URL 去掉认证信息、查询参数和片段。
function clean(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  return String(value).replace(/https?:\/\/[^\s<>]+/gi, (raw) => {
    try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return '[无效 URL]'; }
  }).replace(/[\r\n\t]/g, ' ').replace(/[\\`*_{}\[\]<>]/g, '\\$&');
}

const field = (value) => clean(value) || '_（待填写）_';

async function latestReport(block) {
  const directory = path.join(projectRoot, 'reports');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    console.warn(`[handoff] 无法读取 reports/（${error.code || '读取失败'}），生成空白交接卡。`);
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^report-.+\.json$/.test(entry.name)) continue;
    if (block && !entry.name.startsWith(`report-${block}-`)) continue;
    const file = path.join(directory, entry.name);
    try {
      const report = JSON.parse(await readFile(file, 'utf8'));
      if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error();
      const id = report.config?.blockId ?? report.profile?.blockId ?? report.blockId ?? entry.name.match(/^report-([^-]+)-/)?.[1];
      if (block && String(id) !== block) continue;
      const timestamp = Date.parse(report.startedAt) || Date.parse(report.finishedAt) || (await stat(file)).mtimeMs;
      candidates.push({ file, report, block: id, timestamp });
    } catch { console.warn(`[handoff] 报告 ${entry.name} 无法读取或格式无效，已跳过。`); }
  }
  candidates.sort((a, b) => b.timestamp - a.timestamp || b.file.localeCompare(a.file));
  if (!candidates.length) console.warn(`[handoff] 未找到${block ? `区块 ${block} 的` : ''}可用报告，缺失信息请手动填写。`);
  return candidates[0] || null;
}

function instanceSummary(report) {
  const selected = report.added?.selectedInstance ?? report.instance ?? report.siteBaseline?.instance;
  if (!selected || typeof selected !== 'object') return '';
  // settingId 通常在实例清单中；多实例时必须按 index 对齐，不能取全局第一个。
  const instances = Array.isArray(report.added?.instances) ? report.added.instances : [];
  const matched = selected.index == null ? null : instances.find((item) => item?.index === selected.index);
  const parts = [];
  for (const [label, value] of [
    ['settingId', selected.settingId ?? matched?.settingId],
    ['实例 ID', selected.instanceId], ['DOM index', selected.index],
    ['页面顺序', selected.order], ['同号实例总数', selected.total ?? report.added?.countAfter],
  ]) {
    if (value !== undefined && value !== null && value !== '') parts.push(`${label}=${clean(value)}`);
  }
  return parts.join('；');
}

async function main() {
  const { values } = parseArgs({ options: {
    from: { type: 'string' }, to: { type: 'string' }, block: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); return; }
  const names = { vm: 'VM', mac: 'Mac' };
  const from = names[values.from?.toLowerCase()];
  const to = names[values.to?.toLowerCase()];
  if (!from || !to || from === to) throw new Error(`请指定不同的交出方与接收方（VM / Mac）。\n${usage}`);
  if (values.block !== undefined && !/^\d+$/.test(values.block)) throw new Error('--block 必须是数字区块 ID。');
  const latest = await latestReport(values.block);
  const report = latest?.report || {};
  const config = report.config || {};
  const page = typeof report.page === 'object' && report.page ? report.page : {};
  const target = report.profile?.target || report.target || {};
  const capabilities = Array.isArray(report.profile?.capabilities) ? report.profile.capabilities : [];
  const summary = [
    `浏览器：${field(config.browser)}`, `模块类型：${field(config.moduleType)}`,
    `页面类型：${field(page.kind ?? page.pageKind ?? config.targetPageKind ?? target.pageKind)}`,
    `能力：${capabilities.map((item) => clean(typeof item === 'string' ? item : item?.id)).filter(Boolean).join('、') || '待填写'}`,
    `能力过滤：${field(Array.isArray(report.capabilityFilter) ? report.capabilityFilter.join(', ') : report.capabilityFilter)}`,
    `报告状态：${field(report.status)}`,
  ].join('；');
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const time = now.toISOString().slice(11, 16).replace(':', '');
  const out = path.join(projectRoot, 'reports', `handoff-${date}-${time}.md`);
  const content = `# VM ↔ Mac 站点交接卡

- **生成时间**：${now.toISOString()}（UTC）
- **交接方向**：${from}→${to}
- **站点**：${field(config.siteDomain ?? report.siteDomain ?? report.site?.domain)}
- **页面**：${field(page.page ?? page.name ?? config.targetPage ?? target.page ?? (typeof report.page === 'string' ? report.page : ''))}
- **目标区块**：${field(values.block ?? latest?.block)}
- **新实例身份**：${instanceSummary(report) || '_（待填写）_'}
- **本轮是否新加实例**：${field(report.added?.added)}
- **最后报告 ID**：${field(report.runId)}
- **报告文件**：${latest ? clean(path.relative(projectRoot, latest.file)) : '_（待填写）_'}
- **配置摘要**：${latest ? summary : '_（待填写）_'}
- **发布结果**：_（待填写：是否发布成功、时间及验证页面）_
- **待看项目**：_（待填写：检查 ID、证据路径、待确认事项）_
- **当前占用方**：${from}（双方确认后改为 ${to}）

- [ ] 交出方确认：设置已恢复并保存，报告及实例身份已核对，交出方已停止编辑。
- [ ] 接收方确认：已核对站点、页面和实例，已接收待看项目并更新当前占用方。
`;
  await mkdir(path.dirname(out), { recursive: true });
  // 同一分钟重复交接时保留原卡片，防止覆盖人工确认。
  await writeFile(out, content, { encoding: 'utf8', flag: 'wx' });
  console.log(`交接卡：${out}`);
}

main().catch((error) => {
  console.error(`[handoff] ${error.code === 'EEXIST' ? '本分钟的交接卡已存在，请保留原卡片，下一分钟再生成。' : error.code?.startsWith('ERR_PARSE_ARGS') ? `${error.message}\n${usage}` : error.code ? `操作失败（${error.code}），请检查目录和权限。` : error.message}`);
  process.exitCode = 1;
});
