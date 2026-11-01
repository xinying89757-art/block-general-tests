import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteWriteReadback } from '../src/capabilities/rail.mjs';
import { countCssColorMatches, runWrittenColorFrontChecks, runWrittenColorStylesheetSearch,
  exerciseWrittenColorStates, isSafeStateExerciseTarget } from '../src/design-spec-checklist.mjs';
import { dedupeChecksById } from '../src/front-check-utils.mjs';

test('palette write readback compares the actual input value with the value set', () => {
  assert.deepEqual(paletteWriteReadback('#d0b647', 'rgb(208, 182, 71)'), {
    setValue: '#d0b647', readBackValue: 'rgb(208, 182, 71)', matched: true,
  });
  assert.deepEqual(paletteWriteReadback('#d0b647', 'rgb(13, 13, 10)'), {
    setValue: '#d0b647', readBackValue: 'rgb(13, 13, 10)', matched: false,
    reason: 'palette-write-readback-mismatch',
  });
});

test('CSS color scanner recognizes rgb/rgba, hex alpha, and hsl while accepting alpha at most one', () => {
  assert.equal(countCssColorMatches('x{color:rgba(208,182,71,.4)}', '#d0b647'), 1);
  assert.equal(countCssColorMatches('x{color:#0d0d0a80}', 'rgb(13,13,10)'), 1);
  assert.equal(countCssColorMatches('x{color:hsla(0,100%,50%,1)}', '#ff0000'), 1);
  assert.equal(countCssColorMatches('x{color:rgba(13,13,10,1.2)}', '#0d0d0a'), 0);
  assert.equal(countCssColorMatches('x{color:rgba(208 182 71 / 50%)}', '#d0b647'), 1);
  assert.equal(countCssColorMatches('x{color:hsla(208, 40%, 55%, 50%)}', 'hsl(208, 40%, 55%)'), 1);
});

test('the unified scanner distinguishes instance CSS-only from absent and element-found', async () => {
  const settingsReport = { blockId: 'generic', block: { currentValues: [
    { region: 'right-rail-color', type: 'color', value: 'rgb(208, 182, 71)' },
  ] } };
  let matchedRules = [];
  let evaluations = 0;
  const page = { evaluate: async (_fn, arg) => {
    if (arg?.declarations) return arg.declarations.flatMap((rule) => {
      const match = matchedRules.find((candidate) => candidate.selector === rule.selector);
      return match ? [{ ...rule, ...match }] : [];
    });
    evaluations += 1;
    if (evaluations === 1) return { links: ['https://assets.test/style.css?secret=never-log'], preloads: [], inline: ['.other{--palette: #d0b647}'],
      inlineRules: [], linkRules: [], unreadableSheets: [], baseUrl: 'https://site.invalid/products.html' };
    return { rootCount: 1, styles: [{ color: 'transparent', backgroundColor: 'transparent' }] };
  }, request: { get: async () => ({ ok: () => true, text: async () => '.x{background: rgba(208, 182, 71, .5); stroke:#d0b647}' }) } };
  matchedRules = [{ selector: '.x', properties: ['background', 'stroke'], source: 'external-0', matchedSelectors: ['.x'] }];
  const cssOnly = await runWrittenColorFrontChecks({ page, rootSelector: '.target', settingsReport });
  assert.equal(cssOnly[0].status, 'record');
  assert.equal(cssOnly[0].classification, 'instance-scoped-css-only');
  assert.equal(cssOnly[0].reason.code, 'instance-scoped-css-only');
  assert.deepEqual(cssOnly[0].actual.stylesheetEvidence.rules[0].properties, ['background', 'stroke']);
  assert.deepEqual(cssOnly[0].actual.stylesheetEvidence.rules[0].matchedSelectors, ['.x']);
  matchedRules = [];
  evaluations = 1;
  const absent = await runWrittenColorFrontChecks({ page, rootSelector: '.target', settingsReport,
    includeStylesheets: false });
  assert.equal(absent[0].status, 'fail');
  assert.equal(absent[0].classification, 'absent');
  assert.equal(absent[0].reason.code, 'absent');
  const element = { evaluate: async () => ({ rootCount: 1, styles: [{ outlineColor: 'rgb(208, 182, 71)' }] }) };
  const found = await runWrittenColorFrontChecks({ page: element, rootSelector: '.target', settingsReport,
    includeStylesheets: false });
  assert.equal(found[0].status, 'pass');
  assert.equal(found[0].classification, 'found-on-element');
  assert.equal(found[0].reason.code, 'found-on-element');
});

