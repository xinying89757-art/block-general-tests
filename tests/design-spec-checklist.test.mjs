import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDesignRequirementEditor, checkDesignRequirementFront, extractWrittenColorValues,
  countInstanceColorMatches, normalizeDesignColor, runWrittenColorFrontChecks, validateDesignSpec } from '../src/design-spec-checklist.mjs';
import { importExtractedDesignSpec } from '../scripts/import-design-spec.mjs';
import { finalizeFrontStyleReport } from '../src/front-style-report.mjs';
import { addStyleFailureReasons, breakageFindings, isMobileInstanceOverlap, mobileChecklistMode } from '../src/capabilities/block-style-spec.mjs';
import { isCenteredImagePosition, isVisibleHoverStateTarget, runDesignSpecFrontChecks } from '../src/design-spec-checklist.mjs';
import { buildDesignHumanReview, listUnsupportedDesignRequirements, designCheckSupport, designRequirementPlan } from '../src/design-spec-checklist.mjs';

const requirement = (overrides = {}) => ({ id: 'req-color', checkType: 'color-default', sourceText: 'A color',
  expected: { value: '#1c4587' }, checkStage: 'front', params: {}, ...overrides });
const profile = (requirements, extra = {}) => ({ designSpec: { source: { fileKey: 'fileKey_1', nodeId: '1:2' },
  requirements, overrides: [], ...extra } });

test('design checklist validation accepts catalog entries and rejects malformed / unknown entries', () => {
  const valid = { source: { fileKey: 'file_1', nodeId: '1:2' }, requirements: [requirement()], overrides: [] };
  assert.deepEqual(validateDesignSpec(valid), []);
  assert.ok(validateDesignSpec({ ...valid, requirements: [{ ...requirement(), checkType: 'guess-selector' }] })
    .some((item) => item.path.endsWith('.checkType')));
  assert.ok(validateDesignSpec({ ...valid, source: { fileKey: 'https://figma.com/file/token', nodeId: 'bad' } }).length >= 2);
  assert.ok(validateDesignSpec({ ...valid, overrides: [{ requirementId: 'missing', status: 'waived', reason: 'reason' }] })
    .some((item) => item.path.endsWith('.requirementId')));
});

test('design-spec importer stores only the Figma file key and node id from a URL', () => {
  const target = importExtractedDesignSpec({}, { file: 'https://www.figma.com/design/fileKey_1/name?node-id=1-2&t=private-token',
    colors: [{ name: 'Primary', default: '#123456', sourceNodeId: '1:2' }] });
  assert.deepEqual(target.designSpec.source, { fileKey: 'fileKey_1', nodeId: '1:2' });
  assert.doesNotMatch(JSON.stringify(target), /private-token|figma\.com/);
});

test('waived requirements produce a known-exception result, not a failure', async () => {
  const item = { id: 'width', checkType: 'module-width', sourceText: 'Row expand', expected: { expandable: true, default: '1440px' },
    checkStage: 'editor', params: {} };
  const p = profile([item], { overrides: [{ requirementId: 'width', status: 'waived', reason: 'Removed by product decision.' }] });
  const result = checkDesignRequirementEditor(item, { profile: p, inventory: [] });
  assert.equal(result.status, 'na');
  assert.equal(result.classification, 'known-exception');
  assert.equal(result.name, '已知例外');
  assert.match(result.detail, /Removed by product decision/);
});

test('module-width editor check requires the setting and the specified default', () => {
  const item = { id: 'width', checkType: 'module-width', sourceText: 'Row expand', expected: { expandable: true, default: '1440px' },
    checkStage: 'editor', params: {} };
  const p = profile([item]);
  const region = { type: 'rail:module-width', controls: [
    { type: 'radio', label: '1440px', checked: true }, { type: 'radio', label: '1200px', checked: false },
  ] };
  assert.equal(checkDesignRequirementEditor(item, { profile: p, inventory: [region] }).status, 'pass');
  const missing = checkDesignRequirementEditor(item, { profile: p, inventory: [] });
  assert.equal(missing.status, 'fail');
  assert.equal(missing.actual.settingExists, false);
  assert.equal(checkDesignRequirementEditor(item, { profile: p, inventory: [{ ...region,
    controls: [{ type: 'radio', label: '1200px', checked: true }] }] }).status, 'fail');
  const customWidth = { type: 'rail:module-width', controls: [
    { type: 'radio', label: '1200px', checked: false },
    { type: 'radio', label: '自定义（需不小于1200px）', checked: true },
    { type: 'text', label: '自定义宽度', styleProperty: 'width', value: '1440' },
  ] };
  const custom = checkDesignRequirementEditor(item, { profile: p, inventory: [customWidth] });
  assert.equal(custom.status, 'pass');
  assert.equal(custom.actual.defaultValue, '1440px');
  assert.equal(checkDesignRequirementEditor(item, { profile: p, inventory: [{ ...customWidth,
    controls: customWidth.controls.map((control) => control.styleProperty === 'width' ? { ...control, value: '1600' } : control) }] }).status, 'fail');
  const waived = checkDesignRequirementEditor(item, { profile: profile([item], {
    overrides: [{ requirementId: 'width', status: 'waived', reason: 'Removed setting.' }] }), inventory: [] });
  assert.equal(waived.status, 'na');
  assert.equal(waived.reason.code, 'waived');
});

