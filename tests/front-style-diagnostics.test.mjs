import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addStyleFailureReasons, breakageFindings, resolveFrontStyleCapability, resolveItemApplicability, styleCheckDescriptors,
  textContentOracle, compareProps, isPaginationContainerMetadata } from '../src/capabilities/block-style-spec.mjs';
import { attachFrontStyleInstance, buildFrontStyleExecutionErrors, finalizeFrontStyleReport, preservePartialFrontStyleReport,
  resolveFrontStyleInstance, sanitizeFrontStyleError, sanitizeFrontStyleUrl } from '../src/front-style-report.mjs';

const capability = { id: 'block-style-spec', styleSpec: { viewports: { pc: 1440, pad: 768, mobile: 375 }, items: [
  { id: 'button-bg', kind: 'first', selector: 'a.action', props: { backgroundColor: '#1c4587', borderRadius: 3 } },
  { id: 'details-link', kind: 'presence', selector: 'a.details', text: 'Details' },
  { id: 'product-name', kind: 'sample', selector: '.name', props: { color: '#222222' }, clamp: 2 },
] } };

test('failed style comparisons include generic locator, match count, normalized expected/actual and viewport', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-button-bg', status: 'fail', detail: 'background differs',
    evidence: { matchedCount: 1, elements: [{ backgroundColor: 'rgb(0, 0, 0)', borderRadius: 4 }] } }],
  { capability, blockId: '777', viewports: capability.styleSpec.viewports });
  assert.equal(check.status, 'fail');
  assert.deepEqual(check.reason, {
    stage: 'compare', locator: 'unique block instance root',
    code: 'style-assertion-mismatch',
    matchedElementCount: 1, property: ['backgroundColor', 'borderRadius'],
    expected: { backgroundColor: '#1c4587', borderRadius: 3 },
    actual: [{ backgroundColor: '#000000', borderRadius: 4 }],
    viewport: { label: 'pc', width: 1440, height: 900 },
  });
});

test('skip/na reasons identify non-applicability or missing locator without changing status', () => {
  const [missing, na] = addStyleFailureReasons([
    { id: 'bss-nav-leaf', status: 'skip', detail: 'No matching visible elements.', evidence: { matchedCount: 0 } },
    { id: 'bss-details-link', status: 'na', detail: 'This profile has no details-link requirement.' },
  ], { capability, blockId: '777' });
  assert.equal(missing.status, 'skip');
  assert.equal(missing.reason.stage, 'locate');
  assert.equal(missing.reason.matchedElementCount, 0);
  assert.equal(missing.reason.applicability, 'No matching visible elements.');
  assert.equal(na.status, 'na');
  assert.equal(na.reason.applicability, 'This profile has no details-link requirement.');
});

test('breakage checks report the root locator, viewport, and count-valued expected/actual properties', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-breakage-mobile', status: 'fail', detail: 'overflow',
    evidence: { viewportWidth: 375, docScrollWidth: 390, rootMatchedCount: 1, horizontalOverflow: true,
      stickingOut: [], overlaps: [], textClipped: [], imgDistorted: [] } }], { capability, blockId: '777' });
  assert.equal(check.reason.stage, 'compare');
  assert.match(check.reason.locator, /block subtree layout invariants/);
  assert.equal(check.reason.matchedElementCount, 1);
  assert.deepEqual(check.reason.viewport, { label: 'mobile', width: 375, height: 667 });
  assert.deepEqual(check.reason.expected, { instanceOverflow: false, stickingOut: 0, overlaps: 0, textClipped: 0, imgDistorted: 0 });
  assert.equal(check.reason.actual.documentWidth, 390);
});