test('CSS-only classification carries matching target-scoped selectors and exact properties', async () => {
  const settingsReport = { block: { currentValues: [{ section: '区块配色', type: 'color', value: '#d0b647' }] } };
  let call = 0;
  const page = { evaluate: async (_fn, arg) => {
    if (arg?.declarations) return arg.declarations.filter((rule) => rule.selector.includes('.target'))
      .map((rule) => ({ ...rule, matchedSelectors: rule.selectors.filter((selector) => selector.includes('.target')) }));
    call += 1;
    if (call === 1) return { links: [], inline: ['.target :is(.card, .tile)::before { background-image: linear-gradient(#d0b647, transparent); fill: #d0b647 } .other { color: #d0b647 }'] };
    return { rootCount: 1, styles: [{ color: 'transparent' }] };
  } };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '.target', settingsReport });
  assert.equal(row.classification, 'instance-scoped-css-only');
  assert.equal(row.actual.stylesheetEvidence.rules[0].selector, '.target :is(.card, .tile)::before');
  assert.deepEqual(row.actual.stylesheetEvidence.rules[0].properties, ['background-image', 'fill']);
  assert.deepEqual(row.actual.stylesheetEvidence.rules.map((rule) => rule.selector), ['.target :is(.card, .tile)::before']);
});

test('G54-style external cross-origin instance rule is scoped by the settingId root, not block number classes', async () => {
  const settingsReport = { blockId: '47748', block: { settingId: 'instance-rAfbpBFNQHvy', currentValues: [
    { section: '区块配色', type: 'color', value: '#d0b647' },
  ] } };
  const rootSelector = '#siteblocks-setting-wrap-instance-rAfbpBFNQHvy';
  const css = '@media (min-width: 1px) { .blockCon47648 .pf-btn-wrap a.blocks-button { background-color: #d0b647; } }';
  let nodeUrls = [];
  let pageEvaluations = 0;
  const page = {
    context: () => ({ request: { get: async (url) => { throw new Error(`context request failed for ${url}`); } } }),
    evaluate: async (_fn, arg) => {
      if (arg?.declarations) {
        assert.equal(arg.rootSelector, rootSelector);
        // The modeled DOM has a matched element inside the selected instance root;
        // its outer framework class intentionally ends in a different number.
        return arg.declarations.filter((rule) => rule.selector.includes('.blockCon47648')
          && rule.selector.includes('a.blocks-button')).map((rule) => ({ ...rule,
          matchedSelectors: ['.blockCon47648 .pf-btn-wrap a.blocks-button'] }));
      }
      pageEvaluations += 1;
      if (pageEvaluations === 1) return { links: ['https://cdn.invalid/leadong-block.css?cache=token'], preloads: [], inline: [], inlineRules: [],
        linkRules: [], unreadableSheets: [{ href: 'https://cdn.invalid/leadong-block.css?cache=token', reason: 'SecurityError' }],
        baseUrl: 'https://site.invalid/products.html' };
      return { rootCount: 1, styles: [{ color: 'transparent' }] };
    },
  };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector, settingsReport, fetchNode: async (url) => {
    nodeUrls.push(url);
    if (url.startsWith('https:')) throw new Error('node https transport failed');
    return { ok: true, text: async () => css };
  } });
  assert.equal(row.classification, 'instance-scoped-css-only');
  assert.equal(row.status, 'record');
  assert.equal(nodeUrls[0], 'https://cdn.invalid/leadong-block.css?cache=token');
  assert.equal(nodeUrls[1], 'http://cdn.invalid/leadong-block.css?cache=token');
  assert.equal(row.actual.stylesheetEvidence.rules[0].selector, '.blockCon47648 .pf-btn-wrap a.blocks-button');
  assert.deepEqual(row.actual.stylesheetEvidence.rules[0].declarations, [{ property: 'background-color', value: '#d0b647' }]);
  assert.equal(row.actual.stylesheetEvidence.rules[0].sheetUrl, 'https://cdn.invalid/leadong-block.css');
  assert.equal(row.actual.stylesheetEvidence.unreadableSheetCount, 0,
    'CSSOM SecurityError is resolved by the successful Node-side stylesheet fetch');
  assert.equal(row.actual.stylesheetEvidence.recoveredFetchCount, 1);
  assert.equal(row.actual.stylesheetEvidence.recoveredFetches[0].url, 'https://cdn.invalid/leadong-block.css');
  assert.doesNotMatch(JSON.stringify(row), /cache=token/);
});

