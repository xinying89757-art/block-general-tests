// Shared verdict policy. Never transforms measured pass/fail, environment
// outcomes, or waived requirements. Profile data owns per-requirement decisions.
const DATA_ABSENCE = new Map([
  ['no-hierarchy-depth-evidence-in-instance', '分类层级'],
  ['navigation-child-levels-not-in-instance-dom', '子级分类'],
  ['no-hierarchy-dom-in-instance', '分类层级'],
  ['no-semantic-link-hierarchy-in-instance', '导航层级'],
  ['no-nav-levels-in-instance', '导航层级'],
  ['no-filter-options', '筛选选项'],
  ['text-filter-without-option-nodes', '筛选选项'],
  ['no-option-labels-in-instance', '筛选选项'],
]);
const REVIEW_REASONS = new Set(['scope-unmapped', 'front-checker-unavailable', 'editor-checker-unavailable',
  'unsupported-requirement-human-review', 'design-typography-properties-unavailable',
  'mapped-style-check-unavailable']);
function codesFor(check) {
  const found = new Set();
  const visit = (reason, depth = 0) => {
    if (depth > 5 || !reason) return;
    if (typeof reason === 'string') { found.add(reason); return; }
    if (typeof reason.code === 'string') found.add(reason.code);
    if (typeof reason.machineReason === 'string') found.add(reason.machineReason);
    visit(reason.mappedCheck, depth + 1); visit(reason.dependsOn, depth + 1);
  };
  visit(check.reason); visit(check.evidence);
  return [...found];
}
function operationalUnknown(codes, check) {
  return Boolean(check.errorDiagnostic || check.reason?.error) || check.actual?.rootFound === false
    || check.actual?.rootCount > 1 || check.actual?.containerCount > 1 || check.actual?.matchCount > 1 || codes.some((code) =>
    /timeout|ambiguous|ambiguity|not-unique|instance-root|instance-locator|instance-unavailable|container-unresolved|image-load|primary-image|primary-media|image-ratio-elements-unresolved|image-dimensions-unavailable|unreachable/i.test(code));
}
function overrideForCheck(check, profile, requirementId) {
  const requirements = profile?.designSpec?.requirements || [];
  const id = requirementId || String(check.id || '').replace(/^design-/, '');
  const styleId = String(check.id || '').replace(/^bss-/, '');
  const viewport = check.reason?.viewport?.label || check.viewport?.label;
  const relatedIds = requirements.filter((requirement) => (!viewport || !requirement.params?.viewport || requirement.params.viewport === viewport)
    && [requirement.params?.styleCheckId, ...(requirement.params?.styleCheckIds || [])].includes(styleId)).map(({ id }) => id);
  return (profile?.designSpec?.overrides || []).find((override) => override.status === 'human-review'
    && (override.requirementId === id || relatedIds.includes(override.requirementId))
    && (!override.whenReasonCodes || override.whenReasonCodes.some((code) => codesFor(check).includes(code))));
}
export function applyHumanReviewVerdict(check, { profile, requirementId } = {}) {
  if (!check || !['na', 'human-review'].includes(check.status)
    || check.classification === 'known-exception' || check.reason?.code === 'waived') return check;
  const codes = codesFor(check), override = overrideForCheck(check, profile, requirementId);
  const dataCode = codes.find((code) => DATA_ABSENCE.has(code));
  const needsReview = check.reason?.humanReviewRequired === true || codes.some((code) => REVIEW_REASONS.has(code));
  // Old producers marked all na as humanReviewRequired, including unloaded
  // images and timeouts. Those operational unknowns remain na unless explicit.
  if (!override && (operationalUnknown(codes, check) || (!dataCode && !needsReview && check.status !== 'human-review'))) return check;
  const message = override?.reason || check.reason?.humanReviewReason || (dataCode
    ? `测试数据缺少${DATA_ABSENCE.get(dataCode)}，需人工判断。` : '该要求暂无法自动判定，需人工判断。');
  const originalReason = check.reason && typeof check.reason === 'object' ? check.reason : {};
  const reason = { ...originalReason, code: typeof originalReason.code === 'string' && originalReason.code.trim()
    ? originalReason.code : codes[0] || 'human-review-required' };
  return { ...check, status: 'human-review', classification: 'human-review', detail: message,
    reason: { ...reason, humanReviewRequired: true, humanReviewReason: message,
      humanReviewSource: override ? 'checklist-override' : reason.humanReviewSource || (dataCode ? 'test-data-absent' : 'automated-check-unavailable') },
    evidence: { ...check.evidence, humanReview: { originalStatus: 'na', machineReason: reason.code || codes[0] || 'human-review-required',
      ...(dataCode ? { dataReasonCode: dataCode } : {}) } } };
}
export function countVerdicts(checks = []) {
  const counts = { pass: 0, fail: 0, skip: 0, na: 0, 'human-review': 0, record: 0, deferred: 0,
    blocked: 0, 'not-applicable': 0, 'not-adapted': 0, 'env-timeout': 0, 'env-paused': 0 };
  for (const check of checks) if (Object.hasOwn(counts, check.status)) counts[check.status]++;
  return counts;
}
export function verdictCountsZh(summary) {
  return `pass ${summary.pass || 0} / fail ${summary.fail || 0} / na ${summary.na || 0} / 人工判断 ${summary['human-review'] || 0}`;
}
export function collectHumanReview(checks = []) {
  return checks.filter((check) => check.status === 'human-review').map((check) => ({ id: check.id,
    sourceText: check.sourceText || check.name || check.id, reason: check.reason?.humanReviewReason || '需人工判断。',
    machineReason: check.reason?.code || 'human-review-required' }));
}