test('fixed support registry exposes implemented editor/front stages and dry-run unsupported stages', () => {
  assert.equal(designCheckSupport('module-width', 'editor'), 'run');
  assert.equal(designCheckSupport('module-width', 'front'), 'unsupported');
  assert.equal(designCheckSupport('manual', 'front'), 'unsupported');
  assert.deepEqual(designRequirementPlan({ id: 'overflow', checkType: 'overflow-threshold', checkStage: 'front', expected: { threshold: 4, direction: 'vertical' }, params: {} })
    .stages[0], { stage: 'front', status: 'incomplete', missing: ['params.containerSelector', 'params.itemSelector'] });
});

test('spec color matches any element in the instance and fails when none match', async () => {
  const item = requirement();
  const p = profile([item]);
  const page = { evaluate: async () => ({ rootCount: 1, styles: [
    { color: 'rgb(1, 2, 3)', backgroundColor: 'rgba(28,69,135,1)', borderColor: 'rgba(0,0,0,0)' },
    { color: 'rgb(9, 9, 9)', backgroundColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,1)' },
  ] }) };
  const pass = await checkDesignRequirementFront(item, { profile: p, page, rootSelector: '[data-instance="target"]' });
  assert.equal(pass.status, 'pass');
  assert.equal(pass.reason.expectedSource, 'designSpec.requirement.expected.value');
  const fail = await checkDesignRequirementFront({ ...item, expected: { value: '#ff0000' } },
    { profile: p, page, rootSelector: '[data-instance="target"]' });
  assert.equal(fail.status, 'fail');
  assert.equal(countInstanceColorMatches({ styles: [{ color: 'rgba(4,79,159,0.07)' }] }, '#044F9F @7%'), 1);
});

test('color-scope compares nested functional observations with the written palette value and normalizes CSS colors', async () => {
  const item = requirement({ id: 'button-scope', checkType: 'color-scope', sourceText: 'Button background',
    expected: { value: '#1c4587' }, params: { styleCheckIds: ['button-bg'] } });
  const p = profile([item]);
  const settingsReport = { block: { currentValues: [
    { section: '区块配色', type: 'color', value: 'rgb(255 0 0 / 100%)' },
  ] }, checks: [{ id: 'button-bg', status: 'fail', expected: '#1c4587', value: 'rgb(255, 0, 0)' }] };
  const result = await checkDesignRequirementFront(item, { profile: p, settingsReport, frontChecks: [
    { id: 'bss-button-bg', status: 'fail', actual: [{ backgroundColor: 'rgba(255,0,0,1)' }] },
  ] });
  assert.equal(result.status, 'pass');
  assert.equal(result.expected.value, 'rgb(255, 0, 0)');
  assert.deepEqual(result.dependsOn, ['bss-button-bg']);
  assert.equal(result.reason.code, 'written-scope-color-matched');
  assert.equal(normalizeDesignColor('rgb(255 0 0 / 100%)'), normalizeDesignColor('#ff0000'));
  assert.equal(normalizeDesignColor('hsl(0 100% 50% / 100%)'), normalizeDesignColor('#ff0000'));
  const mismatch = await checkDesignRequirementFront(item, { profile: p, settingsReport, frontChecks: [
    { id: 'bss-button-bg', status: 'fail', actual: [{ backgroundColor: 'rgb(0, 0, 0)' }] },
  ] });
  assert.equal(mismatch.status, 'fail');
});

