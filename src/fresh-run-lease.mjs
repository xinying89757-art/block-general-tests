import { acquireLease, renewLease, releaseLease } from './lease.mjs';

export function acquireFreshRunLease({ siteHost, runId, acquire = acquireLease, renew = renewLease, releaseLeaseFn = releaseLease }) {
  const result = acquire(`site:${siteHost}`, { runId });
  if (!result.acquired) throw new Error(`站点 lease 已被占用，持有者 runId=${result.holder.runId}。`);
  let lease = result.lease;
  let renewalError = null;
  const timer = setInterval(() => { try { lease = renew(lease); } catch (error) { renewalError = error; } }, 60_000);
  timer.unref();
  let released = false;
  return {
    assertValid() { if (renewalError) throw renewalError; },
    release() {
      if (released) return;
      released = true;
      clearInterval(timer);
      return releaseLeaseFn(lease);
    },
  };
}
