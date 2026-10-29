export function replaceDeferredChecks(baseReport, frontReport) {
  const frontById = new Map((frontReport.checks || []).map((check) => [check.id, check]));
  const replaced = new Set();
  const checks = (baseReport.checks || []).map((check) => {
    if (check.status !== 'deferred' || !frontById.has(check.id)) return check;
    replaced.add(check.id);
    return frontById.get(check.id);
  });
  const summary = { pass: 0, fail: 0, skip: 0, na: 0, record: 0, deferred: 0 };
  for (const check of checks) if (Object.hasOwn(summary, check.status)) summary[check.status] += 1;
  const artifactErrors = baseReport.artifactErrors || [];
  const hasArtifactErrors = Array.isArray(artifactErrors) ? artifactErrors.length > 0 : Object.keys(artifactErrors).length > 0;
  return { ...baseReport, checks, summary, status: baseReport.failure || summary.fail || hasArtifactErrors ? 'failed' : 'passed',
    replacedDeferred: [...replaced] };
}

export function shouldRunLayer(layer, config = {}) {
  if (config.frontOnly && layer === 'settings') return false;
  return true;
}