test('image position recognizes centered object-position and background-position values', async () => {
  assert.equal(isCenteredImagePosition('50% 50%'), true);
  assert.equal(isCenteredImagePosition('50.0% 50%'), true);
  assert.equal(isCenteredImagePosition('center center'), true);
  assert.equal(isCenteredImagePosition('left top'), false);
  const item = { id: 'image-center', checkType: 'image-ratio', sourceText: 'Centered image',
    expected: { ratio: '1:1', centered: true }, checkStage: 'front', params: {} };
  const result = await checkDesignRequirementFront(item, { profile: profile([item]), rootSelector: '.root',
    page: { evaluate: async () => ({ rootFound: true, images: [
      { ratio: 1, centered: true, objectPosition: '50% 50%', positionSource: 'object-position' },
      { ratio: 1, centered: true, backgroundPosition: '50% 50%', positionSource: 'background-position' },
    ] }) } });
  assert.equal(result.status, 'pass');
});

test('hover candidates must be visible instance descendants with an interaction or hover affordance', () => {
  assert.equal(isVisibleHoverStateTarget({ visible: true, withinInstance: true, hoverAffordance: true }), true);
  assert.equal(isVisibleHoverStateTarget({ visible: false, withinInstance: true, hoverAffordance: true }), false);
  assert.equal(isVisibleHoverStateTarget({ visible: true, withinInstance: false, hoverAffordance: true }), false);
  assert.equal(isVisibleHoverStateTarget({ visible: true, withinInstance: true }), false);
});

test('read, locate and compare check paths always receive specific string failure reasons', () => {
  const source = [
    { id: 'read-empty', status: 'na', actual: [], evidence: { matchedCount: 0 } },
    { id: 'locate-empty', status: 'na', actual: [], errorDiagnostic: { stage: 'locate', class: 'TimeoutError' } },
    { id: 'compare-failed', status: 'fail', actual: [{ value: 'different' }], evidence: { matchedCount: 1,
      elements: [{ color: '#000000' }] } },
  ];
  const withReasons = addStyleFailureReasons(source, { capability: { styleSpec: { items: [] } } });
  const finalized = finalizeFrontStyleReport({ checks: withReasons }).checks;
  assert.deepEqual(finalized.map((check) => check.reason.code), ['no-matched-elements', 'front-locate-error', 'style-assertion-mismatch']);
  assert.ok(finalized.every((check) => ['na', 'fail'].includes(check.status)
    ? typeof check.reason.code === 'string' && check.reason.code && check.reason.code !== '[object Object]'
      && check.reason.code !== 'na-reason-unavailable' : true));
});

test('dependent failures are linked and counted once at their root', () => {
  const report = finalizeFrontStyleReport({ checks: [
    { id: 'functional-color', status: 'fail', reason: { code: 'color-mismatch' } },
    { id: 'design-scope-color', status: 'fail', dependsOn: ['functional-color'], reason: { code: 'written-scope-color-mismatch' } },
  ] });
  assert.deepEqual(report.checks[1].dependsOn, ['functional-color']);
  assert.deepEqual(report.summary, { pass: 0, fail: 1, rawFail: 2, dedupedFail: 1, na: 0, other: 0 });
});

test('written color search includes SVG paint, outline, shadows, gradients and pseudo-elements', () => {
  const snapshot = { styles: [
    { fill: 'rgb(208, 182, 71)' },
    { stroke: '#0d0d0a' },
    { outlineColor: 'rgba(17, 13, 9, 1)' },
    { boxShadow: '0 1px 3px rgba(13,13,10,1)' },
    { backgroundImage: 'linear-gradient(90deg, #d0b647 0%, rgb(0, 0, 0) 100%)' },
    { before: { color: 'rgb(17,13,9)' } },
    { after: { backgroundColor: 'rgb(208,182,71)' } },
  ] };
  assert.equal(countInstanceColorMatches(snapshot, '#d0b647'), 3);
  assert.equal(countInstanceColorMatches(snapshot, '#0d0d0a'), 2);
  assert.equal(countInstanceColorMatches(snapshot, '#110d09'), 2);
  assert.equal(countInstanceColorMatches(snapshot, '#ff0000'), 0);
});

