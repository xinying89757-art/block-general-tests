import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDesignRequirementEditor, checkDesignRequirementFront, extractWrittenColorValues,
  countInstanceColorMatches, normalizeDesignColor, runWrittenColorFrontChecks, validateDesignSpec } from '../src/design-spec-checklist.mjs';
import { importExtractedDesignSpec } from '../scripts/import-design-spec.mjs';

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
