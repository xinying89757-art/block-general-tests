import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { applyHumanReviewVerdict, countVerdicts } from '../src/human-review.mjs';
import { checkDesignRequirementEditor, checkDesignRequirementFront, validateDesignSpec } from '../src/design-spec-checklist.mjs';
import { finalizeFrontStyleReport, summarizeFrontStyleZh } from '../src/front-style-report.mjs';
import { mergeFreshFrontReports, summarizeFreshFrontMerge } from '../src/fresh-front-merge.mjs';
import { buildFreshReport } from '../src/fresh-block-flow.mjs';
import { renderReport } from '../scripts/report-html.mjs';

const requirement = { id: 'child-copy', checkType: 'typography', checkStage: 'front', sourceText: '子级文字',
  expected: { fontSize: 16 }, params: { styleCheckId: 'child-label' } };
const spec = (override = {}) => ({ source: { fileKey: 'fixture', nodeId: '1:1' }, requirements: [requirement],
  overrides: [{ requirementId: requirement.id, status: 'human-review', reason: '测试数据缺少子级，需人工判断。',
    whenReasonCodes: ['test-data-not-provided'], ...override }] });
const row = (status, code = 'test-data-not-provided') => ({ id: `design-${requirement.id}`, status, name: '子级文字',
  expected: { fontSize: 16 }, actual: [], reason: { code } });

test('conditional review override applies to matching na only, never masks measured pass/fail', () => {
  const profile = { designSpec: spec() };
  const original = row('na');
  const review = applyHumanReviewVerdict(original, { profile });
  assert.equal(review.status, 'human-review');
  assert.equal(review.reason.humanReviewSource, 'checklist-override');
  assert.equal(review.evidence.humanReview.machineReason, original.reason.code);
  assert.equal(review.expected, original.expected); assert.equal(review.actual, original.actual);
  for (const status of ['pass', 'fail']) {
    const measured = row(status); assert.equal(applyHumanReviewVerdict(measured, { profile }), measured);
  }
  assert.equal(applyHumanReviewVerdict(row('na', 'read-timeout'), { profile }).status, 'na');
  assert.equal(applyHumanReviewVerdict({ ...row('na'), id: 'bss-child-label' }, { profile }).status, 'human-review',
    'derived functional checks inherit only their own checklist mapping');
});

test('test-data absence and explicit review flags convert; operational unknowns and waivers do not', () => {
  for (const code of ['no-hierarchy-depth-evidence-in-instance', 'navigation-child-levels-not-in-instance-dom',
    'no-filter-options', 'no-hierarchy-dom-in-instance', 'text-filter-without-option-nodes']) {
    const result = applyHumanReviewVerdict(row('na', code));
    assert.equal(result.status, 'human-review'); assert.match(result.detail, /测试数据缺少/);
    assert.equal(result.reason.code, code);
  }
  for (const code of ['scope-unmapped', 'unsupported-requirement-human-review'])
    assert.equal(applyHumanReviewVerdict(row('na', code)).status, 'human-review');
  for (const code of ['read-timeout', 'locator-ambiguous', 'primary-image-dimensions-unavailable',
    'image-ratio-elements-unresolved', 'instance-root-unavailable']) {
    const result = applyHumanReviewVerdict({ ...row('na', code), reason: { code, humanReviewRequired: true } });
    assert.equal(result.status, 'na', code);
  }
  assert.equal(applyHumanReviewVerdict(row('na', 'waived')).status, 'na');
  assert.equal(applyHumanReviewVerdict(row('deferred')).status, 'deferred');
});

test('schema and runtime validation reject invalid status, missing reason and invalid reason conditions', async () => {
  assert.deepEqual(validateDesignSpec(spec()), []);
  for (const change of [{ status: 'pass' }, { reason: '' }, { reason: undefined },
    { whenReasonCodes: [] }, { whenReasonCodes: [4] }, { whenReasonCodes: [''] },
    { whenReasonCodes: [' '] }, { status: 'waived', whenReasonCodes: ['reason'] }, { requirementId: 'unknown' }])
    assert.ok(validateDesignSpec(spec(change)).length, JSON.stringify(change));
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/design-checklist.schema.json', import.meta.url)));
  const override = schema.properties.overrides.items;
  assert.deepEqual(override.properties.status.enum, ['waived', 'human-review']);
  assert.ok(override.required.includes('reason')); assert.equal(override.properties.whenReasonCodes.minItems, 1);
  assert.equal(override.allOf[0].then.properties.status.const, 'human-review');
});