test('palette default is not asserted against a value written by this run', async () => {
  const item = requirement({ expected: { name: 'Palette', value: '#1c4587' } });
  const p = profile([item]);
  const settingsReport = { block: { currentValues: [{ section: '区块配色', type: 'color', value: 'rgb(255, 0, 0)' }] },
    checks: [{ id: 'palette-persist', setting: 'palette-color', status: 'pass', value: '#ff0000', expected: '#ff0000' }] };
  let reads = 0;
  const page = { evaluate: async () => { reads += 1; return { rootCount: 1, styles: [{ color: '#1c4587' }] }; } };
  const result = await checkDesignRequirementFront(item, { profile: p, page, rootSelector: '.instance', settingsReport });
  assert.equal(result.status, 'na');
  assert.equal(result.reason.code, 'palette-default-overridden-this-run');
  assert.equal(reads, 0);
  const untouched = await checkDesignRequirementFront(item, { profile: p, page, rootSelector: '.instance',
    settingsReport: { block: { currentValues: [{ section: '区块配色', type: 'color', value: '#1c4587' }] }, checks: [] } });
  assert.equal(untouched.status, 'pass');
  assert.equal(untouched.reason.expectedSource, 'designSpec.requirement.expected.value');
});

test('profile-local color scope override controls the functional scope name and reason', async () => {
  const item = requirement({ id: 'button-color-scope', checkType: 'color-scope', sourceText: 'Button text color',
    expected: { value: '#1c4587' }, params: { styleCheckIds: ['button-bg'] } });
  const p = profile([item], { scopeOverrides: [{ requirementId: item.id, sourceText: 'Button text color',
    resolvedScope: 'Button background color', reason: 'Profile-confirmed functional mapping.' }] });
  const result = await checkDesignRequirementFront(item, { profile: p, frontChecks: [{ id: 'bss-button-bg', status: 'pass' }] });
  assert.equal(result.status, 'pass');
  assert.equal(result.name, 'Button background color');
  assert.equal(result.reason.mappingReason, 'Profile-confirmed functional mapping.');
});

test('overwritten palette scope does not compare against its stale design default', async () => {
  const item = requirement({ id: 'button-scope', checkType: 'color-scope', sourceText: 'Button background',
    expected: { value: '#1c4587' }, params: { styleCheckIds: ['button-bg'] } });
  const report = { checks: [{ id: 'button-bg', status: 'pass', expected: '#1c4587', value: '#ff0000' }] };
  const result = await checkDesignRequirementFront(item, { profile: profile([item]), frontChecks: [], settingsReport: report });
  assert.equal(result.status, 'na');
  assert.equal(result.reason.code, 'written-scope-observation-unavailable');
  const runValueCheck = await checkDesignRequirementFront(item, { profile: profile([item]), settingsReport: report,
    frontChecks: [{ id: 'bss-button-bg', status: 'fail', expected: '#ff0000', actual: [{ backgroundColor: '#ff0000' }] }] });
  assert.equal(runValueCheck.status, 'pass');
  assert.equal(runValueCheck.reason.code, 'written-scope-color-matched');
  assert.deepEqual(runValueCheck.dependsOn, ['bss-button-bg']);
});

test('color normalization handles design opacity and CSS rgba consistently', () => {
  assert.equal(normalizeDesignColor('#044F9F @7%'), normalizeDesignColor('rgba(4, 79, 159, 0.07)'));
  assert.equal(normalizeDesignColor('#1c4587'), normalizeDesignColor('rgb(28, 69, 135)'));
});

test('mapped spec typography delegates to the profile-owned functional oracle; unmapped stays na', async () => {
  const mapped = { id: 'font', checkType: 'typography', sourceText: 'Label', expected: { fontSize: '18px' },
    checkStage: 'front', params: { styleCheckId: 'button-text' } };
  const p = profile([mapped]);
  const result = await checkDesignRequirementFront(mapped, { profile: p, frontChecks: [
    { id: 'button-text', status: 'pass', reason: { expected: { fontSize: 18 }, actual: [{ fontSize: 18 }] } },
  ] });
  assert.equal(result.status, 'pass');
  assert.equal(result.actual.fontSize[0], 18);
  assert.deepEqual(result.expected, { fontSize: '18px' });
  assert.equal(result.reason.expectedSource, 'designSpec.requirement.expected typography properties');
  const mismatch = await checkDesignRequirementFront(mapped, { profile: p, frontChecks: [
    { id: 'button-text', status: 'pass', reason: { expected: { fontSize: 20 }, actual: [{ fontSize: 20 }] } },
  ] });
  assert.equal(mismatch.status, 'fail');
  const unmapped = await checkDesignRequirementFront({ ...mapped, params: {} }, { profile: p, frontChecks: [] });
  assert.equal(unmapped.status, 'na');
  assert.equal(unmapped.reason.code, 'scope-unmapped');
});