test('unresolved stylesheet fetch and CSSOM failures produce inconclusive, never absent', async () => {
  const settingsReport = { block: { currentValues: [{ section: '区块配色', type: 'color', value: '#d0b647' }] } };
  const page = {
    context: () => ({ request: { get: async () => { throw new Error('SecurityError'); } } }),
    evaluate: async (_fn, arg) => arg?.declarations ? [] : ({ links: ['https://cdn.invalid/missing.css?auth=secret'],
      inline: [], inlineRules: [], linkRules: [], unreadableSheets: [{ href: 'https://cdn.invalid/missing.css?auth=secret', reason: 'SecurityError' }],
      baseUrl: 'https://site.invalid/products.html', rootCount: 1, styles: [{ color: 'transparent' }] }),
  };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '.instance-root', settingsReport,
    fetchNode: async () => { throw new Error('node network unavailable'); } });
  assert.equal(row.classification, 'inconclusive-stylesheet-unavailable');
  assert.equal(row.status, 'record');
  assert.equal(row.reason.code, 'inconclusive-stylesheet-unavailable');
  assert.equal(row.actual.stylesheetEvidence.fetchFailureCount, 1);
  assert.equal(row.actual.stylesheetEvidence.fetchFailureCount, row.actual.stylesheetEvidence.fetchFailures.length);
  assert.equal(row.actual.stylesheetEvidence.unreadableSheetCount, 1);
  assert.equal(row.actual.stylesheetEvidence.fetchFailures[0].url, 'https://cdn.invalid/missing.css');
  assert.equal(row.actual.stylesheetEvidence.fetchFailures[0].attempts.length, 4);
  assert.doesNotMatch(JSON.stringify(row), /auth=secret/);
});

test('unreadable font-only stylesheets are excluded from color uncertainty and fetch accounting stays explicit', async () => {
  let call = 0;
  const page = {
    context: () => ({ request: { get: async () => { throw new Error('network unavailable'); } } }),
    evaluate: async (_fn, arg) => {
      if (arg?.declarations) return [];
      call += 1;
      return call === 1 ? { links: ['https://fonts.googleapis.com/css?family=Example'], preloads: [], inline: [],
        inlineRules: [], linkRules: [], unreadableSheets: [{ href: 'https://fonts.googleapis.com/css?family=Example', reason: 'SecurityError' }],
        baseUrl: 'https://site.invalid/page' }
        : { rootCount: 1, styles: [{ color: 'transparent' }] };
    },
  };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '.instance-root', settingsReport: {
    block: { currentValues: [{ section: '区块配色', type: 'color', value: '#d0b647' }] },
  }, fetchNode: async () => { throw new Error('node network unavailable'); } });
  const evidence = row.actual.stylesheetEvidence;
  assert.equal(row.classification, 'absent');
  assert.equal(evidence.fetchFailureCount, evidence.fetchFailures.length);
  assert.equal(evidence.unreadableSheetCount, 0);
  assert.equal(evidence.excludedSheets[0].exclusionReason, 'font-face-only-host');
});

test('a fully fetched stylesheet with no selector in the instance cannot make a color inconclusive', async () => {
  let call = 0;
  const page = { evaluate: async (_fn, arg) => {
    if (arg?.declarations) return [];
    call += 1;
    return call === 1 ? { links: ['https://assets.invalid/unrelated.css'], preloads: [], inline: [], inlineRules: [],
      linkRules: [], unreadableSheets: [], baseUrl: 'https://site.invalid/page' }
      : { rootCount: 1, styles: [{ color: 'transparent' }] };
  } };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '.instance-root', settingsReport: {
    block: { currentValues: [{ section: '区块配色', type: 'color', value: '#d0b647' }] },
  }, fetchStylesheet: async () => '.unrelated .text { color: #ffffff; }' });
  assert.equal(row.classification, 'absent');
  assert.equal(row.actual.stylesheetEvidence.unreadableSheetCount, 0);
  assert.equal(row.actual.stylesheetEvidence.excludedSheets[0].reason, 'no-selector-matches-instance');
});

