import { hostname } from 'node:os';
import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function lockPath(site) {
  const dir = path.resolve(root, process.env.RUN_LOCK_DIR || '.run-lock');
  const key = String(site || 'unknown-site').toLowerCase().replace(/[^a-z0-9.-]/g, '_');
  return { dir, file: path.join(dir, `${key}.json`) };
}

function isFresh(lock) {
  const age = Date.now() - Date.parse(lock.startedAt);
  if (!Number.isFinite(age) || age > MAX_AGE_MS || age < -60_000) return false;
  if (lock.host === hostname()) {
    try { process.kill(Number(lock.pid), 0); }
    catch (error) { if (error.code === 'ESRCH') return false; }
  }
  return true;
}

export function acquireRunLock({ site, mode }) {
  const { dir, file } = lockPath(site);
  mkdirSync(dir, { recursive: true });
  const record = { host: hostname(), pid: process.pid, startedAt: new Date().toISOString(), mode };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try { writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`); } finally { closeSync(fd); }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(readFileSync(file, 'utf8'));
          if (current.host === record.host && current.pid === record.pid && current.startedAt === record.startedAt) unlinkSync(file);
        } catch { /* another process already cleaned up */ }
      };
      process.once('exit', release);
      return { record, release };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = JSON.parse(readFileSync(file, 'utf8')); } catch { existing = null; }
      if (existing && isFresh(existing)) {
        throw new Error(`同站点已有运行：${existing.mode}，host=${existing.host} pid=${existing.pid} startedAt=${existing.startedAt}。`);
      }
      try { unlinkSync(file); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') throw unlinkError; }
    }
  }
  throw new Error('运行锁竞争失败，请稍后重试。');
}