test('typography can map by visible text or semantic role/learned profile scope when ids are absent', async () => {
  const item = { id: 'title', checkType: 'typography', sourceText: '按钮 New Machine',
    expected: { fontSize: '18px' }, checkStage: 'front', params: {} };
  const p = profile([item]);
  const byText = await checkDesignRequirementFront(item, { profile: p, page: { evaluate: async () => [
    { label: 'New Machine', role: 'a', fontSize: '18px', fontWeight: '700', lineHeight: 'normal' },
  ] }, rootSelector: '.instance' });
  assert.equal(byText.status, 'pass');
  assert.equal(byText.reason.code, 'design-typography-matched');
  const byRole = await checkDesignRequirementFront({ ...item, sourceText: '主要标题', params: { role: 'heading' } }, {
    profile: p, page: { evaluate: async () => [
      { label: 'Heading', role: 'heading', fontSize: '18px', fontWeight: '400', lineHeight: 'normal' },
    ] }, rootSelector: '.instance' });
  assert.equal(byRole.status, 'pass');
  assert.equal(byRole.reason.mappedCheck.code, 'instance-text-role-or-learned-scope');
});

test('text truncation, image ratio, and default expand use checklist parameters and fail closed without evidence', async () => {
  const pageReturning = (value) => ({ evaluate: async () => value });
  const truncation = { id: 'truncate', checkType: 'text-truncation', sourceText: 'Text capped',
    expected: { maxLines: 2, overflow: 'ellipsis' }, checkStage: 'front', params: {} };
  assert.equal((await checkDesignRequirementFront(truncation, { profile: profile([truncation]),
    page: pageReturning({ rootFound: true, elements: [{ lineClamp: 2, ellipsized: true }] }), rootSelector: '.i' })).status, 'pass');
  assert.equal((await checkDesignRequirementFront(truncation, { profile: profile([truncation]),
    page: pageReturning({ rootFound: true, elements: [{ lineClamp: 1, ellipsized: true }] }), rootSelector: '.i' })).status, 'fail');
  const ratio = { id: 'ratio', checkType: 'image-ratio', sourceText: 'Image 1:1', expected: { ratio: '1:1', centered: true },
    checkStage: 'front', params: {} };
  assert.equal((await checkDesignRequirementFront(ratio, { profile: profile([ratio]),
    page: pageReturning({ rootFound: true, images: [{ ratio: 1, centered: true }] }), rootSelector: '.i' })).status, 'pass');
  const expand = { id: 'expand', checkType: 'default-expand', sourceText: 'Default level', expected: { level: 1 },
    checkStage: 'front', params: {} };
  assert.equal((await checkDesignRequirementFront(expand, { profile: profile([expand]),
    page: pageReturning({ rootFound: true, maxVisibleLevel: 1, levels: [1] }), rootSelector: '.i' })).status, 'pass');
  const fullExpand = { ...expand, expected: { level: 1, collapsedLevel: 2 } };
  assert.equal((await checkDesignRequirementFront(fullExpand, { profile: profile([fullExpand]),
    page: pageReturning({ rootFound: true, maxVisibleLevel: 1, levels: [1], collapsedLevels: [2] }), rootSelector: '.i' })).status, 'pass');
  assert.equal((await checkDesignRequirementFront(fullExpand, { profile: profile([fullExpand]),
    page: pageReturning({ rootFound: true, maxVisibleLevel: 1, levels: [1], collapsedLevels: [] }), rootSelector: '.i' })).status, 'fail');
  const mobile = { id: 'mobile', checkType: 'mobile-layout', sourceText: 'One column',
    expected: { columns: 1, visible: true }, checkStage: 'front', params: { selector: '.target' } };
  assert.equal((await checkDesignRequirementFront(mobile, { profile: profile([mobile]),
    page: pageReturning({ rootFound: true, elements: [{ columns: 1, visible: true }] }), rootSelector: '.i' })).status, 'pass');
  const unresolved = await checkDesignRequirementFront({ ...ratio, expected: { ratio: 'unknown' } }, {
    profile: profile([ratio]), page: pageReturning({}), rootSelector: '.i' });
  assert.equal(unresolved.status, 'na');
  assert.equal(unresolved.reason.humanReviewRequired, true);
  assert.equal(typeof unresolved.reason.code, 'string');
  const truncationNa = await checkDesignRequirementFront({ ...truncation, expected: {} }, { profile: profile([truncation]), page: pageReturning({}), rootSelector: '.i' });
  assert.equal(truncationNa.status, 'na');
  const ratioFail = await checkDesignRequirementFront(ratio, { profile: profile([ratio]),
    page: pageReturning({ rootFound: true, images: [{ ratio: 1.5, centered: false }] }), rootSelector: '.i' });
  assert.equal(ratioFail.status, 'fail');
  const ratioNa = await checkDesignRequirementFront({ ...ratio, expected: { ratio: '?' } }, { profile: profile([ratio]), page: pageReturning({}), rootSelector: '.i' });
  assert.equal(ratioNa.status, 'na');
  const expandFail = await checkDesignRequirementFront(expand, { profile: profile([expand]),
    page: pageReturning({ rootFound: true, maxVisibleLevel: 2, levels: [1, 2] }), rootSelector: '.i' });
  assert.equal(expandFail.status, 'fail');
  const expandNa = await checkDesignRequirementFront({ ...expand, expected: {} }, { profile: profile([expand]), page: pageReturning({}), rootSelector: '.i' });
  assert.equal(expandNa.status, 'na');
});

