import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const usage = '用法：node scripts/merge-reports.mjs <report1.json> <report2.json> [out.json]';

async function readReport(file) {
  let report;
  try {
    report = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取报告 ${file}：${error.message}`);
  }
  const blockId = report?.config?.blockId ?? report?.profile?.blockId ?? report?.blockId;
  if (!report || !blockId || !report.runId || !Array.isArray(report.checks)) {
    throw new Error(`报告 ${file} 格式非法：必须包含 blockId、runId 和 checks 数组。`);
  }
  return { report, blockId: String(blockId) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) throw new Error(usage);
  // With more than two arguments, the last argument is the output path.
  const outPath = args.length > 2 ? args.pop() : null;
  const inputs = await Promise.all(args.map(readReport));
  const blockId = inputs[0].blockId;
  for (let i = 1; i < inputs.length; i += 1) {
    if (inputs[i].blockId !== blockId) {
      throw new Error(`blockId 不一致：${args[0]} 为 ${blockId}，${args[i]} 为 ${inputs[i].blockId}。`);
    }
  }

  const reports = inputs.map(({ report }) => report);
  const first = reports[0];
  const checksById = new Map();
  const capabilities = new Set();
  const screenshots = {};
  const errorsByArtifact = new Map();
  const arrayArtifactErrors = reports.every((report) => !report.artifactErrors || Array.isArray(report.artifactErrors));
  let finishedAt = null;
  let previewReport = null;
  let failure = null;
  for (const report of reports) {
    for (const check of report.checks) checksById.set(check.id, check);
    for (const id of report.profile?.capabilities || []) capabilities.add(id);
    Object.assign(screenshots, report.screenshots);
    // Current reports use arrays keyed by artifact; also preserve keyed objects.
    const errors = Array.isArray(report.artifactErrors)
      ? report.artifactErrors.map((error) => [error.artifact, error])
      : Object.entries(report.artifactErrors || {});
    for (const [name, error] of errors) errorsByArtifact.set(name, error);
    if (report.finishedAt && (!finishedAt || Date.parse(report.finishedAt) >= Date.parse(finishedAt))) {
      finishedAt = report.finishedAt;
    }
    if (report.previewLink && (!previewReport || Date.parse(report.finishedAt) >= Date.parse(previewReport.finishedAt))) {
      previewReport = report;
    }
    if (report.failure) failure = report.failure;
  }

  const checks = [...checksById.values()];
  const summary = { pass: 0, fail: 0, skip: 0, na: 0, record: 0, deferred: 0 };
  for (const check of checks) {
    if (Object.hasOwn(summary, check.status)) summary[check.status] += 1;
  }
  const startedAt = reports.map((report) => report.startedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const timestamp = startedAt.replace(/[:.]/g, '-');
  const safeBlockId = blockId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const runId = `${safeBlockId}-merged-${timestamp}`;
  const artifactErrors = arrayArtifactErrors ? [...errorsByArtifact.values()] : Object.fromEntries(errorsByArtifact);
  const report = {
    ...first,
    runId,
    startedAt,
    finishedAt,
    mergedFrom: reports.map((item) => item.runId),
    capabilityFilter: null,
    profile: reports.some((item) => item.profile)
      ? { ...reports.find((item) => item.profile).profile, capabilities: [...capabilities] }
      : null,
    checks,
    summary,
    previewLink: previewReport?.previewLink ?? null,
    previewLinkExpiresAt: previewReport?.previewLinkExpiresAt ?? null,
    screenshots,
    artifactErrors,
    failure,
    status: failure || summary.fail || errorsByArtifact.size ? 'failed' : 'passed',
  };
  const reportPath = outPath || path.join(projectRoot, 'reports', `report-${runId}.json`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`合并报告：${reportPath}`);
}

main().catch((error) => {
  console.error(`[merge-reports] ${error.message}`);
  process.exitCode = 1;
});
