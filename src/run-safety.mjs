import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export class RunTimeoutError extends Error {
  constructor(message, status = 'env-timeout') {
    super(message);
    this.name = 'RunTimeoutError';
    this.envStatus = status;
  }
}

export async function retryWithEnvironmentRecovery(action, recover, isClosed) {
  let recovery = null;
  if (isClosed()) recovery = await recover();
  try {
    return { value: await action(recovery), recovery };
  } catch (error) {
    if (recovery || !isClosed(error)) throw error;
    recovery = await recover(error);
    return { value: await action(recovery), recovery };
  }
}

export async function withTimeout(operation, timeoutMs, label = '操作', { onTimeout, settleMs = 10_000 } = {}) {
  let timer;
  const work = Promise.resolve().then(operation);
  // A timed-out Playwright promise must not keep mutating while recovery
  // opens a replacement browser. Closing the browser interrupts its actions;
  // wait briefly for that promise to unwind before returning the timeout.
  work.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RunTimeoutError(`${label}超过 ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    if (!(error instanceof RunTimeoutError)) throw error;
    let abortTimer;
    await Promise.race([
      Promise.resolve().then(() => onTimeout?.(error)).catch(() => {}),
      new Promise((resolve) => { abortTimer = setTimeout(resolve, 10_000); abortTimer.unref?.(); }),
    ]);
    clearTimeout(abortTimer);
    let settleTimer;
    await Promise.race([work.catch(() => {}), new Promise((resolve) => {
      settleTimer = setTimeout(resolve, settleMs);
      settleTimer.unref?.();
    })]);
    clearTimeout(settleTimer);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createPauseDetector({ intervalMs = 10_000, pauseThresholdMs = 30_000,
  wallNow = Date.now, monotonicNow = () => performance.now(), onPause = () => {} } = {}) {
  let previousWall = wallNow();
  let previousMonotonic = monotonicNow();
  let paused = false;
  const sample = () => {
    const wall = wallNow();
    const monotonic = monotonicNow();
    const discrepancy = (wall - previousWall) - (monotonic - previousMonotonic);
    previousWall = wall;
    previousMonotonic = monotonic;
    if (!paused && discrepancy > pauseThresholdMs) {
      paused = true;
      onPause({ discrepancyMs: discrepancy, detectedAt: new Date(wall).toISOString() });
    }
    return { paused, discrepancyMs: discrepancy };
  };
  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  return { sample, isPaused: () => paused, stop: () => clearInterval(timer) };
}

export async function writeCheckpoint(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
}

export function checksToResume(checks, completedIds = []) {
  const completed = new Set(completedIds);
  return checks.filter((check) => !completed.has(check.id));
}

export function createProgressWatchdog({ timeoutMs, onTimeout, now = Date.now } = {}) {
  let lastProgressAt = now();
  let stopped = false;
  let triggered = false;
  const timer = setInterval(() => {
    if (!stopped && !triggered && now() - lastProgressAt >= timeoutMs) {
      triggered = true;
      onTimeout({ lastProgressAt });
    }
  }, Math.min(10_000, Math.max(1000, timeoutMs / 10)));
  timer.unref?.();
  return {
    progress: () => { lastProgressAt = now(); triggered = false; },
    stop: () => { stopped = true; clearInterval(timer); },
    lastProgress: () => lastProgressAt,
  };
}
