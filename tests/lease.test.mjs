import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { acquireLease, renewLease, releaseLease, checkLease, leaseFilePath, defaultOwnerId, LeaseConflictError } from '../src/lease.mjs';

const resourceKey = 'site:en-site79106751.ldwebsite.com';
const cliPath = fileURLToPath(new URL('../scripts/lease.mjs', import.meta.url));

/**
 * 为每个用例隔离目录与机器标识，结束时恢复环境并删除临时文件。
 * @param {import('node:test').TestContext} t 测试上下文。
 * @returns {string} 临时目录。
 */
function isolate(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'lease-test-'));
  const previous = { LEASE_DIR: process.env.LEASE_DIR, MACHINE_ID: process.env.MACHINE_ID };
  process.env.LEASE_DIR = directory;
  process.env.MACHINE_ID = 'vm-test';
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

/**
 * @param {...string} args CLI 参数，自动继承当前用例的隔离目录。
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 子进程结果。
 */
function cli(...args) {
  // 输出落临时文件，兼容对子进程管道有限制的运行环境。
  const directory = mkdtempSync(path.join(process.env.LEASE_DIR, 'cli-'));
  const stdoutPath = path.join(directory, 'stdout');
  const stderrPath = path.join(directory, 'stderr');
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  try {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      stdio: ['ignore', stdout, stderr], env: { ...process.env },
    });
    assert.ifError(result.error);
    return { ...result, stdout: readFileSync(stdoutPath, 'utf8'), stderr: readFileSync(stderrPath, 'utf8') };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
    rmSync(directory, { recursive: true, force: true });
  }
}

test('acquire 成功：字段齐全、epoch=1、私有文件且没有临时文件残留', (t) => {
  const directory = isolate(t);
  const now = Date.now();
  const result = acquireLease(resourceKey);
  assert.equal(result.acquired, true);
  assert.deepEqual(Object.keys(result.lease).sort(), ['resourceKey', 'ownerId', 'runId', 'epoch', 'expiresAt', 'heartbeatAt'].sort());
  assert.equal(result.lease.resourceKey, resourceKey);
  assert.equal(result.lease.ownerId, 'vm-test');
  assert.match(result.lease.runId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(result.lease.epoch, 1);
  assert.ok(result.lease.heartbeatAt >= now);
  assert.equal(result.lease.expiresAt - result.lease.heartbeatAt, 300_000);
  const file = leaseFilePath(resourceKey);
  assert.equal(existsSync(file), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), result.lease);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), [path.basename(file)]);
});

test('未过期且被他人持有时拒绝 acquire，保留持有者文件', (t) => {
  isolate(t);
  const { lease } = acquireLease(resourceKey, { ownerId: 'mac-other', runId: 'other-run' });
  assert.deepEqual(acquireLease(resourceKey), { acquired: false, holder: lease });
  assert.deepEqual(checkLease(resourceKey).lease, lease);
});

test('到期边界允许接管，保留递增 epoch', (t) => {
  isolate(t);
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const { lease } = acquireLease(resourceKey, { ownerId: 'mac-other', ttlMs: 1 });
  now = lease.expiresAt;
  assert.equal(checkLease(resourceKey).expired, true);
  const next = acquireLease(resourceKey, { runId: 'takeover-run' });
  assert.equal(next.acquired, true);
  assert.equal(next.lease.epoch, lease.epoch + 1);
  assert.equal(next.lease.ownerId, 'vm-test');
  assert.equal(next.lease.runId, 'takeover-run');
});

test('同 owner 重入成功，epoch 递增且 expiresAt 延后', (t) => {
  isolate(t);
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const first = acquireLease(resourceKey, { runId: 'run-a' });
  now += 1000;
  const second = acquireLease(resourceKey, { runId: 'run-b' });
  assert.equal(second.acquired, true);
  assert.equal(second.lease.epoch, first.lease.epoch + 1);
  assert.ok(second.lease.expiresAt > first.lease.expiresAt);
});

test('renew 更新心跳和有效期，保持 epoch 并持久化', (t) => {
  isolate(t);
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const { lease } = acquireLease(resourceKey);
  now += 2000;
  const updated = renewLease(lease, { ttlMs: 400_000 });
  assert.equal(updated.heartbeatAt, now);
  assert.equal(updated.expiresAt, now + 400_000);
  assert.equal(updated.epoch, lease.epoch);
  assert.equal(updated.runId, lease.runId);
  assert.equal(lease.heartbeatAt, 10_000);
  assert.deepEqual(checkLease(resourceKey).lease, updated);
});

test('renew 拒绝旧 epoch，抛 LeaseConflictError 且不覆盖新 lease', (t) => {
  isolate(t);
  const first = acquireLease(resourceKey);
  const second = acquireLease(resourceKey);
  assert.throws(() => renewLease(first.lease), { name: 'LeaseConflictError' });
  assert.throws(() => renewLease(first.lease), LeaseConflictError);
  assert.deepEqual(checkLease(resourceKey).lease, second.lease);
});