test('linked, preloaded and imported stylesheets are recursively included and failure evidence is explicit', async () => {
  const urls = [];
  const page = {
    context: () => ({ request: { get: async (url) => { urls.push(url); return { ok: () => true, text: async () => url.endsWith('root.css')
      ? '@import "nested.css"; .outside{color:#d0b647}' : '.instance .target{background:#d0b647}' }; } } }),
    evaluate: async (_fn, arg) => {
      if (arg?.declarations) return arg.declarations.filter((rule) => rule.selector.includes('.instance'))
        .map((rule) => ({ ...rule, matchedSelectors: rule.selectors }));
      if (!page.inventoryRead) { page.inventoryRead = true; return { links: ['https://cdn.invalid/root.css'],
        preloads: ['https://cdn.invalid/preloaded.css'], inline: ['@import "inline-import.css";'], inlineRules: [],
        linkRules: [], unreadableSheets: [], baseUrl: 'https://site.invalid/products.html' }; }
      return { rootCount: 1, styles: [{ color: 'transparent' }] };
    },
  };
  const settingsReport = { block: { currentValues: [{ section: '区块配色', type: 'color', value: '#d0b647' }] } };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '.instance', settingsReport });
  assert.deepEqual(urls, ['https://cdn.invalid/root.css', 'https://cdn.invalid/preloaded.css',
    'https://site.invalid/inline-import.css', 'https://cdn.invalid/nested.css']);
  assert.equal(row.actual.stylesheetEvidence.sheetCount, 4);
  assert.equal(row.actual.stylesheetEvidence.linkedStylesheetCount, 1);
  assert.equal(row.actual.stylesheetEvidence.preloadStyleCount, 1);
  assert.equal(row.actual.stylesheetEvidence.importedStylesheetCount, 2);
  assert.equal(row.actual.stylesheetEvidence.rules[0].sheetUrl, 'https://cdn.invalid/preloaded.css');
});