test('front/editor checklist entry points use the verdict policy and waiver remains known exception', async () => {
  const profile = { designSpec: spec({ whenReasonCodes: ['scope-unmapped'] }) };
  const result = await checkDesignRequirementFront(requirement, { profile });
  assert.equal(result.status, 'human-review');
  const width = { ...requirement, id: 'width', checkType: 'module-width', checkStage: 'editor', expected: { expandable: true, default: '100%' } };
  const widthProfile = { designSpec: { ...spec(), requirements: [width], overrides: [{ requirementId: 'width', status: 'human-review', reason: 'Review only missing observations.' }] } };
  assert.equal(checkDesignRequirementEditor(width, { profile: widthProfile, inventory: [] }).status, 'fail');
  widthProfile.designSpec.overrides[0].status = 'waived';
  const waived = checkDesignRequirementEditor(width, { profile: widthProfile, inventory: [] });
  assert.equal(waived.status, 'na'); assert.equal(waived.classification, 'known-exception');
});

const mixedRows = () => [row('pass'), { ...row('fail'), id: 'measured-fail' },
  { ...row('na', 'image-load-timeout'), id: 'pending-image' },
  { ...row('na', 'no-filter-options'), id: 'options', sourceText: '筛选选项' },
  { ...row('na', 'unsupported-requirement-human-review'), id: 'manual', sourceText: '原始设计要求' }];

test('front and fresh JSON count review separately and Chinese summary has no selector diagnostics', () => {
  const report = finalizeFrontStyleReport({ checks: mixedRows() });
  assert.equal(report.summary['human-review'], 2); assert.equal(report.summary.na, 1);
  assert.equal(report.summary.pass, 1); assert.equal(report.summary.fail, 1); assert.equal(report.summary.other, 0);
  assert.match(summarizeFrontStyleZh(report), /pass 1 \/ fail 1 \/ na 1 \/ 人工判断 2/);
  assert.doesNotMatch(summarizeFrontStyleZh(report), /selector|locator/);
  const fresh = buildFreshReport({ instance: {}, page: {}, batch: { results: mixedRows(), batches: [], timing: {} } });
  assert.equal(fresh.summary['human-review'], 2); assert.equal(fresh.failures.length, 1);
  assert.equal(fresh.humanReview.length, 2);
  assert.equal(countVerdicts(fresh.checks).na, 1);
});

test('merged report preserves original sources and converts only selected na verdicts', () => {
  const box = { blockId: 'sample', checks: [{ id: 'options', status: 'deferred' }, { id: 'measured', status: 'fail' }] };
  const front = { blockId: 'sample', checks: [{ id: 'options', status: 'na', reason: { code: 'no-filter-options' } }, { id: 'measured', status: 'human-review' }] };
  const merged = mergeFreshFrontReports(box, front);
  assert.equal(merged.summary['human-review'], 1); assert.equal(merged.summary.fail, 1); assert.equal(merged.summary.na, 0);
  assert.equal(merged.checks[0].sources.front.status, 'na'); assert.equal(merged.checks[1].status, 'fail');
  assert.match(summarizeFreshFrontMerge(merged), /人工判断 1/);
});

test('real merge CLI and report-html show separate review counts, including legacy review flags', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'human-review-'));
  try {
    const box = path.join(temp, 'box.json'), front = path.join(temp, 'front.json'), out = path.join(temp, 'merged.json');
    await fs.writeFile(box, JSON.stringify({ blockId: 'sample', checks: [{ id: 'manual', status: 'deferred' }] }));
    await fs.writeFile(front, JSON.stringify({ blockId: 'sample', checks: [{ id: 'manual', status: 'na', sourceText: '原文', reason: { code: 'unsupported-requirement-human-review', humanReviewRequired: true } }] }));
    execFileSync(process.execPath, ['scripts/merge-fresh-front-reports.mjs', box, front, out]);
    assert.equal(JSON.parse(await fs.readFile(out)).summary['human-review'], 1);
    assert.match(await fs.readFile(path.join(temp, 'merged-zh.md'), 'utf8'), /人工判断 1/);
    await renderReport(front, path.join(temp, 'report.html'));
    const html = await fs.readFile(path.join(temp, 'report.html'), 'utf8');
    assert.match(html, /<b>1<\/b>人工判断/); assert.match(html, /data-status="human-review"/);
    assert.match(html, /data-f="human-review"/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});


test('review policy is idempotent and existing human-review always has a string machine reason', () => {
  const first = applyHumanReviewVerdict(row('na', 'no-filter-options'));
  assert.deepEqual(applyHumanReviewVerdict(first), first);
  const normalized = finalizeFrontStyleReport({ checks: [{ id: 'review', status: 'human-review' }] });
  assert.equal(typeof normalized.checks[0].reason.code, 'string');
  assert.equal(normalized.summary['human-review'], 1);
});