test('scrollbar threshold checker covers pass, fail and na from checklist selectors', async () => {
  const item = { id: 'scroll', checkType: 'overflow-threshold', sourceText: 'Scroll after threshold',
    expected: { threshold: 2, direction: 'vertical' }, checkStage: 'front', params: { containerSelector: '.list', itemSelector: '.row' } };
  const p = profile([item]);
  const page = (value) => ({ evaluate: async () => value });
  const result = (value) => checkDesignRequirementFront(item, { profile: p, rootSelector: '.instance', page: page(value) });
  assert.equal((await result({ rootFound: true, containerCount: 1, clientExtent: 40, scrollExtent: 80, itemCount: 3, scrollable: true })).status, 'pass');
  assert.equal((await result({ rootFound: true, containerCount: 1, clientExtent: 40, scrollExtent: 40, itemCount: 3, scrollable: false })).status, 'fail');
  assert.equal((await result({ rootFound: true, containerCount: 0, itemCount: 0, scrollable: null })).status, 'na');
  assert.equal((await checkDesignRequirementFront({ ...item, params: {} }, { profile: p, rootSelector: '.instance', page: page({}) })).status, 'na');
});

test('navigation hierarchy checker covers pass, fail and na from nested-list levels', async () => {
  const item = { id: 'hierarchy', checkType: 'nav-hierarchy-levels', sourceText: 'Navigation has two levels',
    expected: { levels: [1, 2] }, checkStage: 'front', params: { itemSelector: 'li' } };
  const p = profile([item]);
  const page = (value) => ({ evaluate: async () => value });
  assert.equal((await checkDesignRequirementFront(item, { profile: p, page: page({ rootFound: true, levels: [1, 2], itemCount: 4 }), rootSelector: '.i' })).status, 'pass');
  assert.equal((await checkDesignRequirementFront(item, { profile: p, page: page({ rootFound: true, levels: [1], itemCount: 2 }), rootSelector: '.i' })).status, 'fail');
  assert.equal((await checkDesignRequirementFront(item, { profile: p, page: page({ rootFound: true, levels: [], itemCount: 0 }), rootSelector: '.i' })).status, 'na');
  assert.equal((await checkDesignRequirementFront({ ...item, expected: {} }, { profile: p, page: page({}), rootSelector: '.i' })).status, 'na');
});

test('unsupported requirements keep their verbatim source text in humanReview', () => {
  const unsupported = { id: 'manual-layout', checkType: 'manual', sourceText: 'Exact original unsupported requirement',
    expected: {}, checkStage: 'front', params: {} };
  const p = profile([unsupported], { unsupportedRequirements: [{ id: 'unmapped-spec', sourceText: 'Another verbatim item', reason: 'No catalog type.' }] });
  assert.equal(validateDesignSpec(p.designSpec).length, 0);
  const review = buildDesignHumanReview(p, [{ id: 'design-manual-layout', status: 'na', reason: { code: 'unsupported-requirement-human-review', humanReviewRequired: true } }]);
  assert.deepEqual(review.map((item) => item.sourceText).sort(), ['Another verbatim item', 'Exact original unsupported requirement']);
  assert.equal(listUnsupportedDesignRequirements(p).length, 2);
});

