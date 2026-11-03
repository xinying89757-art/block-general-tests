import { unlinkSync } from 'node:fs';
import { acquireLease, releaseLease, checkLease, defaultOwnerId, leaseFilePath } from '../src/lease.mjs';

const usage = `用法：
  node scripts/lease.mjs acquire --resource site:xxx [--owner ID] [--ttl 300000]
  node scripts/lease.mjs release --resource site:xxx [--owner ID]
  node scripts/lease.mjs status --resource site:xxx
  node scripts/lease.mjs clear --resource site:xxx [--force]
  node scripts/lease.mjs --help
参数支持 --key value 和 --key=value。
跨机器须共用 LEASE_DIR；普通网盘同步文件和 git 不适合作锁。`;

/**
 * 解析命令与选项，拒绝缺值或拼错的参数。
 * @param {string[]} argv 命令行参数。
 * @returns {{ command: string|undefined, options: Record<string, string|boolean> }} 解析结果。
 */
function parseArgs(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const match = /^--(resource|owner|ttl|force|help)(?:=(.*))?$/.exec(args[index]);
    if (!match) throw new Error(`未知参数：${args[index]}`);
    const [, key, inline] = match;
    if (key === 'force' || key === 'help') {
      if (inline !== undefined) throw new Error(`--${key} 不接受值。`);
      options[key] = true;
    } else {
      const value = inline ?? args[++index];
      if (!value || value.startsWith('--')) throw new Error(`--${key} 缺少值。`);
      options[key] = value;
    }
  }
  return { command, options };
}

/**
 * @param {import('../src/lease.mjs').Lease} lease 当前记录。
 * @returns {string} 适合终端阅读的持有者信息。
 */
function holderText(lease) {
  return `ownerId=${lease.ownerId} runId=${lease.runId} expiresAt=${new Date(lease.expiresAt).toLocaleString()}`;
}

/** @returns {void} 执行一次 lease 管理命令。 */
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { console.log(usage); return; }
  const { command, options } = parseArgs(argv);
  if (!['acquire', 'release', 'status', 'clear'].includes(command)) throw new Error('请指定 acquire、release、status 或 clear 命令。');
  if (!options.resource) throw new Error('缺少 --resource。');
  const resourceKey = options.resource;
  if (command === 'acquire') {
    const ttlMs = options.ttl === undefined ? 300_000 : Number(options.ttl);
    const result = acquireLease(resourceKey, { ownerId: options.owner || defaultOwnerId(), ttlMs });
    if (result.acquired) console.log(JSON.stringify(result.lease, null, 2));
    else {
      console.error(`[lease] 取得失败，当前持有者：${holderText(result.holder)}`);
      process.exitCode = 1;
    }
    return;
  }
  const status = checkLease(resourceKey);
  if (command === 'status') {
    if (!status.exists) console.log(`[lease] 不存在，corrupt=${Boolean(status.corrupt)}`);
    else console.log(`[lease] ${holderText(status.lease)} epoch=${status.lease.epoch} 已过期=${status.expired} 剩余秒数=${Math.max(0, Math.ceil((status.lease.expiresAt - Date.now()) / 1000))} corrupt=${Boolean(status.corrupt)}`);
    return;
  }
  if (command === 'release') {
    if (!status.exists) { console.log(`[lease] 无可释放的 lease，corrupt=${Boolean(status.corrupt)}`); return; }
    const ownerId = options.owner || defaultOwnerId();
    if (ownerId !== status.lease.ownerId) throw new Error(`只有 owner 能释放，当前持有者：${holderText(status.lease)}`);
    console.log(`[lease] ${JSON.stringify(releaseLease({ ...status.lease, ownerId }))}`);
    return;
  }
  if (status.exists && !status.expired && !options.force) {
    throw new Error(`lease 尚未过期，拒绝清理：${holderText(status.lease)}。确认旧端退出并等待在途写入后，才可使用 --force。`);
  }
  if (status.exists && !status.expired) console.warn('[lease] 警告：正在强制清理未过期 lease；必须确认旧端退出、等待在途写入并重新回读。');
  try { unlinkSync(leaseFilePath(resourceKey)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`[lease] 已清理 ${resourceKey}，corrupt=${Boolean(status.corrupt)}`);
}

try { main(); }
catch (error) {
  console.error(`[lease] ${error.message}\n${usage}`);
  process.exitCode = 1;
}