test('release 成功删除文件，再次释放返回原因', (t) => {
  isolate(t);
  const { lease } = acquireLease(resourceKey);
  assert.deepEqual(releaseLease(lease), { released: true });
  assert.equal(existsSync(leaseFilePath(resourceKey)), false);
  const again = releaseLease(lease);
  assert.equal(again.released, false);
  assert.match(again.reason, /不存在/);
});

test('非 owner 释放抛错且保留文件', (t) => {
  isolate(t);
  const { lease } = acquireLease(resourceKey);
  assert.throws(() => releaseLease({ ...lease, ownerId: 'mac-other' }), /只有.*owner/);
  assert.deepEqual(checkLease(resourceKey).lease, lease);
});

test('checkLease 覆盖不存在、自持未过期、他持和损坏文件', (t) => {
  isolate(t);
  assert.deepEqual(checkLease(resourceKey), { exists: false, lease: null, expired: false, heldBySelf: false });
  const { lease } = acquireLease(resourceKey);
  assert.deepEqual(checkLease(resourceKey), { exists: true, lease, expired: false, heldBySelf: true });
  process.env.MACHINE_ID = 'mac-other';
  assert.equal(checkLease(resourceKey).heldBySelf, false);
  writeFileSync(leaseFilePath(resourceKey), '{损坏');
  assert.deepEqual(checkLease(resourceKey), { exists: false, lease: null, expired: false, heldBySelf: false, corrupt: true });
});

test('旧 epoch 不能释放新 lease', (t) => {
  isolate(t);
  const first = acquireLease(resourceKey);
  const second = acquireLease(resourceKey);
  const result = releaseLease(first.lease);
  assert.equal(result.released, false);
  assert.match(result.reason, /epoch/);
  assert.deepEqual(checkLease(resourceKey).lease, second.lease);
});

test('renew 拒绝不存在、损坏、owner 或 runId 不匹配的凭证', (t) => {
  isolate(t);
  const { lease } = acquireLease(resourceKey);
  assert.throws(() => renewLease({ ...lease, ownerId: 'other' }), LeaseConflictError);
  assert.throws(() => renewLease({ ...lease, runId: 'other' }), LeaseConflictError);
  writeFileSync(leaseFilePath(resourceKey), 'null');
  assert.throws(() => renewLease(lease), LeaseConflictError);
  assert.equal(releaseLease(lease).released, false);
  rmSync(leaseFilePath(resourceKey));
  assert.throws(() => renewLease(lease), LeaseConflictError);
});

test('损坏 JSON 及不完整记录可接管，重新建立 epoch=1', (t) => {
  isolate(t);
  for (const content of ['{', 'null', '{}', '{"epoch":1}']) {
    writeFileSync(leaseFilePath(resourceKey), content);
    assert.equal(checkLease(resourceKey).corrupt, true);
    const result = acquireLease(resourceKey);
    assert.equal(result.acquired, true);
    assert.equal(result.lease.epoch, 1);
  }
});

test('路径安全替换、默认目录与 LEASE_DIR 按调用读取', (t) => {
  const directory = isolate(t);
  assert.equal(leaseFilePath('site:ABC/a:b'), path.join(directory, 'site_____a_b.json'));
  process.env.LEASE_DIR = path.join(directory, 'nested');
  const { lease } = acquireLease(resourceKey);
  assert.equal(existsSync(path.join(directory, 'nested', path.basename(leaseFilePath(resourceKey)))), true);
  assert.deepEqual(checkLease(resourceKey).lease, lease);
  delete process.env.LEASE_DIR;
  assert.equal(leaseFilePath(resourceKey), path.join(homedir(), '.cache', 'block-general-tests', 'leases', 'site_en-site79106751.ldwebsite.com.json'));
});

test('默认 owner 使用 MACHINE_ID，未配置时回退 hostname', (t) => {
  isolate(t);
  assert.equal(defaultOwnerId(), 'vm-test');
  delete process.env.MACHINE_ID;
  assert.equal(defaultOwnerId(), hostname());
  assert.equal(acquireLease(resourceKey).lease.ownerId, hostname());
});

test('无效 TTL 不创建或修改 lease', (t) => {
  isolate(t);
  for (const ttlMs of [0, -1, NaN, Infinity]) assert.throws(() => acquireLease(resourceKey, { ttlMs }), /ttlMs/);
  assert.equal(checkLease(resourceKey).exists, false);
  const { lease } = acquireLease(resourceKey);
  assert.throws(() => renewLease(lease, { ttlMs: 0 }), /ttlMs/);
  assert.deepEqual(checkLease(resourceKey).lease, lease);
});