test('mobile page-level overflow is informational; internal clipping, overflow, or overlap remains a failure', () => {
  const pageOnly = { horizontalOverflow: true, docScrollWidth: 505, viewportWidth: 375,
    blockOverflow: false, stickingOut: [], overlaps: [], textClipped: [{ text: 'description' }], imgDistorted: [{ fit: 'fill' }] };
  assert.deepEqual(breakageFindings(pageOnly, { mobile: true }), ['实例内有 1 处可见文字被裁切：description']);
  assert.deepEqual(breakageFindings({ ...pageOnly, textClipped: [] }, { mobile: true }), []);
  assert.deepEqual(breakageFindings({ ...pageOnly, blockOverflow: true }, { mobile: true }), [
    '目标区块实例内部横向溢出', '实例内有 1 处可见文字被裁切：description',
  ]);
  assert.deepEqual(breakageFindings({ ...pageOnly, overlaps: [{ a: 'left', b: 'right' }] }, { mobile: true }), [
    '重叠 1 处：「left」压「right」', '实例内有 1 处可见文字被裁切：description',
  ]);
  const [check] = addStyleFailureReasons([{ id: 'bss-breakage-mobile', status: 'fail', detail: 'instance defect',
    evidence: { ...pageOnly, blockOverflow: true, pageLevelFinding: 'page-level overflow only' } }], { capability, blockId: '777' });
  assert.equal(check.reason.actual.pageLevelFinding, 'page-level overflow only');
});

test('auto-learned null-property placeholders are omitted from style descriptors', () => {
  const cap = { styleSpec: { items: [
    { id: 'written-palette-color', autoLearned: true, props: { color: null, backgroundColor: null } },
    { id: 'reviewed-color', autoLearned: true, props: { color: '#123456' } },
  ] } };
  const ids = styleCheckDescriptors(cap).map((item) => item.id);
  assert.equal(ids.includes('bss-written-palette-color'), false);
  assert.equal(ids.includes('bss-reviewed-color'), true);
});

test('navigation diagnostics do not expose which profile selector candidate was used', () => {
  const navCapability = { styleSpec: { items: [
    { id: 'nav-parent', kind: 'nav-parent', selector: '.categories a', props: { fontWeight: 700 } },
    { id: 'nav-leaf', kind: 'nav-leaf', selector: '.categories a', props: { fontWeight: 400 } },
  ] } };
  const [parent, leaf] = addStyleFailureReasons([
    { id: 'bss-nav-parent', status: 'skip', detail: 'No visible match', evidence: { matchedCount: 0 } },
    { id: 'bss-nav-leaf', status: 'fail', detail: 'weight mismatch', evidence: { matchedCount: 1, elements: [{ fontWeight: 700 }] } },
  ], { capability: navCapability, blockId: '777' });
  assert.match(parent.reason.locator, /unique block instance root/);
  assert.match(leaf.reason.locator, /unique block instance root/);
  assert.doesNotMatch(parent.reason.locator, /\.categories/);
  assert.equal(leaf.status, 'fail');
});

test('selectors without offline DOM snapshots remain na and do not guess replacements', () => {
  const cap = { styleSpec: { items: [{ id: 'nav-parent', kind: 'nav-parent', selector: '.old-selector',
    notApplicableReason: 'No offline DOM snapshot.' }] } };
  const [check] = addStyleFailureReasons([{ id: 'bss-nav-parent', status: 'na', detail: 'No offline DOM snapshot.',
    evidence: { matchedCount: 0 } }], { capability: cap, blockId: '1' });
  assert.equal(check.status, 'na');
  assert.equal(check.reason.applicability, 'No offline DOM snapshot.');
});

test('all na and fail report reason codes are strings, including object-valued diagnostics', () => {
  const capability = { styleSpec: { items: [{ id: 'button-bg', kind: 'first', props: { color: '#123456' } }] } };
  const converted = addStyleFailureReasons([
    { id: 'bss-button-bg', status: 'na', detail: 'unresolved', evidence: { machineReason: { code: 'scope-unmapped' } } },
    { id: 'bss-button-bg-2', status: 'fail', detail: 'wrong', evidence: { machineReason: { code: 'value-mismatch' } } },
  ], { capability });
  const report = finalizeFrontStyleReport({ checks: [...converted,
    { id: 'bad-code', status: 'fail', reason: { code: { code: 'nested' } } },
    { id: 'bad-na-code', status: 'na', reason: { code: { code: 'nested' } } }] });
  assert.ok(report.checks.filter((check) => ['na', 'fail'].includes(check.status))
    .every((check) => typeof check.reason?.code === 'string' && !check.reason.code.includes('[object Object]')));
});

test('partial report preserves completed checks when execution is interrupted', () => {
  const check = { id: 'done', status: 'pass' };
  const partial = preservePartialFrontStyleReport({ checks: [check] }, { stage: 'design-spec', error: new Error('timeout') });
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.checks, [check]);
  assert.equal(partial.executionError.stage, 'design-spec');
});