test('standalone stylesheet evidence is scoped to the instance and is not a pass', async () => {
  const settingsReport = { blockId: 'generic', block: { currentValues: [
    { region: 'right-rail-color', type: 'color', value: 'rgb(208, 182, 71)' },
  ] } };
  const page = { evaluate: async (_fn, arg) => arg?.declarations ? [{ selector: '.x', selectors: ['.x'],
    declarations: [{ property: 'background', value: '#d0b647' }], properties: ['background'], source: 'external-0', matchedSelectors: ['.x'] }]
    : { links: ['https://assets.test/style.css?secret=never-log'], inline: ['.x{--palette: #d0b647}'] } };
  const rows = await runWrittenColorStylesheetSearch({ page, rootSelector: '.target', settingsReport,
    elementChecks: [{ id: 'written-color-1', status: 'fail' }],
    fetchStylesheet: async () => '.x{background: rgba(208, 182, 71, .5)}',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'record');
  assert.equal(rows[0].reason.code, 'instance-scoped-css-only');
  assert.equal(rows[0].actual.outcome, 'instance-scoped-css-only');
  assert.doesNotMatch(JSON.stringify(rows), /assets\.test|secret/);
  assert.deepEqual(await runWrittenColorStylesheetSearch({ page, settingsReport,
    elementChecks: [{ id: 'written-color-1', status: 'pass' }], fetchStylesheet: async () => '#d0b647',
  }), []);
});

test('optional state exercise records attempted states and the first state revealing a written color', async () => {
  let state = '';
  let evaluateCount = 0;
  const locator = { count: async () => 1, nth: () => ({ hover: async () => { state = 'hover'; }, focus: async () => { state = 'focus'; },
    evaluate: async () => ++evaluateCount <= 2 ? 'DIV' : ({ safe: false }), click: async () => {}, getAttribute: async () => null }) };
  const page = {
    locator: () => ({ locator: (selector) => selector === 'details' ? { count: async () => 0 }
      : selector.includes('aria-expanded') ? { count: async () => 0 } : locator }),
    evaluate: async (_fn, arg) => arg?.rootSelector
      ? { rootCount: 1, styles: state === 'hover' ? [{ color: '#d0b647' }] : [{ color: 'transparent' }] }
      : undefined,
    mouse: { move: async () => { state = ''; } },
  };
  const result = await exerciseWrittenColorStates(page, '.target', [{ id: 'color-a', value: '#d0b647' }]);
  assert.deepEqual(result, { states: ['hover', 'focus'], candidateCount: 1, disclosureCount: 0,
    exerciseCounts: { eligibleCandidates: 0, attempted: 0, opened: 0, restored: 0, toggleCandidates: 0, togglesOpened: 0,
      tabCandidates: 0, tabsSelected: 0, detailsCandidates: 0, detailsOpened: 0 },
    revealed: { 'color-a': { state: 'hover', matches: 1 } }, notExercised: [] });
});

test('a state toggle whose click never resolves is bounded and recorded as not-exercised', async () => {
  let evaluateCount = 0;
  const element = { hover: async () => {}, focus: async () => {}, press: async () => {},
    evaluate: async () => ++evaluateCount === 1 ? 'DIV' : ({ tag: 'div', visible: true, hasHref: false, insideForm: false,
      submitControl: false, hasExplicitToggle: true, semantic: false, nativeButton: false, hasClickHandler: false,
      hiddenSiblingIndexes: [], isTab: false, isSelect: false, isDetails: false, pointerAction: false, expanded: 'false' }),
    click: () => new Promise(() => {}), getAttribute: async () => null };
  const locator = { count: async () => 1, nth: () => element };
  const root = { locator: () => locator };
  const page = { locator: () => root, evaluate: async () => ({ rootCount: 1, styles: [] }),
    mouse: { move: async () => {} } };
  const started = Date.now();
  const result = await exerciseWrittenColorStates(page, '.target', [{ id: 'color', value: '#123456' }],
    { actionTimeoutMs: 20, overallTimeoutMs: 100 });
  assert.ok(Date.now() - started < 500);
  assert.equal(result.notExercised[0].status, 'not-exercised');
  assert.equal(result.notExercised[0].reason.code, 'state-exercise-action-timeout');
  assert.equal(result.notExercised[0].reason.action, 'activate-toggle');
  evaluateCount = 0;
  const overall = await exerciseWrittenColorStates(page, '.target', [{ id: 'color', value: '#123456' }],
    { actionTimeoutMs: 500, overallTimeoutMs: 20 });
  assert.equal(overall.notExercised[0].reason.code, 'state-exercise-overall-timeout');
});

test('state exercise opens only safe instance controls and records attempted/opened/restored counts', async () => {
  const actions = [];
  let panelVisible = false;
  let panelStateReads = 0;
  const toggle = { evaluate: async (_fn, indexes) => indexes
    ? (++panelStateReads === 1 ? panelVisible : !panelVisible) : ({ tag: 'button', visible: true, hasHref: false, insideForm: false,
    submitControl: false, hasExplicitToggle: true, semantic: false, nativeButton: true, isTab: false,
    expanded: 'false', selected: null, hasPopup: true, pointerAction: false, hiddenSiblingIndexes: [1] }),
    click: async () => { panelVisible = !panelVisible; actions.push(panelVisible ? 'open' : 'close'); }, press: async () => { actions.push('escape'); },
    getAttribute: async () => 'false', hover: async () => {}, focus: async () => {} };
  const unsafeLink = { evaluate: async () => ({ safe: false, isTab: false }), click: async () => { actions.push('unsafe-link'); },
    hover: async () => {}, focus: async () => {} };
  const controls = [toggle, unsafeLink];
  let allCalls = 0;
  const page = { locator: () => ({ locator: (selector) => {
    if (selector === 'details') return { count: async () => 0 };
    allCalls += 1;
    const list = allCalls === 2 ? controls : [];
    return { count: async () => list.length, nth: (index) => list[index] };
  } }),
  evaluate: async (_fn, arg) => arg?.rootSelector ? { rootCount: 1, styles: [{ color: 'transparent' }] } : undefined };
  const result = await exerciseWrittenColorStates(page, '.instance-root', [{ id: 'color-a', value: '#d0b647' }]);
  assert.deepEqual(actions, ['open', 'close']);
  assert.equal(result.exerciseCounts.attempted, 1);
  assert.equal(result.exerciseCounts.opened, 1);
  assert.equal(result.exerciseCounts.restored, 1);
  assert.equal(result.exerciseCounts.eligibleCandidates, 1);
});

test('interactive state target safety excludes navigation, form submission and hidden elements', () => {
  const base = { visible: true, tag: 'div', hasHref: false, insideForm: false, submitControl: false,
    hasExplicitToggle: false, semantic: false, nativeButton: false, pointerAction: true };
  assert.equal(isSafeStateExerciseTarget(base), true);
  assert.equal(isSafeStateExerciseTarget({ ...base, tag: 'a', hasHref: true }), false);
  assert.equal(isSafeStateExerciseTarget({ ...base, insideForm: true }), false);
  assert.equal(isSafeStateExerciseTarget({ ...base, submitControl: true }), false);
  assert.equal(isSafeStateExerciseTarget({ ...base, visible: false }), false);
  assert.equal(isSafeStateExerciseTarget({ ...base, pointerAction: false, hasClickHandler: true }), true);
  assert.equal(isSafeStateExerciseTarget({ ...base, pointerAction: false, hasClickHandler: true,
    tag: 'a', hasHref: false }), false);
});

test('a missing temporary root marker is inconclusive and does not scan stylesheets as absent', async () => {
  let scanned = false;
  const page = { locator: () => ({ count: async () => 0 }), evaluate: async (_fn, arg) => {
    if (arg?.rootSelector && !arg?.declarations) scanned = true;
    return { links: [], inline: [] };
  } };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '[data-front-instance-target="old"]',
    settingsReport: { block: { currentValues: [{ section: '区块配色', type: 'color', value: '#d0b647' }] } } });
  assert.equal(row.status, 'record');
  assert.equal(row.classification, 'instance-root-missing');
  assert.equal(row.reason.code, 'instance-root-missing');
  assert.deepEqual(row.actual, { rootCount: 0, stylesheetScan: 'not-run', stateExercise: 'not-run' });
  assert.equal(scanned, false);
});