test('CLI acquire 支持两种参数形式，拒绝他持并展示持有者', (t) => {
  isolate(t);
  const first = cli('acquire', '--resource', resourceKey, '--owner=mac-cli', '--ttl', '400000');
  assert.equal(first.status, 0, first.stderr);
  const lease = JSON.parse(first.stdout);
  assert.equal(lease.ownerId, 'mac-cli');
  assert.equal(lease.expiresAt - lease.heartbeatAt, 400_000);
  const denied = cli('acquire', `--resource=${resourceKey}`);
  assert.equal(denied.status, 1);
  assert.ok(denied.stderr.includes(`ownerId=${lease.ownerId}`));
  assert.ok(denied.stderr.includes(`runId=${lease.runId}`));
  assert.ok(denied.stderr.includes(new Date(lease.expiresAt).toLocaleString()));
});

test('CLI release 校验显式和默认 owner，空 lease 成功退出', (t) => {
  isolate(t);
  assert.equal(cli('release', '--resource', resourceKey).status, 0);
  const { lease } = acquireLease(resourceKey, { ownerId: 'mac-cli' });
  assert.equal(cli('release', '--resource', resourceKey).status, 1);
  assert.equal(cli('release', '--resource', resourceKey, '--owner=wrong').status, 1);
  assert.deepEqual(checkLease(resourceKey).lease, lease);
  const released = cli('release', '--resource', resourceKey, '--owner', 'mac-cli');
  assert.equal(released.status, 0, released.stderr);
  assert.match(released.stdout, /"released":true/);
  assert.equal(checkLease(resourceKey).exists, false);
  acquireLease(resourceKey);
  assert.equal(cli('release', '--resource', resourceKey).status, 0);
  assert.equal(checkLease(resourceKey).exists, false);
});

test('CLI status 显示 epoch、过期、剩余秒数和损坏标记', (t) => {
  isolate(t);
  const missing = cli('status', '--resource', resourceKey);
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /不存在.*corrupt=false/);
  const { lease } = acquireLease(resourceKey, { ttlMs: 400_000 });
  const active = cli('status', '--resource', resourceKey);
  assert.equal(active.status, 0);
  for (const value of [`ownerId=${lease.ownerId}`, `runId=${lease.runId}`, 'epoch=1', '已过期=false', 'corrupt=false']) {
    assert.ok(active.stdout.includes(value), active.stdout);
  }
  const seconds = Number(/剩余秒数=(\d+)/.exec(active.stdout)[1]);
  assert.ok(seconds > 0 && seconds <= 400);
  writeFileSync(leaseFilePath(resourceKey), JSON.stringify({ ...lease, expiresAt: Date.now() - 1 }));
  const expired = cli('status', '--resource', resourceKey);
  assert.equal(expired.status, 0);
  assert.match(expired.stdout, /已过期=true 剩余秒数=0/);
  writeFileSync(leaseFilePath(resourceKey), '{');
  const corrupt = cli('status', '--resource', resourceKey);
  assert.equal(corrupt.status, 0);
  assert.match(corrupt.stdout, /corrupt=true/);
});

test('CLI clear 保护未过期 lease，force 警告，允许清理过期或损坏文件', (t) => {
  isolate(t);
  const { lease } = acquireLease(resourceKey);
  const denied = cli('clear', '--resource', resourceKey);
  assert.equal(denied.status, 1);
  assert.deepEqual(checkLease(resourceKey).lease, lease);
  const forced = cli('clear', '--resource', resourceKey, '--force');
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stderr, /警告.*未过期/);
  assert.equal(existsSync(leaseFilePath(resourceKey)), false);
  writeFileSync(leaseFilePath(resourceKey), JSON.stringify({ ...lease, expiresAt: Date.now() - 1 }));
  assert.equal(cli('clear', '--resource', resourceKey).status, 0);
  writeFileSync(leaseFilePath(resourceKey), '{');
  const corrupt = cli('clear', '--resource', resourceKey);
  assert.equal(corrupt.status, 0, corrupt.stderr);
  assert.match(corrupt.stdout, /corrupt=true/);
  assert.equal(existsSync(leaseFilePath(resourceKey)), false);
  assert.equal(cli('clear', '--resource', resourceKey).status, 0);
});

test('CLI help、必填参数、未知命令与无效 TTL', (t) => {
  isolate(t);
  for (const args of [['--help'], ['acquire', '--help']]) {
    const help = cli(...args);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /用法/);
  }
  for (const command of ['acquire', 'release', 'status', 'clear']) {
    const missing = cli(command);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /缺少 --resource/);
  }
  for (const args of [[], ['unknown'], ['acquire', '--resource'], ['status', '--resource='],
    ['acquire', '--resource', resourceKey, '--ttl=abc'], ['acquire', '--resource', resourceKey, '--ttl=0'],
    ['status', '--resource', resourceKey, '--unknown']]) {
    const invalid = cli(...args);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /用法/);
  }
  assert.equal(checkLease(resourceKey).exists, false);
});