test('navigation fallback derives link candidates only from the uniquely scoped instance root', () => {
  const source = fs.readFileSync(new URL('../src/capabilities/block-style-spec.mjs', import.meta.url), 'utf8');
  assert.match(source, /frame\.evaluate\(readInstanceStructure, \{ rootSelector: rootSel \}\)/);
  assert.match(source, /candidateSource = 'instance-root-structural-hierarchy'/);
  assert.doesNotMatch(source, /document\.querySelectorAll\('a, \[role="link"\]'\)/);
  assert.match(source, /navigation \? 'na' : 'skip'/);
  assert.match(source, /no-semantic-link-hierarchy-in-instance/);
  const cap = { styleSpec: { items: [{ id: 'nav-parent', kind: 'nav-parent', selector: '.stale',
    notApplicableReason: 'No semantic links inside the selected instance root.' }] } };
  const [check] = addStyleFailureReasons([{ id: 'bss-nav-parent', status: 'na',
    detail: 'No semantic links inside the selected instance root.', evidence: { matchedCount: 0 } }], { capability: cap });
  assert.equal(check.status, 'na');
  assert.equal(check.reason.matchedElementCount, 0);
});

test('mobile reason distinguishes page overflow and lists overflow, overlap and clipped selectors', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-breakage-mobile', status: 'fail', detail: 'overflow',
    evidence: { viewportWidth: 375, docScrollWidth: 505, rootMatchedCount: 1, horizontalOverflow: true,
      horizontalOverflowScope: 'page-wide', blockOverflow: true, blockRoot: '[data-front-style-target="selected"]',
      stickingOut: [{ selector: '.card:nth-of-type(2) > img' }],
      overlaps: [{ aSelector: '.selection-count', bSelector: '.remove-all' }],
      textClipped: [{ selector: '.summary > span' }], imgDistorted: [] } }], { capability, blockId: '777' });
  assert.equal(check.status, 'fail');
  assert.deepEqual(check.reason.actual.offendingElementSelectors, ['.card:nth-of-type(2) > img']);
  assert.equal(check.reason.actual.overflowScope, 'page-wide');
  assert.deepEqual(check.reason.actual.overflowAttribution, { pageLevel: true, instance: true, source: 'page-and-instance' });
  assert.equal(check.reason.actual.blockRoot, '[data-front-style-target="selected"]');
  assert.deepEqual(check.reason.actual.overlapElementSelectors, ['.selection-count ↔ .remove-all']);
  assert.deepEqual(check.reason.actual.clippedElementSelectors, ['.summary > span']);
});

