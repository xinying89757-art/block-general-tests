/**
 * 站点级共享 lease 的文件后端；生产环境可替换为 Redis/DB，接口不变。
 * 跨机器须使用同一共享 LEASE_DIR；普通网盘同步文件和 git 不适合作锁。
 * 临时文件加 rename 只保证整份 JSON 原子替换，不提供读改写的 CAS；
 * 严格并发仲裁须由支持事务/CAS 的共享后端实现。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * @typedef {object} Lease
 * @property {string} resourceKey 站点资源键。
 * @property {string} ownerId 持有机器标识。
 * @property {string} runId 本次运行标识。
 * @property {number} epoch 每次取得 lease 递增的 fencing token。
 * @property {number} expiresAt 到期时间（毫秒）。
 * @property {number} heartbeatAt 最后心跳时间（毫秒）。
 */

/** lease 已被接管或丢失，调用方不得继续视其为有效写入凭证。 */
export class LeaseConflictError extends Error {
  /** @param {string} message 冲突原因。 */
  constructor(message) {
    super(message);
    this.name = 'LeaseConflictError';
  }
}

/**
 * 计算存储路径；每次调用读取 LEASE_DIR，便于机器配置与测试隔离。
 * @param {string} resourceKey 资源键。
 * @returns {string} lease JSON 的路径。
 */
export function leaseFilePath(resourceKey) {
  const dir = process.env.LEASE_DIR || path.join(homedir(), '.cache', 'block-general-tests', 'leases');
  const safeKey = String(resourceKey).replace(/[^a-z0-9.-]/g, '_');
  return path.join(dir, `${safeKey}.json`);
}

/** @returns {string} 环境指定的机器标识，默认使用主机名。 */
export function defaultOwnerId() {
  return process.env.MACHINE_ID || hostname();
}

/**
 * 读取并校验记录；仅不存在或损坏可视为无 lease，权限等 I/O 错误继续抛出。
 * @param {string} resourceKey 资源键。
 * @returns {{ lease: Lease|null, corrupt?: boolean }} 记录及损坏标记。
 */
function readLease(resourceKey) {
  let content;
  try { content = readFileSync(leaseFilePath(resourceKey), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { lease: null };
    throw error;
  }
  let lease;
  try { lease = JSON.parse(content); }
  catch { return { lease: null, corrupt: true }; }
  if (!lease || lease.resourceKey !== resourceKey
    || typeof lease.ownerId !== 'string' || !lease.ownerId
    || typeof lease.runId !== 'string' || !lease.runId
    || !Number.isSafeInteger(lease.epoch) || lease.epoch < 1
    || !Number.isFinite(lease.expiresAt) || !Number.isFinite(lease.heartbeatAt)) {
    return { lease: null, corrupt: true };
  }
  return { lease };
}

/**
 * 在同目录以私有权限写临时文件，再原子替换，失败时清理临时文件。
 * @param {Lease} lease 待写入记录。
 * @returns {void}
 */
function writeLease(lease) {
  const file = leaseFilePath(lease.resourceKey);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(lease, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

/**
 * @param {number} ttlMs 有效期（毫秒），必须为有限正数。
 * @returns {void}
 */
function validateTtl(ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('lease 的 ttlMs 必须为正数（毫秒）。');
}

/**
 * 取得、重入或接管 lease。到期仅允许进入接管核查，不能假定旧端已经停止。
 * epoch 递增即 fencing token；Leadong 若不接受此 token，接管仍须检查旧端退出、
 * 等待在途写入完成并重新回读，才可开始新的站点写入。
 * @param {string} resourceKey 资源键。
 * @param {{ ttlMs?: number, ownerId?: string, runId?: string }} [options] 取得参数。
 * @returns {{ acquired: true, lease: Lease }|{ acquired: false, holder: Lease }} 取得结果。
 */
export function acquireLease(resourceKey, { ttlMs = 300_000, ownerId = defaultOwnerId(), runId = randomUUID() } = {}) {
  validateTtl(ttlMs);
  const { lease: previous } = readLease(resourceKey);
  const now = Date.now();
  if (previous && now < previous.expiresAt && previous.ownerId !== ownerId) {
    return { acquired: false, holder: previous };
  }
  const lease = { resourceKey, ownerId, runId, epoch: previous ? previous.epoch + 1 : 1,
    expiresAt: now + ttlMs, heartbeatAt: now };
  writeLease(lease);
  return { acquired: true, lease };
}

/**
 * 续租前重新检查 epoch，避免旧凭证在接管/重入后覆盖新记录。
 * @param {Lease} lease 当前持有凭证。
 * @param {{ ttlMs?: number }} [options] 续租有效期。
 * @returns {Lease} 更新后的凭证。
 * @throws {LeaseConflictError} 记录不存在、损坏或持有凭证不匹配。
 */
export function renewLease(lease, { ttlMs = 300_000 } = {}) {
  validateTtl(ttlMs);
  const { lease: current } = readLease(lease.resourceKey);
  if (!current || current.epoch !== lease.epoch || current.ownerId !== lease.ownerId || current.runId !== lease.runId) {
    throw new LeaseConflictError(`lease 已丢失或被接管：${lease.resourceKey}，epoch=${lease.epoch}。`);
  }
  const now = Date.now();
  const updated = { ...current, heartbeatAt: now, expiresAt: now + ttlMs };
  writeLease(updated);
  return updated;
}

/**
 * 仅允许同 epoch 的 owner 释放；旧凭证不能删除接管者的记录。
 * @param {Lease} lease 当前持有凭证。
 * @returns {{ released: boolean, reason?: string }} 是否释放及未释放的原因。
 */
export function releaseLease(lease) {
  const { lease: current, corrupt } = readLease(lease.resourceKey);
  if (!current) return { released: false, reason: corrupt ? 'lease 文件损坏' : 'lease 不存在' };
  if (current.epoch !== lease.epoch) return { released: false, reason: 'epoch 不一致，lease 已被接管或重入' };
  if (current.ownerId !== lease.ownerId) throw new LeaseConflictError('只有 lease 的 owner 能释放。');
  unlinkSync(leaseFilePath(lease.resourceKey));
  return { released: true };
}

/**
 * 检查当前状态；损坏的文件视为不存在，并附带 corrupt 标记。
 * @param {string} resourceKey 资源键。
 * @returns {{ exists: boolean, lease: Lease|null, expired: boolean, heldBySelf: boolean, corrupt?: boolean }} 状态。
 */
export function checkLease(resourceKey) {
  const { lease, corrupt } = readLease(resourceKey);
  return { exists: Boolean(lease), lease, expired: lease ? Date.now() >= lease.expiresAt : false,
    heldBySelf: lease ? lease.ownerId === defaultOwnerId() : false, ...(corrupt ? { corrupt: true } : {}) };
}
