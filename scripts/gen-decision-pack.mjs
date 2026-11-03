import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const usage = `用法：node scripts/gen-decision-pack.mjs [--help] [--out <path>]

只读扫描画像、MEMORY、代码注释、文档、最近报告及 Git 提交提示，生成待拍板清单。
  --out <path>  输出路径（相对当前工作目录）；默认 reports/decision-pack-YYYYMMDD.md
  --help        显示帮助，不扫描、不写文件

日期使用 UTC；最近报告按区块各取最新一份；已存在的输出不会覆盖，请另选 --out。
扫描提示不代表已确认缺陷。
输出仅包含凭据风险的位置，不读取 .env、登录态或 Git 补丁，不复制凭据。`;

const pending = /待确认|待审核|待定|待补|需.{0,12}(?:确认|定)|TODO|pending|unconfirmed|awaiting/i;
const secret = /凭据|密码|密钥|令牌|token|secret|password|credential|api.?key/i;
const rotation = /(?:需|待|必须|应).{0,12}(?:轮换|重置|更换)|已.{0,12}(?:泄露|泄漏|暴露|提交)|曾.{0,12}(?:泄露|泄漏|暴露|提交)|leaked|exposed|compromised|hard.?coded|(?:pending|must|need|required).{0,30}(?:rotat|reset)|rotat.{0,30}(?:pending|required|needed)/i;

