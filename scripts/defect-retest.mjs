import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const statusFile = path.join(projectRoot, 'reports', 'defect-retest-status.json');
const statuses = ['待复测', '复测通过', '复测失败', '已关闭'];
const usage = `用法：
  node scripts/defect-retest.mjs list
  node scripts/defect-retest.mjs show <issue>
  node scripts/defect-retest.mjs update <issue> --status <状态> [--note <备注>]
  node scripts/defect-retest.mjs --help

本地跟踪 GitHub issues #14–#23，不调用 GitHub API。
状态：${statuses.join(' | ')}
issue 可写 14 或 '#14'（带 # 时请加引号）。备注含空格时请加引号。
状态文件：reports/defect-retest-status.json；首次有效操作自动初始化十条记录。
update 省略 --note 时保留已有备注；--note "" 可清空。时间使用 UTC。
示例：node scripts/defect-retest.mjs update 14 --status 复测通过 --note "Mac 前台验证通过"`;

function initialState() {
  return Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 14), {
    status: '待复测', title: '', note: '', updatedAt: '',
  }]));
}

async function loadState() {
  let content;
  try { content = await readFile(statusFile, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { state: initialState(), created: true };
  }
  let state;
  try { state = JSON.parse(content); }
  catch { throw new Error('状态文件 JSON 格式无效，请修复后重试；原文件已保留。'); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('状态文件必须是以 issue 编号为键的对象；原文件已保留。');
  for (const [issue, item] of Object.entries(state)) {
    if (!/^\d+$/.test(issue) || !item || typeof item !== 'object' || Array.isArray(item)
      || !statuses.includes(item.status) || ['title', 'note', 'updatedAt'].some((key) => typeof item[key] !== 'string')) {
      throw new Error('状态文件条目格式无效（需 status/title/note/updatedAt）；原文件已保留。');
    }
  }
  return { state, created: false };
}

// 临时文件 + 原子重命名防止中途打断写坏 JSON；锁避免两次更新互相覆盖。
async function saveState(state) {
  const temp = `${statusFile}.${process.pid}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8'); }
    finally { await file.close(); }
    await rename(temp, statusFile);
  } finally {
    await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, status: { type: 'string' }, note: { type: 'string' },
  } });
  if (values.help) { console.log(usage); return; }
  const [command, rawIssue] = positionals;
  if (!['list', 'show', 'update'].includes(command) || positionals.length !== (command === 'list' ? 1 : 2)) throw new Error(usage);
  const issue = rawIssue?.replace(/^#/, '');
  if (command !== 'list' && !/^(?:1[4-9]|2[0-3])$/.test(issue)) {
    throw new Error('issue 必须是 #14–#23；带 # 时请加引号。');
  }
  if (command === 'update' && !statuses.includes(values.status)) throw new Error(`--status 必须是：${statuses.join('、')}。`);
  if (command !== 'update' && (values.status !== undefined || values.note !== undefined)) throw new Error('--status 和 --note 仅可用于 update。');

  await mkdir(path.dirname(statusFile), { recursive: true });
  const lockPath = `${statusFile}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('状态文件正被其他进程使用；请稍后重试。若上次意外中断，确认无运行进程后删除 .lock 文件。');
    throw error;
  }
  try {
    const { state, created } = await loadState();
    if (command !== 'list' && !Object.hasOwn(state, issue)) throw new Error(`状态文件未跟踪 #${issue}，请先补齐该条目；原文件已保留。`);
    if (command === 'update') {
      state[issue] = { ...state[issue], status: values.status,
        note: values.note ?? state[issue].note, updatedAt: new Date().toISOString() };
    }
    if (created || command === 'update') await saveState(state);
    if (created) console.log('未找到状态文件，已初始化 #14–#23（标题与备注待填写）。');
    if (command === 'list') {
      // 表格单元格压平换行，详情仍保留完整备注。
      const cell = (value) => String(value || '—').replace(/[\r\n\t]/g, ' ').replaceAll('|', '\\|');
      console.log('| Issue | 状态 | 标题 | 备注 | 更新时间 |\n| --- | --- | --- | --- | --- |');
      for (const id of Object.keys(state).sort((a, b) => Number(a) - Number(b))) {
        const item = state[id];
        console.log(`| #${id} | ${cell(item.status)} | ${cell(item.title)} | ${cell(item.note)} | ${cell(item.updatedAt)} |`);
      }
    } else {
      const item = state[issue];
      console.log(`${command === 'update' ? '已更新 ' : ''}#${issue}\n状态：${item.status}\n标题：${item.title || '（待填写）'}\n备注：${item.note || '（无）'}\n更新时间：${item.updatedAt || '（尚未更新）'}`);
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error) => {
  console.error(`[defect-retest] ${error.code?.startsWith('ERR_PARSE_ARGS') ? `${error.message}\n${usage}` : error.code ? `状态文件操作失败（${error.code}），请检查 reports/ 目录及权限。` : error.message}`);
  process.exitCode = 1;
});
