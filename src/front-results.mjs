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
  // Settings is still entered in FRONT_ONLY because capabilities use its
  // front-effects transaction to flip, save, observe and restore controls.
  // Canvas assertions are box work and must never run on the Mac front pass.
  if (config.frontOnly && layer === 'backend') return false;
  return true;
}

export function frontRunPhases(config = {}, profile = {}, added = false) {
  const capabilities = profile.capabilities || [];
  const filter = config.capabilityFilter;
  return {
    baselineGuard: Array.isArray(profile.baseline) && profile.baseline.length > 0,
    applyBaseline: Array.isArray(profile.baseline) && profile.baseline.length > 0
      && (added || Boolean(config.applyBaseline)),
    prepareFixture: Boolean(profile.fixture)
      && (!filter?.length || filter.includes('custom-filter-fields')),
    settings: true,
    backend: shouldRunLayer('backend', config),
    front: true,
    capabilities: capabilities.map(({ id }) => id),
  };
}