test('mobile checklist selects spec comparison when mobile items exist; otherwise checks instance integrity only', () => {
  assert.equal(mobileChecklistMode([{ checkType: 'typography', params: { viewport: 'mobile' } }]), 'design-spec');
  assert.equal(mobileChecklistMode([{ checkType: 'mobile-layout' }]), 'design-spec');
  assert.equal(mobileChecklistMode([{ checkType: 'typography', params: { viewport: 'pc' } }]), 'instance-integrity');
  assert.equal(mobileChecklistMode([]), 'instance-integrity');
  assert.deepEqual(breakageFindings({ blockOverflow: false, stickingOut: [], overlaps: [],
    textClipped: [{ text: 'inside' }], imgDistorted: [] }, { mobile: true }), ['实例内有 1 处可见文字被裁切：inside']);
  assert.deepEqual(breakageFindings({ blockOverflow: false, horizontalOverflow: true,
    stickingOut: [], overlaps: [], textClipped: [] }, { mobile: true }), []);
});

test('mobile overlap attribution excludes fixed, sticky, and out-of-instance pairs while preserving in-instance pairs', () => {
  const reportOverlaps = [
    { a: '0 Products have been sel', b: 'Remove All', aSelector: 'selection-count', bSelector: 'remove-all' },
    { a: 'Compare Now', b: 'Remove All', aSelector: 'compare-now', bSelector: 'remove-all' },
  ];
  // G59 47498 Mac evidence is the regression fixture. Its pairs are descendants
  // of the instance; absent position/geometry metadata is conservatively kept.
  assert.deepEqual(reportOverlaps.map(isMobileInstanceOverlap), [true, true]);
  assert.equal(isMobileInstanceOverlap({ ...reportOverlaps[0], withinInstance: false }), false);
  assert.equal(isMobileInstanceOverlap({ ...reportOverlaps[1], pageOrOverlay: true }), false);
  assert.deepEqual(breakageFindings({ overlaps: [
    { ...reportOverlaps[0], withinInstance: true, pageOrOverlay: true },
    { ...reportOverlaps[1], withinInstance: true, pageOrOverlay: false },
  ] }, { mobile: true }), ['重叠 1 处：「Compare Now」压「Remove All」']);
});

test('responsive checklist requirements run only at their declared viewport', async () => {
  const pc = { ...requirement({ id: 'pc-typo', checkType: 'typography', params: { viewport: 'pc' } }) };
  const mobile = { ...requirement({ id: 'mobile-typo', checkType: 'typography', params: { viewport: 'mobile' } }) };
  const p = profile([pc, mobile]);
  assert.deepEqual((await runDesignSpecFrontChecks(p, { viewport: { label: 'pc' }, frontChecks: [] })).map((item) => item.id), ['design-pc-typo']);
  assert.deepEqual((await runDesignSpecFrontChecks(p, { viewport: { label: 'mobile' }, frontChecks: [] })).map((item) => item.id), ['design-mobile-typo']);
});

test('final front-report assembly guarantees string machine reason codes for every na result', () => {
  const report = finalizeFrontStyleReport({ checks: [
    { id: 'missing-code', status: 'na', reason: { code: { code: 'nested' } } },
    { id: 'missing-reason', status: 'na' },
  ] });
  assert.ok(report.checks.every((check) => typeof check.reason.code === 'string' && check.reason.code.length));
});