test('run-written style values override defaults only when their setting check ran', () => {
  const sourceCapability = { id: 'block-style-spec', styleSpec: { items: [
    { id: 'button-bg', kind: 'first', selector: 'a.action', props: { backgroundColor: '#000000' } },
    { id: 'pagination-other', kind: 'sample', selector: '.pagination a', props: { color: '#111111' } },
  ], expectedValueSources: {
    'button-bg.backgroundColor': { control: { region: 'right-rail-color', label: 'scheme' }, profileDefault: '#000000', settingCheckIds: ['color-write'] },
    'pagination-other.color': { profileDefault: '#898989', settingCheckIds: ['pagination-color-write'] },
  } } };
  const resolved = resolveFrontStyleCapability(sourceCapability, { block: { currentValues: [
    { region: 'right-rail-color', label: 'scheme', type: 'text', value: 'rgb(242, 242, 245)' },
  ] }, checks: [{ id: 'color-write', status: 'pass' }] });
  assert.equal(resolved.styleSpec.items[0].props.backgroundColor, '#f2f2f5');
  assert.equal(resolved.styleSpec.items[1].props.color, undefined);
  assert.equal(resolved.styleSpec.items[1].resolvedExpectedSources.color, 'not set this run');
  const [dynamic, fallback] = addStyleFailureReasons([
    { id: 'bss-button-bg', status: 'fail', evidence: { matchedCount: 1, elements: [{ backgroundColor: '#fff' }] } },
    { id: 'bss-pagination-other', status: 'na', detail: 'not set this run', evidence: { notSetProperties: ['color'] } },
  ], { capability: resolved, blockId: '777' });
  assert.equal(dynamic.reason.expected.backgroundColor, '#f2f2f5');
  assert.match(dynamic.reason.expectedSource.backgroundColor, /^run-report:block\.currentValues\[/);
  assert.deepEqual(fallback.reason.expected, { notSetThisRun: ['color'] });
  assert.equal(fallback.detail, 'not set this run');
});

test('pagination palette binding stays on current-page background and never recolors non-current text', () => {
  const profile = JSON.parse(fs.readFileSync(new URL('../profiles/47748.json', import.meta.url), 'utf8'));
  const capability = profile.capabilities.find((entry) => entry.id === 'block-style-spec');
  const resolved = resolveFrontStyleCapability(capability, { block: { currentValues: [
    { region: 'right-rail-color', label: '配色方案', value: 'rgb(255, 0, 0)' },
  ] }, checks: [{ id: 'bcs-color-persist', status: 'pass' }] });
  assert.equal(resolved.styleSpec.items.find((item) => item.id === 'pagination-current').props.backgroundColor, '#ff0000');
  assert.equal(resolved.styleSpec.items.find((item) => item.id === 'pagination-other').props.color, '#898989');
  assert.equal(resolved.styleSpec.expectedValueSources['pagination-other.color'], undefined);
});

test('editor-learned instance-relative selector and value override profile candidates without exposing a matched selector', () => {
  const source = { styleSpec: { items: [{ id: 'button-bg', kind: 'first', learnedSelectorRequired: true,
    selectorCandidates: ['a.profile-candidate'], learnedSelectors: { backgroundColor: [{ selector: ':scope > a.action',
      expectedValue: 'rgb(255, 0, 0)' }] }, props: { backgroundColor: '#000000' } }] } };
  const resolved = resolveFrontStyleCapability(source, { styleScopeLearning: [{ status: 'learned', expectedValues: {
    'bss-button-bg': { backgroundColor: 'rgb(255, 0, 0)' },
  } }] });
  const item = resolved.styleSpec.items[0];
  assert.equal(item.props.backgroundColor, '#ff0000');
  assert.equal(item.resolvedExpectedSources.backgroundColor, 'run-written-editor-style-effect');
  assert.equal(item.selector, ':scope > a.action');
  assert.equal(item.selectorLearningUnavailable, false);
  assert.doesNotMatch(JSON.stringify(resolved.styleSpec.resolvedExpectedSources), /selector/);
});

test('automatic style checks use all learned instance paths and stay selector-free in result diagnostics', () => {
  const source = { id: 'block-style-spec', styleSpec: { items: [{ id: 'auto-style-setting-font-size',
    name: '自动样式值检查', kind: 'sample', sample: 500, learnedSelectorRequired: true, autoLearned: true,
    selectorLearningPending: true, styleProperty: 'fontSize', props: { fontSize: null }, learnedSelectors: {
      fontSize: [{ selector: 'div.card > a.title', expectedValue: '18px' }, { selector: 'p.name', expectedValue: '18px' }],
    } }] } };
  const resolved = resolveFrontStyleCapability(source, { styleScopeLearning: [{ status: 'learned', expectedValues: {
    'bss-auto-style-setting-font-size': { fontSize: '18px' },
  } }] });
  const item = resolved.styleSpec.items[0];
  assert.deepEqual(item.selectorCandidates, ['div.card > a.title', 'p.name']);
  assert.equal(item.selector, 'div.card > a.title, p.name');
  assert.equal(item.learnedSelectorResolved, true);
  assert.equal(item.props.fontSize, '18px');
  assert.ok(styleCheckDescriptors(resolved).some((entry) => entry.id === 'bss-auto-style-setting-font-size'));
  const [check] = addStyleFailureReasons([{ id: 'bss-auto-style-setting-font-size', status: 'fail',
    detail: 'computed value mismatch', evidence: { matchedCount: 1, elements: [{ fontSize: 16 }] } }],
  { capability: resolved, blockId: 'generic' });
  assert.equal(check.status, 'fail');
  assert.equal(check.name, '自动样式值检查');
  assert.doesNotMatch(JSON.stringify(check), /div\.card|p\.name/);
});

test('ambiguous or unwritten setting values do not fall back to profile defaults with a run report', () => {
  const capability = { styleSpec: { items: [{ id: 'button-bg', props: { backgroundColor: '#111111' } }],
    expectedValueSources: { 'button-bg.backgroundColor': {
      control: { region: 'rail', label: 'color' }, profileDefault: '#222222',
    } } } };
  const resolved = resolveFrontStyleCapability(capability, { block: { currentValues: [
    { region: 'rail', label: 'color', value: '#333333' },
    { region: 'rail', label: 'color', value: '#444444' },
  ] } });
  assert.equal(resolved.styleSpec.items[0].props.backgroundColor, undefined);
  assert.equal(resolved.styleSpec.items[0].resolvedExpectedSources.backgroundColor, 'not set this run');
});

test('profile defaults are available only when no run report is supplied', () => {
  const capability = { styleSpec: { items: [{ id: 'button-bg', props: { backgroundColor: '#111111' } }],
    expectedValueSources: { 'button-bg.backgroundColor': { profileDefault: '#222222', control: { region: 'rail' } } } } };
  const resolved = resolveFrontStyleCapability(capability, null);
  assert.equal(resolved.styleSpec.items[0].props.backgroundColor, '#222222');
  assert.equal(resolved.styleSpec.items[0].resolvedExpectedSources.backgroundColor, 'profile-default:button-bg.backgroundColor');
});

test('details applicability follows the profile-declared toggle check from the run report', () => {
  const item = { applicability: { checkId: 'details-toggle', valuePath: 'actual', equals: true } };
  assert.equal(resolveItemApplicability(item, { checks: [{ id: 'details-toggle', status: 'pass', actual: true }] }).applicable, true);
  assert.equal(resolveItemApplicability(item, { checks: [{ id: 'details-toggle', status: 'pass', actual: false }] }).applicable, false);
  assert.equal(resolveItemApplicability(item, { checks: [{ id: 'details-toggle', status: 'skip' }] }).reason, 'not set this run');
  assert.match(resolveItemApplicability({ requireApplicableToggle: true }, {}).reason, /not set this run/);
});

test('front instance scope uses settingId, detects one instance, and refuses ambiguous matches', () => {
  const rows = [{ identities: ['siteblocks-setting-wrap-other'] }, { identities: ['siteblocks-setting-wrap-target'] }];
  assert.deepEqual(resolveFrontStyleInstance(rows, 'target'), {
    instanceCount: 2, matchCount: 1, index: 1, settingId: 'target', resolution: 'settingId',
  });
  assert.equal(resolveFrontStyleInstance([{ identities: ['siteblocks-setting-wrap-single'] }]).settingId, 'single');
  assert.equal(resolveFrontStyleInstance(rows).index, null);
});

test('every front-style result row carries the report or detected settingId', () => {
  assert.deepEqual(attachFrontStyleInstance([{ id: 'bss-a' }, { id: 'bss-b', settingId: 'old' }], 'instance-1'),
    [{ id: 'bss-a', settingId: 'instance-1' }, { id: 'bss-b', settingId: 'instance-1' }]);
  assert.equal(attachFrontStyleInstance([{ id: 'bss-a' }], null)[0].settingId, null);
});

test('thrown style errors retain a bounded class/message while keeping the locator stage', () => {
  const [check] = addStyleFailureReasons([{ id: 'bss-button-bg', name: 'background', status: 'fail',
    detail: 'style runner stopped', errorDiagnostic: { stage: 'read', class: 'TimeoutError', message: 'selector wait failed' } }],
  { capability, blockId: '777' });
  assert.equal(check.reason.stage, 'read');
  assert.deepEqual(check.reason.error, { class: 'TimeoutError', message: 'selector wait failed' });
});

test('style check descriptors preserve profile checks and add breakage viewports without inventing checks', () => {
  assert.deepEqual(styleCheckDescriptors(capability).map(({ id }) => id), [
    'bss-button-bg', 'bss-details-link', 'bss-product-name', 'bss-product-name-clamp',
    'bss-breakage-pc', 'bss-breakage-pad', 'bss-breakage-mobile',
  ]);
});

test('inventory-derived uncertain style items are exposed as record-only checks', () => {
  const inventoryCapability = { styleSpec: { items: [], recordOnly: [
    { id: 'inventory-module-width', name: 'Module width inventory', inventoryCapability: 'module-width' },
  ] } };
  assert.deepEqual(styleCheckDescriptors(inventoryCapability).map(({ id }) => id), [
    'bss-inventory-module-width', 'bss-breakage-pc', 'bss-breakage-pad', 'bss-breakage-mobile',
  ]);
});

test('the onboarding profile asserts its known button text and keeps other unreviewed inventory record-only', () => {
  const profile = JSON.parse(fs.readFileSync(new URL('../profiles/47498.json', import.meta.url), 'utf8'));
  const style = profile.capabilities.find((entry) => entry.id === 'block-style-spec')?.styleSpec;
  assert.ok(style);
  const reviewedIds = new Set(style.items.map((entry) => entry.id));
  assert.deepEqual(style.recordOnly.map((entry) => entry.inventoryCapability), profile.onboarding.matched
    .filter((entry) => !reviewedIds.has(`inventory-${entry.id}`)).map((entry) => entry.capability));
  assert.ok(style.recordOnly.every((entry) => /No front-end selector/.test(entry.note)));
  const text = style.items.find((entry) => entry.id === 'inventory-btn-text');
  assert.equal(text.kind, 'text-content');
  assert.equal(text.text, null);
  assert.deepEqual(text.runValueSource.control, { region: 'button-popover', label: '按钮文本' });
  assert.deepEqual(text.runValueSource.settingCheckIds, ['btn-text-persist']);
  const resolved = resolveFrontStyleCapability(profile.capabilities.find((entry) => entry.id === 'block-style-spec'), {
    block: { currentValues: [{ region: 'button-popover', label: '按钮文本', type: 'text', value: 'AUTOTEST-BTN' }] },
    checks: [{ id: 'btn-text-persist', status: 'pass' }],
  });
  assert.equal(resolved.styleSpec.items.find((entry) => entry.id === 'inventory-btn-text').text, 'AUTOTEST-BTN');
  assert.equal(styleCheckDescriptors({ styleSpec: style }).some((entry) => entry.id === 'bss-inventory-btn-text'), true);
});

test('inventory text oracle resolves from the uniquely bound value written this run', () => {
  const source = { id: 'block-style-spec', styleSpec: { items: [{ id: 'inventory-button-label', kind: 'text-content',
    text: 'stale-default', runValueSource: { control: { region: 'button-popover', label: 'Button label' },
      settingCheckIds: ['button-label-persist'] } }] } };
  const report = { block: { currentValues: [{ region: 'button-popover', label: 'Button label', type: 'text', value: 'AUTOTEST-BTN' }] },
    checks: [{ id: 'button-label-persist', status: 'pass' }] };
  const resolved = resolveFrontStyleCapability(source, report);
  assert.equal(resolved.styleSpec.items[0].text, 'AUTOTEST-BTN');
  assert.deepEqual(textContentOracle(resolved.styleSpec.items[0]), { status: 'resolved', expected: 'AUTOTEST-BTN',
    source: resolved.styleSpec.items[0].resolvedExpectedSources.text });
  assert.match(resolved.styleSpec.items[0].resolvedExpectedSources.text, /^run-report:block\.currentValues/);
});

test('inventory text oracle does not guess when the run value is missing or ambiguous', () => {
  const source = { styleSpec: { items: [{ id: 'inventory-label', kind: 'text-content', text: 'stale',
    runValueSource: { control: { region: 'button-popover', label: 'Button label' },
      settingCheckIds: ['button-label-persist'] } }] } };
  const missing = resolveFrontStyleCapability(source, { block: { currentValues: [] }, checks: [] });
  assert.equal(missing.styleSpec.items[0].text, null);
  assert.equal(missing.styleSpec.items[0].valueResolutionReason, 'run-control-value-not-unique');
  assert.deepEqual(textContentOracle(missing.styleSpec.items[0]), { status: 'na', reason: 'run-control-value-not-unique' });
  const ambiguous = resolveFrontStyleCapability(source, { block: { currentValues: [
    { region: 'button-popover', label: 'Button label', value: 'A' },
    { region: 'button-popover', label: 'Button label', value: 'B' },
  ] }, checks: [{ id: 'button-label-persist', status: 'pass' }] });
  assert.equal(ambiguous.styleSpec.items[0].text, null);
  assert.equal(ambiguous.styleSpec.items[0].valueResolutionReason, 'run-control-value-not-unique');
});

test('inventory text falls back to the last setting value written, then to an explicit AUTOTEST marker', () => {
  const source = { styleSpec: { items: [{ id: 'inventory-label', kind: 'text-content', text: null,
    runValueSource: { control: { region: 'button-popover', label: 'Button label' },
      settingCheckIds: ['button-label-persist'] } }] } };
  const ambiguous = { block: { currentValues: [
    { region: 'button-popover', label: 'Button label', value: 'Old' },
    { region: 'button-popover', label: 'Button label', value: 'New' },
  ] }, checks: [{ id: 'button-label-persist', status: 'pass', value: 'AUTOTEST-WRITTEN' }] };
  const written = resolveFrontStyleCapability(source, ambiguous).styleSpec.items[0];
  assert.equal(written.text, 'AUTOTEST-WRITTEN');
  assert.equal(written.resolvedExpectedSources.text, 'run-report:checks[button-label-persist].value');
  const marked = resolveFrontStyleCapability(source, { autotestMarker: 'AUTOTEST-RUN' }).styleSpec.items[0];
  assert.equal(marked.text, 'AUTOTEST-RUN');
  assert.equal(marked.resolvedExpectedSources.text, 'run-report:autotest-marker');
});

test('style dimensions use configurable two-pixel default tolerance while colors remain exact', () => {
  assert.deepEqual(compareProps({ fontSize: 14, width: 28, color: '#ffffff' },
    { fontSize: 15.99, width: 29.99, color: '#fffffe' }, { px: 0.6, sizePx: 2 }), ['文字颜色设计为 #ffffff，实测为 #fffffe']);
  assert.deepEqual(compareProps({ fontSize: 14 }, { fontSize: 16.01 }, { sizePx: 2 }), ['字号设计为 14px，实测为 16.01px']);
  assert.deepEqual(compareProps({ width: 28 }, { width: 30 }, { sizePx: 2 }), ['宽设计为 28px，实测为 30px']);
});

test('pagination semantic scope requires a pagination container inside the instance root', () => {
  assert.equal(isPaginationContainerMetadata({ tagName: 'DIV', className: 'product-pagination' }), true);
  assert.equal(isPaginationContainerMetadata({ tagName: 'NAV', role: 'navigation', ariaLabel: 'Pagination' }), true);
  assert.equal(isPaginationContainerMetadata({ tagName: 'DIV', className: 'product-list' }), false);
});

test('profile button style shares the CSS target without requiring stale button copy', () => {
  const profile = JSON.parse(fs.readFileSync(new URL('../profiles/47748.json', import.meta.url), 'utf8'));
  const items = profile.capabilities.find((entry) => entry.id === 'block-style-spec').styleSpec.items;
  const text = items.find((entry) => entry.id === 'button-text');
  const background = items.find((entry) => entry.id === 'button-bg');
  assert.equal(text.kind, 'first');
  assert.deepEqual(text.selectorCandidates, background.selectorCandidates);
  assert.equal(text.text, undefined);
  assert.deepEqual(text.props, { color: '#ffffff', fontSize: 18, fontWeight: 700 });
});

test('front-style setup errors create per-check error reasons without changing assertion verdicts or leaking secrets', () => {
  const error = Object.assign(new Error('request failed https://user:pass@example.test/p?q=secret token=abc'), { name: 'TimeoutError' });
  const [check] = buildFrontStyleExecutionErrors({ capability, blockId: '777', stage: 'locate-block', error });
  assert.equal(check.status, 'error');
  assert.equal(check.reason.stage, 'locate');
  assert.equal(check.reason.matchedElementCount, null);
  assert.equal(check.reason.error.class, 'TimeoutError');
  assert.doesNotMatch(JSON.stringify(check.reason), /user|pass|secret|abc|https?:/);
  assert.equal(sanitizeFrontStyleUrl('https://u:p@example.test/a?t=4&token=x#hash'), 'https://example.test/a?t=4');
  assert.equal(sanitizeFrontStyleError(error).message.includes('token=[redacted]'), true);
});