test('written-color checks rebuild a lost temporary marker from the stable instance identity', async () => {
  let cleared = false;
  const page = {
    locator: (selector) => ({ count: async () => selector.includes('written-color-') ? 1 : 0,
      evaluate: async () => { cleared = true; } }),
    evaluate: async (_fn, arg) => {
      if (arg?.blockId) return { status: 'resolved', rootCount: 1, matchCount: 1 };
      if (arg?.declarations) return [];
      if (arg?.rootSelector) return { rootCount: 1, styles: [{ color: 'rgb(208, 182, 71)' }] };
      return undefined;
    },
  };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '[data-front-instance-target="stale"]',
    settingsReport: { blockId: 'generic', block: { settingId: 'instance-a', currentValues: [
      { section: '区块配色', type: 'color', value: '#d0b647' },
    ] } }, includeStylesheets: false });
  assert.equal(row.classification, 'found-on-element');
  assert.equal(row.status, 'pass');
  assert.equal(cleared, true, 'the recovery marker is kept through color reads, then removed');
});

test('state exercise opens instance-local category toggles and tabs, then restores the selected tab', async () => {
  const actions = [];
  let expanded = 'false';
  let activeTab = 'first';
  const toggle = { evaluate: async () => ({ tag: 'button', visible: true, hasHref: false, insideForm: false,
    submitControl: false, hasExplicitToggle: true, semantic: false, nativeButton: true, isTab: false,
    expanded, selected: null, hasPopup: false }),
    click: async () => { expanded = expanded === 'false' ? 'true' : 'false'; actions.push(`toggle:${expanded}`); },
    getAttribute: async (name) => name === 'aria-expanded' ? expanded : null,
    press: async () => { actions.push('escape'); } };
  const tab = (id, selected) => ({ evaluate: async () => ({ tag: 'div', visible: true, hasHref: false, insideForm: false,
    submitControl: false, hasExplicitToggle: false, semantic: true, nativeButton: false, isTab: true,
    selected: selected ? 'true' : 'false', expanded: null, hasPopup: false }),
    click: async () => { activeTab = id; actions.push(`tab:${id}`); } });
  const controls = [toggle, tab('first', true), tab('second', false)];
  let allCall = 0;
  const page = {
    locator: () => ({ locator: (selector) => {
      if (selector === 'details') return { count: async () => 0 };
      if (selector === '*') {
        allCall += 1;
        if (allCall === 2) return { count: async () => controls.length, nth: (index) => controls[index] };
        return { count: async () => 0 };
      }
      return { count: async () => 0 };
    } }),
    evaluate: async (_fn, arg) => arg?.rootSelector ? { rootCount: 1, styles: [{ color: 'transparent' }] } : undefined,
  };
  const result = await exerciseWrittenColorStates(page, '.instance-root', [{ id: 'color-a', value: '#d0b647' }]);
  assert.ok(result.states.includes('category-expanded'));
  assert.ok(result.states.includes('tab-selected'));
  assert.deepEqual(result.exerciseCounts, { eligibleCandidates: 3, attempted: 2, opened: 2, restored: 2, toggleCandidates: 1,
    togglesOpened: 1, tabCandidates: 2, tabsSelected: 1, detailsCandidates: 0, detailsOpened: 0 });
  assert.equal(expanded, 'false');
  assert.equal(activeTab, 'first');
  assert.deepEqual(actions, ['toggle:true', 'toggle:false', 'tab:second', 'tab:first']);
});