// 证据仅记录路径与行号，避免把可能含敏感值的原始行写进决策包。
function text(value) {
  return String(value ?? '').replace(/[\r\n\t]/g, ' ').replace(/[\\`*_{}\[\]<>]/g, '\\$&');
}

function relative(file) {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

async function filesIn(directory, recursive = false) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isFile()) files.push(file);
      // 不跟随符号链接，不进入依赖、登录态或版本库。
      else if (recursive && entry.isDirectory() && !/^(?:node_modules|\.git|\.auth|fixtures|storageState.*)$/.test(entry.name)) {
        files.push(...await filesIn(file, true));
      }
    }
    return files;
  } catch (error) {
    console.warn(`[decision-pack] 无法扫描 ${relative(directory)}（${error.code || '读取失败'}），继续。`);
    return [];
  }
}

async function readJson(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    console.warn(`[decision-pack] ${relative(file)} 无法读取或 JSON 格式无效，已跳过。`);
    return null;
  }
}

// 按报告开始时间排序，避免旧运行的后续合并被误认为最新现场。
async function latestReports() {
  const reports = [];
  for (const file of await filesIn(path.join(projectRoot, 'reports'))) {
    if (!/^report-.+\.json$/.test(path.basename(file))) continue;
    const report = await readJson(file);
    if (!report) continue;
    const block = report.config?.blockId ?? report.profile?.blockId ?? report.blockId
      ?? path.basename(file).match(/^report-([^-]+)-/)?.[1];
    if (!block) continue;
    const timestamp = Date.parse(report.startedAt) || Date.parse(report.finishedAt) || (await stat(file)).mtimeMs;
    reports.push({ file, report, block: String(block), timestamp });
  }
  reports.sort((a, b) => b.timestamp - a.timestamp || b.file.localeCompare(a.file));
  const latest = new Map();
  for (const item of reports) if (!latest.has(item.block)) latest.set(item.block, item);
  return [...latest.values()];
}

async function sourceRecords() {
  const sources = new Map();
  for (const name of ['docs', 'src', 'scripts']) {
    for (const file of await filesIn(path.join(projectRoot, name), true)) {
      if (/\.(?:md|txt|mjs|js|ts)$/i.test(file) && file !== fileURLToPath(import.meta.url)) sources.set(file, true);
    }
  }
  // MEMORY 可能在仓库根目录，也可能放在本地智能体目录；只读取文本记忆文件。
  for (const file of await filesIn(projectRoot)) {
    if (/^memory(?:\.(?:md|txt))?$/i.test(path.basename(file))) sources.set(file, true);
  }
  for (const name of ['.agents', '.codex', 'memory', 'MEMORY']) {
    const directory = path.join(projectRoot, name);
    try { await stat(directory); } catch { continue; }
    for (const file of await filesIn(directory, true)) {
      if (/\.(?:md|txt)$/i.test(file) && /memory/i.test(relative(file))) sources.set(file, true);
    }
  }
  const records = [];
  for (const file of sources.keys()) {
    let content;
    try { content = await readFile(file, 'utf8'); }
    catch { console.warn(`[decision-pack] ${relative(file)} 无法读取，已跳过。`); continue; }
    const code = /\.(?:mjs|js|ts)$/.test(file);
    let inComment = false;
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      let comment = line;
      if (code) {
        const start = line.indexOf('/*');
        const single = line.indexOf('//');
        comment = inComment ? line : start >= 0 ? line.slice(start) : single >= 0 ? line.slice(single) : '';
        if (start >= 0) inComment = true;
        if (comment.includes('*/')) inComment = false;
      }
      records.push({ file, line: index + 1, content: code ? comment : line, code });
    }
  }
  return records;
}

function evidence(records) {
  const locations = [...new Set(records.map((r) => `${relative(r.file)}${r.line ? `:${r.line}` : ''}`))];
  return locations.slice(0, 12).map(text).join('；') + (locations.length > 12 ? `；另有 ${locations.length - 12} 处` : '');
}

function scope(records, fallback) {
  const blocks = [...new Set(records.flatMap((r) => `${relative(r.file)} ${r.content || ''}`.match(/\b\d{5}\b/g) || []))];
  return blocks.length ? `区块 ${blocks.map(text).join('、')}` : fallback;
}

function section(number, item) {
  return `## [${number}] ${item.title}

- **问题**：${item.problem}
- **证据**：${item.evidence}
- **建议选项**：
  - A. ${item.a}
  - B. ${item.b}
- **阻塞范围**：${item.scope}
- **决定**：_（待填写：选 A/B/其他）_
`;
}

async function main() {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, out: { type: 'string' } } });
  if (values.help) { console.log(usage); return; }
  if (values.out !== undefined && !values.out.trim()) throw new Error('--out 不能为空。');
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const out = values.out ? path.resolve(values.out) : path.join(projectRoot, 'reports', `decision-pack-${date}.md`);
  if (!/\.md$/i.test(out)) throw new Error('--out 必须是 Markdown（.md）文件，避免覆盖画像或报告 JSON。');
  const items = [];
  for (const file of await filesIn(path.join(projectRoot, 'profiles'))) {
    if (!file.endsWith('.json') || path.basename(file) === 'TEMPLATE.json') continue;
    const profile = await readJson(file);
    if (profile?.onboarding?.status !== 'draft-unreviewed') continue;
    const block = text(profile.blockId ?? path.basename(file, '.json'));
    const count = Array.isArray(profile.capabilities) ? profile.capabilities.length : 0;
    items.push({ title: `审核画像 ${block}`, problem: `画像 ${block} 尚未审核，能力数量 ${count}，discoveredAt：${text(profile.onboarding.discoveredAt || '未记录')}。`,
      evidence: text(relative(file)), scope: `区块 ${block} 的 ${count} 项能力及后续回归`,
      a: '逐项审核并补齐预期与夹具（后果：审核完成后可用于正式回归）',
      b: '暂缓接入并保留草稿（后果：该区块继续阻塞）' });
  }
  const records = await sourceRecords();
  const reports = await latestReports();
  const figma = records.filter((r, index) => (r.code || /memory/i.test(relative(r.file))) && pending.test(r.content)
    && records.slice(Math.max(0, index - 2), index + 3)
      .some((nearby) => nearby.file === r.file && /figma|节点|node[-_ ]?id/i.test(nearby.content)));
  const nodes = [...new Set(figma.flatMap((r) => {
    const context = records.filter((nearby) => nearby.file === r.file && Math.abs(nearby.line - r.line) <= 2)
      .map((nearby) => nearby.content).join(' ');
    return [...context.matchAll(/(?:node[-_ ]?id\s*[=:]?\s*["']?|节点(?:号|\s*ID)?\s*[:：=]?\s*["']?)(\d+[:-]\d+)|\b(\d{2,}:\d+)\b/gi)]
      .map((match) => (match[1] || match[2]).replace('-', ':'));
  }))];
  items.push({ title: '确认 Figma 节点与映射',
    problem: figma.length ? `发现设计节点或映射的待确认提示${nodes.length ? `（节点 ${nodes.join('、')}）` : ''}，请核实节点及断言级别。` : '未自动找到待确认的 Figma 节点，需手动补充。',
    evidence: evidence(figma) || 'MEMORY / 代码注释未发现匹配记录；需手动补充',
    scope: scope(figma, '待补充目标区块的 block-style-spec / 设计断言'),
    a: '确认节点、DOM 映射及断言级别（后果：可继续完善设计检查）',
    b: '暂缓设计断言（后果：相关样式检查继续跳过或仅记录）' });

  const widths = records.filter((r) => !r.code && relative(r.file).startsWith('docs/')
    && /1440(?:\s*px)?/i.test(r.content) && /全屏|fullscreen|待定|待确认|需用户定|缺陷|上限|封顶|问题/i.test(r.content));
  for (const { file, report } of reports) {
    for (const check of Array.isArray(report.checks) ? report.checks : []) {
      if (!check || !['fail', 'skip', 'human-review', 'record'].includes(check.status)) continue;
      const content = JSON.stringify(check);
      if (/1440/.test(content) && /全屏|fullscreen|宽度|width/i.test(content)) widths.push({ file, content: '' });
    }
  }
  items.push({ title: '确定 1440px 问题的判定口径',
    problem: widths.length ? '发现 1440px / 全屏宽度相关问题记录，需负责人确认是否作为缺陷。' : '未发现 1440px 待定问题记录，需手动补充或确认无待办。',
    evidence: evidence(widths) || 'docs/ 与最近报告未发现匹配记录', scope: scope(widths, '模块宽度（module-width）及相关区块'),
    a: '按现有全屏预期登记缺陷（后果：保留失败结论并安排修复复测）',
    b: '逐条确认平台限制及新预期（后果：仅在人工批准后调整对应断言）' });

  const credentials = records.filter((r) => !r.code && secret.test(r.content) && rotation.test(r.content));
  let commits = [];
  try {
    const { stdout } = await exec('git', ['log', '--all', '-n', '500', '--format=%h%x09%s'], { cwd: projectRoot, timeout: 10000, maxBuffer: 1024 * 1024 });
    commits = stdout.split('\n').filter((line) => secret.test(line) && rotation.test(line))
      .map((line) => line.split('\t')[0]).filter((hash) => /^[a-f0-9]+$/.test(hash));
  } catch { console.warn('[decision-pack] Git 历史不可用，仅扫描文档提示。'); }
  items.push({ title: '核实凭据轮换',
    problem: credentials.length || commits.length ? '需轮换；发现历史风险提示，轮换是否完成仍需人工确认。' : '未发现明确的待轮换提示，需手动核实；未扫描凭据内容。',
    evidence: [evidence(credentials), ...commits.slice(0, 12).map((hash) => `Git 提交 ${hash}（仅风险提示）`)].filter(Boolean).join('；') || '文档 / 最近 500 条 Git 提交未发现匹配提示',
    scope: '使用相关凭据的站点登录、Figma 访问或测试环境（待负责人核实）',
    a: '轮换并仅在本机更新配置（后果：旧凭据失效，相关登录态可能需重新生成）',
    b: '提供已轮换或无需轮换的确认记录（后果：核实后可关闭此待办）' });

  const imageIssues = [];
  for (const { file, report, block } of reports) {
    for (const check of Array.isArray(report.checks) ? report.checks : []) {
      if (!check || !['skip', 'fail'].includes(check.status)) continue;
      const content = [check.id, check.name, check.description, check.actual, check.detail, check.evidenceText].map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(' ');
      if (!/图片|图像|image|\bimg\b|(?:^|[-_])img[-_]/i.test(content)) continue;
      imageIssues.push({ file, content: block });
      items.push({ title: `确认区块 ${text(block)} 的前台图片（${text(check.id || '未编号检查')}）`,
        problem: `最近报告中的图片相关检查状态为 ${text(check.status)}，需核实素材、加载环境及预期。`,
        evidence: `${text(relative(file))}，检查 ID：${text(check.id || '未记录')}`, scope: `区块 ${text(block)} 的前台图片 / ${text(check.id || '图片检查')}`,
        a: '确认素材及预期后复测（后果：可区分真实图片问题与环境问题）',
        b: '暂缓人工确认（后果：保留原 skip/fail，不视为通过）' });
    }
  }
  const content = `# 业务流程决策包\n\n生成时间：${now.toISOString()}（UTC）\n\n以下为自动发现的待办线索；决定栏由负责人填写，脚本不修改画像、断言或测试状态。\n\n${items.map((item, i) => section(i + 1, item)).join('\n')}\n扫描说明：${reports.length ? `已检查 ${reports.length} 个区块各自最新的报告。` : '没有可用的最近报告。'}${imageIssues.length ? '' : '未发现前台图片相关 skip/fail；如有现场问题，需手动补充。'}\n`;
  await mkdir(path.dirname(out), { recursive: true });
  // 防止重复执行覆盖负责人已经填写的决定。
  await writeFile(out, content, { encoding: 'utf8', flag: 'wx' });
  console.log(`决策包：${out}（${items.length} 项）`);
  try {
    const { stdout } = await exec('git', ['check-ignore', '--', out], { cwd: projectRoot, timeout: 10000 });
    if (stdout.trim()) console.warn('[decision-pack] 提醒：输出文件被 .gitignore 忽略，请单独交付；不会自动纳入提交。');
  } catch (error) {
    if (error.code !== 1) console.warn('[decision-pack] 无法确认输出路径的 Git 忽略状态，请手动运行 git check-ignore。');
  }
}

main().catch((error) => {
  console.error(`[decision-pack] ${error.code === 'EEXIST' ? '输出文件已存在；请用 --out 另选路径，以免覆盖已填写决定。' : error.code?.startsWith('ERR_PARSE_ARGS') ? `${error.message}\n${usage}` : error.code ? `操作失败（${error.code}），请检查目录和权限。` : error.message}`);
  process.exitCode = 1;
});