test('typography design checks compare only spec font properties, excluding palette color and profile geometry', async () => {
  const item = { id: 'pagination', checkType: 'typography', sourceText: 'Pagination',
    expected: { fontSize: '14px', fontWeight: 'Poppins Regular', lineHeight: '28px', color: '#898989', width: '28px' },
    checkStage: 'front', params: { styleCheckId: 'pagination-other' } };
  const p = profile([item]);
  const result = await checkDesignRequirementFront(item, { profile: p, frontChecks: [{ id: 'pagination-other', status: 'fail',
    reason: { expected: { color: '#ff0000', fontSize: 14, width: 28 },
      actual: [{ color: '#4d4f53', fontSize: 14, width: 30, fontWeight: 400, lineHeight: '28px' }] } }] });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.expected, { fontSize: '14px', fontWeight: 'Poppins Regular', lineHeight: '28px' });
  assert.deepEqual(result.reason.propertiesChecked, ['fontSize', 'fontWeight', 'lineHeight']);
  assert.deepEqual(Object.keys(result.actual).filter((key) => key !== 'functionalChecks'), ['fontSize', 'fontWeight', 'lineHeight']);
  const mismatch = await checkDesignRequirementFront(item, { profile: p, frontChecks: [{ id: 'pagination-other', status: 'fail',
    reason: { actual: [{ fontSize: 16, fontWeight: 400, lineHeight: '28px' }] } }] });
  assert.equal(mismatch.status, 'fail');
  const incomplete = await checkDesignRequirementFront(item, { profile: p, frontChecks: [{ id: 'pagination-other', status: 'fail',
    reason: { actual: [{ fontSize: 14 }] } }] });
  assert.equal(incomplete.status, 'na');
  assert.equal(incomplete.reason.code, 'design-typography-properties-unavailable');
  assert.deepEqual(mismatch.dependsOn, ['pagination-other']);
  const combined = finalizeFrontStyleReport({ checks: [
    { id: 'pagination-other', status: 'fail', reason: { code: 'style-assertion-mismatch' } },
    mismatch, { ...mismatch, id: 'design-pagination-mobile' },
  ] });
  assert.equal(combined.summary.fail, 1, 'PC/mobile typography dependent observations must not recount their root failure');
});

test('typography failure names only the properties that differ and survives style diagnostic assembly', async () => {
  const item = { id: 'line-height', checkType: 'typography', sourceText: 'Typography',
    expected: { fontSize: '14px', fontWeight: 400, lineHeight: '28px' }, checkStage: 'front', params: { styleCheckId: 'label' } };
  const check = await checkDesignRequirementFront(item, { profile: profile([item]), frontChecks: [
    { id: 'bss-label', status: 'pass', actual: [{ fontSize: 14, fontWeight: 400, lineHeight: 14 }] },
  ] });
  assert.equal(check.status, 'fail');
  assert.match(check.detail, /行高（lineHeight）/);
  assert.doesNotMatch(check.detail, /字号/);
  assert.deepEqual(check.reason.mismatchedProperties, ['lineHeight']);
  const [diagnosed] = addStyleFailureReasons([check], { capability: { styleSpec: { items: [] } } });
  assert.deepEqual(diagnosed.reason.mismatches, check.reason.mismatches);
});

test('a child-level typography requirement never substitutes an observed parent row', async () => {
  const item = { id: 'child-label', checkType: 'typography', sourceText: 'Child level label',
    expected: { fontWeight: 400 }, checkStage: 'front', params: { hierarchyLevel: 2, styleCheckId: 'label' } };
  const check = await checkDesignRequirementFront(item, { profile: profile([item]), frontChecks: [
    { id: 'bss-label', status: 'pass', actual: [{ fontWeight: 700, lineHeight: 45, hierarchyLevel: 1 }] },
  ] });
  assert.equal(check.status, 'na');
  assert.equal(check.reason.code, 'typography-hierarchy-level-unresolved');
});

test('written 区块配色 checks use only report current values and accept any matching descendant', async () => {
  const settingsReport = { block: { currentValues: [
    { section: '区块配色', type: 'color', value: '#123456', controlIndex: 0 },
    { section: '区块配色', type: 'color', value: '#654321', controlIndex: 1 },
    { section: 'unrelated', type: 'color', value: '#abcdef', controlIndex: 2 },
  ] } };
  assert.deepEqual(extractWrittenColorValues(settingsReport).map((item) => item.value), ['#123456', '#654321']);
  let calls = 0;
  const page = { evaluate: async () => ({ rootCount: 1, styles: ++calls === 1
    ? [{ color: 'rgb(18,52,86)', backgroundColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' }]
    : [{ color: 'rgb(0,0,0)', backgroundColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' }] }) };
  const checks = await runWrittenColorFrontChecks({ page, rootSelector: '[data-instance="target"]', settingsReport,
    includeStylesheets: false });
  assert.deepEqual(checks.map((item) => item.status), ['pass', 'fail']);
  assert.equal(checks[0].reason.expectedSource, 'run-report.currentValues');
  const unavailable = await runWrittenColorFrontChecks({ page: null, rootSelector: null, settingsReport });
  assert.ok(unavailable.every((item) => item.status === 'na' && item.reason.code === 'instance-root-unavailable'));
});
