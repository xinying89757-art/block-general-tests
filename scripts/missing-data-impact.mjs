import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const usage = `用法：node scripts/missing-data-impact.mjs [--help] [--report <path>] [--block <id>] [--out <path>]

汇总报告中因缺数据而 skip/na 的检查，排除明确不存在的功能。
  --report <path>  指定报告（相对当前工作目录或绝对路径）；优先于 --block
  --block <id>     按文件名降序取该区块最新报告
  --out <path>     同时写入文件（相对当前工作目录或绝对路径）
  --help           显示帮助，不读取报告、不写文件

默认按文件名降序取项目 reports/ 下最新的 report-*.json。`;

const absentFeature = /本区块没有|该区块没有|无此设置项|没有(此|该)选项组|不支持此/;
const rules = [
  { label: '缺：AUTOTEST 自定义字段', pattern: /没有可切换的自定义字段|没有可以改写的 AUTOTEST 字段/, action: '建 1 个 AUTOTEST 自定义字段' },
  { label: '缺：AUTOTEST 产品（至少 2 个）', pattern: /缺少已准备的至少两个 AUTOTEST 产品/, action: '建 2 个 AUTOTEST 产品' },
  { label: '缺：夹具真值表数据', pattern: /夹具真值表/, action: '补夹具真值表数据' },
  { label: '缺：夹具准备（需排查）', pattern: /夹具准备失败/, action: '排查夹具准备失败原因（先修再补数据）' },
  { label: '其他 skip（非数据原因）' },
];

// 纯函数：不修改检查或状态；每项只归入首个命中的组，空组不输出。
export function classifySkips(checks) {
  const groups = rules.map(({ label, action }) => ({ label, action, count: 0, checks: [] }));
  for (const check of checks) {
    if (!check || !['skip', 'na'].includes(check.status)) continue;
    const detail = String(check.detail ?? '').trim() || String(check.description ?? '').trim();
    if (absentFeature.test(detail)) continue;
    const index = rules.findIndex(({ pattern }) => !pattern || pattern.test(detail));
    groups[index].checks.push({ id: check.id, detail });
    groups[index].count += 1;
  }
  return groups.filter(({ count }) => count > 0);
}

function formatImpact(reportName, groups) {
  const count = groups.reduce((sum, group) => sum + group.count, 0);
  if (!count) return '未发现因缺数据跳过的检查。\n';
  const sections = groups.map((group) => {
    const lines = [`[${group.label}] 影响 ${group.count} 项检查`];
    // 非数据原因只计数，不给补数据建议。
    if (group.action) {
      for (const check of group.checks) {
        const characters = Array.from(check.detail.replace(/[\r\n\t]+/g, ' '));
        const detail = characters.slice(0, 80).join('') + (characters.length > 80 ? '…' : '');
        lines.push(`  - ${check.id}: ${detail}`);
      }
      lines.push(`  建议动作：${group.action}`);
    }
    return lines.join('\n');
  });
  return `缺数据影响汇总（报告：${reportName}，共 ${count} 项 skip/na）\n\n${sections.join('\n\n')}\n`;
}

async function latestReport(block) {
  const directory = path.join(projectRoot, 'reports');
  const entries = await readdir(directory, { withFileTypes: true });
  const prefix = block ? `report-${block}-` : 'report-';
  const names = entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json'))
    .map((entry) => entry.name).sort().reverse();
  if (!names.length) throw new Error(block ? `未找到区块 ${block} 的报告。` : 'reports/ 下未找到 report-*.json 报告。');
  return path.join(directory, names[0]);
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    help: { type: 'boolean' }, report: { type: 'string' }, block: { type: 'string' }, out: { type: 'string' },
  } });
  if (values.help) { console.log(usage); return; }
  for (const option of ['report', 'block', 'out']) {
    if (values[option] !== undefined && !values[option].trim()) throw new Error(`--${option} 不能为空。`);
  }
  const reportPath = values.report ? path.resolve(values.report) : await latestReport(values.block);
  if (!(await stat(reportPath)).isFile()) throw new Error('报告路径必须是文件。');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (!Array.isArray(report?.checks)) throw new Error('报告格式无效：checks 必须是数组。');
  const output = formatImpact(path.basename(reportPath), classifySkips(report.checks));
  if (values.out) {
    const outPath = path.resolve(values.out);
    if (outPath === reportPath) throw new Error('输出路径不能与输入报告相同。');
    await writeFile(outPath, output, 'utf8');
  }
  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[缺数据影响汇总] ${error.code?.startsWith('ERR_PARSE_ARGS') ? `参数无效，请用 --help 查看用法。` : error.code ? `操作失败（${error.code}），请检查文件路径和权限。` : error instanceof SyntaxError ? '报告不是有效的 JSON。' : error.message}`);
    process.exitCode = 1;
  });
}
