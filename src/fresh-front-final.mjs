/** Add final public-page checks or compatible deferred rows to a fresh report. */
export async function runFinalFrontChecks({ report, mode, frontLink, page, runChecks, timestamp = Date.now() }) {
  const checks = [];
  const defer = (reason) => {
    // Keep existing deferred checks intact: they may belong to unrelated
    // preview-dependent assertions and must retain their original evidence.
    const rows = [{ id: 'fresh-front-style-checks', status: 'deferred', expected: 'Run the shared front-page style and effect checks after current-page publish.',
        actual: 'Front page could not be checked on this machine.', detail: reason, reason: { code: 'front-unavailable', message: reason } }];
    report.checks = [...(report.checks || []), ...rows];
    report.summary = countVerdicts(report.checks);
    return rows;
  };
  if (mode === 'published') {
    report.frontCheckStatus = 'deferred';
    report.frontCheckReason = '前台检查延期到 Mac；使用 merge:fresh-front 合并前台结果。';
    return { report, checks, status: 'deferred', url: null };
  }
  if (!frontLink) {
    const reason = '当前页面发布结果没有可用的前台地址；前台检查已延期，不计为失败。';
    defer(reason);
    report.frontCheckStatus = 'deferred';
    report.frontCheckReason = reason;
    return { report, checks, status: 'deferred', url: null };
  }
  const url = new URL(frontLink);
  url.searchParams.set('t', String(timestamp));
  try {
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (response && !response.ok()) throw new Error(`Front page returned HTTP ${response.status()}.`);
  } catch {
    const reason = '当前机器无法加载发布后的前台页面；前台检查已延期，不计为失败。';
    defer(reason);
    report.frontCheckStatus = 'deferred';
    report.frontCheckReason = reason;
    return { report, checks, status: 'deferred', url: url.href };
  }
  let rows;
  try { rows = await runChecks(page); }
  catch (error) {
    rows = [{ id: 'fresh-front-checks-execution', status: 'fail',
      expected: 'Shared public-page assertions complete after current-page publish.',
      actual: 'The public-page assertion runner did not complete.',
      detail: '前台页面已加载，但共享断言执行中断。',
      reason: { code: 'front-check-execution-error', errorName: String(error?.name || 'Error') } }];
  }
  const indexed = new Map((report.checks || []).map((check, index) => [String(check.id), index]));
  const merged = [...(report.checks || [])];
  for (const check of rows) {
    const position = indexed.get(String(check.id));
    if (position === undefined) { indexed.set(String(check.id), merged.length); merged.push(check); }
    else merged[position] = check;
  }
  report.checks = merged;
  report.summary = countVerdicts(report.checks);
  report.frontCheckStatus = 'complete';
  report.frontCheckUrl = url.href;
  return { report, checks: rows, status: 'complete', url: url.href };
}

import { countVerdicts } from './human-review.mjs';
