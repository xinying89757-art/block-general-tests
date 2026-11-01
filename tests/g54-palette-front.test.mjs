import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteWriteReadback } from '../src/capabilities/rail.mjs';
import { countCssColorMatches, runWrittenColorFrontChecks, runWrittenColorStylesheetSearch,
  exerciseWrittenColorStates } from '../src/design-spec-checklist.mjs';
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
    if (evaluations === 1) return { links: ['https://assets.test/style.css?secret=never-log'], inline: ['.x{--palette: #d0b647}'] };
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

test('standalone stylesheet evidence is scoped to the instance and is not a pass', async () => {
  const settingsReport = { blockId: 'generic', block: { currentValues: [
    { region: 'right-rail-color', type: 'color', value: 'rgb(208, 182, 71)' },
  ] } };
  const page = { evaluate: async (_fn, arg) => arg?.declarations ? [{ selector: '.x', properties: ['background'], source: 'external-0', matchedSelectors: ['.x'] }]
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
  const locator = { count: async () => 1, nth: () => ({ hover: async () => { state = 'hover'; }, focus: async () => { state = 'focus'; } }) };
  const page = {
    locator: () => ({ locator: (selector) => selector === 'details' ? { count: async () => 0 } : locator }),
    evaluate: async (_fn, arg) => arg?.rootSelector
      ? { rootCount: 1, styles: state === 'hover' ? [{ color: '#d0b647' }] : [{ color: 'transparent' }] }
      : undefined,
    mouse: { move: async () => { state = ''; } },
  };
  const result = await exerciseWrittenColorStates(page, '.target', [{ id: 'color-a', value: '#d0b647' }]);
  assert.deepEqual(result, { states: ['hover', 'focus'], candidateCount: 1, disclosureCount: 0,
    revealed: { 'color-a': { state: 'hover', matches: 1 } } });
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
    disclosureCount: 0, revealedBy: null });
  assert.deepEqual(row.actual.stylesheetEvidence, { sheetCount: 0, ruleCount: 0,
    fetchFailureCount: 0, matchCount: 0 });
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
    disclosureCount: 0, revealedBy: null });
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
