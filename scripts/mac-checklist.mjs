import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportsDir = path.join(root, 'reports');
const usage = `用法：
  node scripts/mac-checklist.mjs --block 47498 [--report <path>]
  node scripts/mac-checklist.mjs --report <path>
  node scripts/mac-checklist.mjs --help

根据本地报告生成 Mac 前台待验清单，不连接站点。
  --block <ID>     数字区块 ID；从 reports/report-<ID>-*.json 取最新报告
  --report <path>  指定报告（相对当前工作目录或绝对路径），优先于自动查找
                  可单独使用，区块 ID 从报告或 report-<ID>-*.json 文件名读取
  --help          显示帮助，不写文件

最新报告按 startedAt、finishedAt、文件修改时间依次回退排序。
输出：reports/mac-checklist-<block>-YYYYMMDD-HHmm.md（UTC）。
客观检查列出 front 层项目；人工部分列出 human-review / deferred 和固定视觉项。
deferred 表示待补跑，不能因勾选清单而视为脚本通过。
同一分钟已有的清单不会覆盖，以免丢失已勾选的结果。`;

const manualStatuses = new Set(['human-review', 'deferred']);
// 旧版通用前台检查没有 layer 字段，沿用其固定 ID。
const legacyFrontIds = new Set([
  'block-present', 'img-alt', 'link-href', 'cursor-pointer', 'css-font-follow',
  'css-word-break', 'carousel-arrows', 'cff-groups-baseline', 'cff-facet-narrow', 'cff-clear-restore',
]);
const visualItems = [
  '布局是否错乱：目标区块的排列、对齐和间距是否正常。',
  '图片是否显示：有无破图、拉伸或异常裁切。',
  '文字是否溢出：有无截断、重叠、遮挡或异常换行。',
  '颜色、字体和按钮外观是否符合已确认的设计要求（无设计稿时记录观察）。',
  '桌面和移动视口下，区块内部有无挤压、遮挡或无法操作的元素（页面整体溢出仅记录）。',
];

function clean(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\\`*_{}\[\]<>|]/g, '\\$&');
}

function reportBlock(report, file) {
  const ids = [report.config?.blockId, report.profile?.blockId, report.blockId]
    .filter((id) => id !== undefined && id !== null).map(String);
  if (new Set(ids).size > 1) throw new Error('报告中的区块 ID 不一致，请确认报告归属。');
  return ids[0] ?? path.basename(file).match(/^report-(\d+)-.*\.json$/)?.[1];
}

async function loadReport(file) {
  let report;
  try {
    report = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`报告不存在：${file}。请先生成报告或检查 --report 路径。`);
    throw new Error(`报告无法读取或不是有效 JSON：${file}。请检查文件内容和读取权限。`);
  }
  if (!report || !Array.isArray(report.checks)
    || report.checks.some((check) => !check || typeof check !== 'object' || Array.isArray(check))) {
    throw new Error(`报告格式无效：${file}，需要 checks 检查项数组。`);
  }
  return report;
}

async function latestReport(block) {
  let entries;
  try { entries = await readdir(reportsDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('reports/ 目录不存在，请先生成测试报告。');
    throw new Error('无法读取 reports/，请检查目录权限。');
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`report-${block}-`) || !entry.name.endsWith('.json')) continue;
    const file = path.join(reportsDir, entry.name);
    try {
      const report = await loadReport(file);
      if (reportBlock(report, file) !== block) throw new Error('文件名与报告内的区块 ID 不一致。');
      const timestamp = Date.parse(report.startedAt) || Date.parse(report.finishedAt) || (await stat(file)).mtimeMs;
      candidates.push({ file, report, timestamp });
    } catch (error) { console.warn(`[mac-checklist] 跳过 ${entry.name}：${error.message}`); }
  }
  candidates.sort((a, b) => b.timestamp - a.timestamp || b.file.localeCompare(a.file));
  if (!candidates.length) throw new Error(`未找到区块 ${block} 的可用报告（reports/report-${block}-*.json）。请先生成报告或使用 --report 指定。`);
  return candidates[0];
}

function isFront(check) {
  // 有明确层级时以层级为准；无层级的旧报告通过 suite 和既有 ID 识别。
  if (check.layer !== undefined) return check.layer === 'front';
  return ['front', 'front-runner'].includes(check.suite)
    || legacyFrontIds.has(check.id) || /(?:^|-)front(?:-|$)/.test(check.id || '')
    || /^bss-/.test(check.id || '');
}

export function renderMacChecklist(report, { block, reportPath, now = new Date() }) {
  const objective = report.checks.filter(isFront);
  const manual = report.checks.filter((check) => manualStatuses.has(check.status));
  const row = (check) => `- [ ] ID：${clean(check.id) || '未提供'}；名称：${clean(check.name || check.description || check.id) || '未命名'}；状态：${clean(check.status) || '未提供'}`;
  return [
    `# Mac 前台待验清单：区块 ${clean(block)}`, '',
    `生成时间：${now.toISOString()}（UTC）`,
    `来源报告：${clean(reportPath)}`, '',
    '仅针对目标区块确认；勾选表示完成复核，不改写报告中的判定。', '',
    '## 1. 客观检查（脚本可验证）', '',
    '以下为 front 层项目，状态保留原报告值；human-review 的结论需在第二部分人工确认。', '',
    ...(objective.length ? objective.map(row) : ['报告中没有可识别的 front 层检查项。']), '',
    '## 2. 人工视觉确认', '',
    '报告待确认项如下。deferred 是延后运行项：需在 Mac 补跑脚本，再复核结果；勾选不代表脚本通过。', '',
    ...(manual.length ? manual.map(row) : ['报告中没有 human-review / deferred 项。']), '',
    '固定视觉检查模板（按目标区块实测；不适用时注明）：', '',
    ...visualItems.map((item) => `- [ ] ${item}`), '',
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({ options: {
    block: { type: 'string' }, report: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); return; }
  if (!values.block && !values.report) throw new Error(`请提供 --block 或 --report。\n${usage}`);
  if (values.block !== undefined && !/^\d+$/.test(values.block)) throw new Error('--block 必须是数字区块 ID。');
  const selected = values.report
    ? { file: path.resolve(values.report), report: await loadReport(path.resolve(values.report)) }
    : await latestReport(values.block);
  const inferred = reportBlock(selected.report, selected.file);
  if (values.block && inferred && values.block !== inferred) throw new Error(`--block ${values.block} 与报告区块 ${inferred} 不一致。`);
  const block = values.block || inferred;
  if (!block || !/^\d+$/.test(block)) throw new Error('无法确定数字区块 ID，请用 --block 指定。');
  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10).replaceAll('-', '')}-${now.toISOString().slice(11, 16).replace(':', '')}`;
  const output = path.join(reportsDir, `mac-checklist-${block}-${stamp}.md`);
  await mkdir(reportsDir, { recursive: true });
  try {
    await writeFile(output, renderMacChecklist(selected.report, {
      block, reportPath: path.relative(root, selected.file), now,
    }), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`清单已存在：${path.relative(root, output)}。为保留勾选结果，请下一分钟再生成。`);
    throw new Error('无法写入清单，请检查 reports/ 目录权限和磁盘空间。');
  }
  console.log(`[mac-checklist] 已生成 ${path.relative(root, output)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    console.error(`[mac-checklist] ${error.message}`);
    process.exitCode = 1;
  }
}