test('every written-color miss records states exercised and stylesheet scan diagnostics', async () => {
  const settingsReport = { blockId: 'generic', block: { currentValues: [{ section: '区块配色', type: 'color', value: '#d0b647' }] } };
  let call = 0;
  const emptyLocator = { count: async () => 0 };
  const page = {
    locator: () => ({ locator: () => emptyLocator }),
    evaluate: async (_fn, arg) => {
      if (arg?.declarations) return [];
      if (!arg) return undefined;
      call += 1;
      return call === 1 ? { links: [], inline: [] } : { rootCount: 1, styles: [{ color: 'transparent' }] };
    },
    mouse: { move: async () => {} },
  };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '.target', settingsReport, stateExercise: true });
  assert.equal(row.classification, 'absent');
  assert.deepEqual(row.actual.stateExercise, { enabled: true, states: [], candidateCount: 0,
    disclosureCount: 0, exerciseCounts: { eligibleCandidates: 0, attempted: 0, opened: 0, restored: 0, toggleCandidates: 0, togglesOpened: 0, tabCandidates: 0,
      tabsSelected: 0, detailsCandidates: 0, detailsOpened: 0 }, revealedBy: null, notExercised: [], timedOut: false });
  assert.equal(row.actual.stylesheetEvidence.sheetCount, 0);
  assert.equal(row.actual.stylesheetEvidence.matchCount, 0);
});

test('cross-origin linked CSS fetched through context request becomes scoped CSS-only evidence', async () => {
  const settingsReport = { blockId: 'generic', block: { settingId: 'instance-a', currentValues: [
    { section: '区块配色', type: 'color', value: '#d0b647' },
  ] } };
  let evaluateCount = 0;
  let fetched = 0;
  const page = {
    context: () => ({ request: { get: async (url) => {
      assert.match(url, /^https:\/\/cdn\.invalid\//); fetched += 1;
      return { ok: () => true, text: async () => '.instance-a .palette-item::before{background-image:linear-gradient(#d0b647, transparent)}' };
    } } }),
    evaluate: async (_fn, arg) => {
      if (arg?.declarations) return arg.declarations.map((rule) => ({ ...rule, matchedSelectors: ['.instance-a .palette-item::before'] }));
      evaluateCount += 1;
      return evaluateCount === 1 ? { links: ['https://cdn.invalid/site.css'], inline: [] }
        : { rootCount: 1, styles: [{ color: 'transparent' }] };
    },
  };
  const [row] = await runWrittenColorFrontChecks({ page, rootSelector: '[data-target-instance="yes"]', settingsReport });
  assert.equal(fetched, 1);
  assert.equal(row.classification, 'instance-scoped-css-only');
  assert.equal(row.actual.stylesheetEvidence.sheetCount, 1);
  assert.equal(row.actual.stylesheetEvidence.fetchFailureCount, 0);
  assert.equal(row.actual.stylesheetEvidence.matchCount, 1);
  assert.equal(row.actual.stylesheetEvidence.rules[0].properties[0], 'background-image');
  assert.deepEqual(row.actual.stateExercise, { enabled: false, states: [], candidateCount: 0,
    disclosureCount: 0, exerciseCounts: { eligibleCandidates: 0, attempted: 0, opened: 0, restored: 0, toggleCandidates: 0, togglesOpened: 0, tabCandidates: 0,
      tabsSelected: 0, detailsCandidates: 0, detailsOpened: 0 }, revealedBy: null, notExercised: [], timedOut: false });
});

test('front result deduplication is by id and preserves the most conservative verdict', () => {
  const result = dedupeChecksById([
    { id: 'same', status: 'pass', detail: 'first' },
    { id: 'other', status: 'na' },
    { id: 'same', status: 'fail', detail: 'failure retained' },
    { id: 'other', status: 'pass' },
  ]);
  assert.deepEqual(result, [{ id: 'same', status: 'fail', detail: 'failure retained' }, { id: 'other', status: 'pass' }]);
});
