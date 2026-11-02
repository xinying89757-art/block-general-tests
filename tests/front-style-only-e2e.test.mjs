import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('front-style-only end-to-end keeps the instance root through mobile checklist and external CSS scan', async () => {
  const cssServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/css' });
    response.end('@media print { [data-id="siteblocks-setting-wrap-setting-smoke"] .palette { color: #d0b647; } }');
  });
  await new Promise((resolve) => cssServer.listen(0, '127.0.0.1', resolve));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="http://127.0.0.1:${cssServer.address().port}/fixture.css"></head><body>
      <div data-appid="90001" data-id="siteblocks-setting-wrap-setting-smoke" class="fixture" style="width:320px;position:relative">
        <button type="button" class="spec-target">Spec hover</button><div class="sample">Style sample</div><div class="palette">palette</div>
        <label style="display:block;font-size:14px;font-weight:400;line-height:21px"><input type="checkbox">Option label</label>
        <a href="/away" style="display:block;cursor:pointer"><span>Do not follow this nested link</span></a>
        <div class="typography-wrapper" style="font-size:12px">Exact leaf label <span style="font-size:16px;font-weight:600;line-height:20px">Exact leaf label</span></div>
        <ul class="category-tree"><li style="font-weight:700;line-height:45px">Parent category<ul><li style="font-weight:400;line-height:20px"><span>Nested category</span></li></ul></li></ul>
        <div class="clamped" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden">A long text block for line clamp verification</div>
        <div class="scroll-container" style="height:40px;overflow-y:auto"><div class="scroll-row" style="height:30px">one</div><div class="scroll-row" style="height:30px">two</div><div class="scroll-row" style="height:30px">three</div></div>
        <article class="item-card"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E" class="lazy-image" width="80" height="80" data-src="/lazy.png" style="display:block;width:80px;height:80px;object-position:50% 50%;background-position:0% 0%">
        <picture style="display:block;width:100px;height:100px"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'/%3E" width="100" height="100" data-srcset="/picture.png 1x" style="width:100%;height:100%"></picture></article>
        <img class="banner" data-src="/banner.png" style="width:320px;height:40px">
        <div class="background-image" style="width:320px;height:40px;background-image:url('/background.png');background-position:0% 0%"></div>
        <button class="live-button" style="background-color:#ff0000;line-height:24px;font-size:16px">Actual style</button>
        <nav class="pagination"><span class="paging-current" style="background-color:#ff0000">1</span></nav>
        <div class="clipper" style="position:relative;width:320px;overflow:hidden">
          <span>overlap one</span><span>overlap two</span>
        </div>
        <div class="transparent-pair"><span>transparent one</span><span>transparent two</span></div>
        <div class="hidden-pair"><span>hidden one</span><span>hidden two</span></div>
        <div class="invisible-pair"><span>invisible one</span><span>invisible two</span></div>
        <div class="zero-pair"><i></i><i></i></div>
        <div class="compare-bar" style="display:none;position:absolute;left:0;top:0;width:100%;height:40px"><span>0 items</span><span>Compare</span></div>
      </div><style>
        .spec-target:hover { background-color:#456abc; }
        .sample { display:block; color:rgb(0, 0, 0); }
        .palette { color:transparent; }
        .clipper { height:48px; }
        .transparent-pair { opacity:0; }
        .hidden-pair { display:none; }
        .invisible-pair { visibility:hidden; }
        .zero-pair i { display:block; width:0; height:0; }
        @media (max-width: 400px) {
          .clipper { height:12px; }
          .clipper span { position:absolute; left:0; top:0; height:40px; }
          .transparent-pair span, .hidden-pair span { position:absolute; left:0; top:50px; }
          .invisible-pair span { position:absolute; left:0; top:80px; }
          .zero-pair i { position:absolute; left:0; top:120px; }
        }
      </style></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'front-style-e2e-'));
  try {
    const profilePath = path.join(temp, 'profile.json');
    const runPath = path.join(temp, 'run.json');
    const outputPath = path.join(temp, 'front.json');
    fs.writeFileSync(profilePath, JSON.stringify({
      capabilities: [{ id: 'block-style-spec', styleSpec: { items: [
        { id: 'sample-color', kind: 'first', selector: '.sample', props: { color: '#000000' } },
        { id: 'category-parent', kind: 'nav-parent', selector: '.missing-parent', props: {} },
        { id: 'category-leaf', kind: 'nav-leaf', selector: '.missing-leaf', props: {} },
        { id: 'filter-option', kind: 'sample', selectorCandidates: ['.missing-options'], props: { fontSize: 14, fontWeight: 400, lineHeight: 21 } },
        { id: 'button-bg', kind: 'first', selectorCandidates: ['.live-button'], learnedSelectorRequired: true,
          props: { backgroundColor: '#ff0000' } },
        { id: 'pagination-current', kind: 'text', text: '1', selectorCandidates: ['.paging-current'], learnedSelectorRequired: true,
          props: { backgroundColor: '#ff0000' }, scope: { containerKind: 'pagination' } },
        { id: 'unread-typography', kind: 'record-only', selectorCandidates: ['.live-button'], props: {} },
      ] } }],
      designSpec: { source: { fileKey: 'fixture', nodeId: '1:1' }, overrides: [], requirements: [
        { id: 'targeted-hover', checkType: 'color-scope', sourceText: 'Named button hover',
          expected: { value: '#456abc' }, checkStage: 'front', state: { kind: 'hover', target: 'scope' },
          params: { selector: '.spec-target', property: 'backgroundColor' } },
        { id: 'mobile-sample', checkType: 'mobile-layout', sourceText: 'sample display',
          expected: { display: 'block' }, checkStage: 'front', params: { viewport: 'mobile', selector: '.sample' } },
        { id: 'leaf-typography', checkType: 'typography', sourceText: 'Exact leaf label', expected: { fontSize: '16px', fontWeight: '600', lineHeight: '20px' },
          checkStage: 'front', params: {} },
        { id: 'hierarchy-child-typography', checkType: 'typography', sourceText: 'Category child level',
          expected: { fontWeight: 400, lineHeight: '20px' }, checkStage: 'front', params: { hierarchyLevel: 2 } },
        { id: 'palette-default', checkType: 'color-default', sourceText: 'Palette default',
          expected: { value: '#1c4587' }, checkStage: 'front', params: {} },
        { id: 'button-color-scope', checkType: 'color-scope', sourceText: 'Button background',
          expected: { value: '#1c4587' }, checkStage: 'front', params: { styleCheckIds: ['button-bg'] } },
        { id: 'current-color-scope', checkType: 'color-scope', sourceText: 'Current pagination background',
          expected: { value: '#1c4587' }, checkStage: 'front', params: { styleCheckIds: ['pagination-current'] } },
        { id: 'image-ratio-fixture', checkType: 'image-ratio', sourceText: 'Images square', expected: { ratio: '1:1', centered: true },
          checkStage: 'front', params: {} },
        { id: 'image-ratio-mobile-fixture', checkType: 'image-ratio', sourceText: 'Images square on mobile', expected: { ratio: '1:1', centered: true },
          checkStage: 'front', params: { viewport: 'mobile' } },
        { id: 'hierarchy-fixture', checkType: 'nav-hierarchy-levels', sourceText: 'Navigation has two levels',
          expected: { levels: [1, 2] }, checkStage: 'front', params: { itemSelector: '.category-tree li' } },
        { id: 'scroll-threshold-fixture', checkType: 'overflow-threshold', sourceText: 'Scroll after two items',
          expected: { threshold: 2, direction: 'vertical' }, checkStage: 'front',
          params: { containerSelector: '.scroll-container', itemSelector: '.scroll-row' } },
        { id: 'truncation-fixture', checkType: 'text-truncation', sourceText: 'Clamp to two lines',
          expected: { maxLines: 2, overflow: 'ellipsis' }, checkStage: 'front', params: { selector: '.clamped' } },
        { id: 'default-expand-fixture', checkType: 'default-expand', sourceText: 'Default hierarchy has two levels',
          expected: { level: 2 }, checkStage: 'front', params: { selector: '.category-tree li' } },
        { id: 'matched-typography-mobile', checkType: 'typography', sourceText: 'Unmatched design label',
          expected: { fontSize: '16px', lineHeight: '24px' }, checkStage: 'front',
          params: { viewport: 'mobile', styleCheckId: 'unread-typography' } },
        { id: 'manual-requirement', checkType: 'manual', sourceText: 'Exact unsupported source sentence',
          expected: { verbatim: 'Exact unsupported source sentence' }, checkStage: 'front', params: {} },
      ] },
    }));
    fs.writeFileSync(runPath, JSON.stringify({ blockId: '90001', block: { settingId: 'setting-smoke', currentValues: [
      { section: '区块配色', region: 'right-rail-color', type: 'color', value: '#d0b647' },
      { section: '区块配色', region: 'right-rail-color', type: 'color', value: '#ff0000' },
    ] }, checks: [{ id: 'bss-button-bg', setting: 'palette', status: 'pass', value: '#ff0000', expected: '#ff0000' },
      { id: 'bss-pagination-current', setting: 'palette', status: 'pass', value: '#ff0000', expected: '#ff0000' }] }));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/front-style-only.mjs', '--block', '90001', '--url',
        `http://127.0.0.1:${address.port}/products.html`, '--profile', profilePath, '--run-report', runPath,
        '--image-load-timeout', '1200', '--out', outputPath, '--channel', 'chrome', '--exercise-states', '1', '--state-timeout-ms', '10', '--state-action-timeout-ms', '10',
        '--capture-instance', path.join(temp, 'capture')], { cwd: repo });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('front-style-only fixture child timed out')); }, 45000);
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}\n${JSON.stringify(report.checks.map(({ id, status, classification, detail }) => ({ id, status, classification, detail })))}`);
    assert.ok(report.checks.filter((row) => ['na', 'fail'].includes(row.status)).every((row) =>
      typeof row.reason?.code === 'string' && row.reason.code && row.reason.code !== '[object Object]'
        && row.reason.code !== 'na-reason-unavailable'), 'all read/locate/compare non-pass checks need a specific string reason');
    assert.equal(report.error, null);
    assert.equal(report.checks.find((row) => row.id === 'design-manual-requirement').status, 'human-review');
    const chineseSummary = fs.readFileSync(outputPath.replace(/\.json$/, '-zh.md'), 'utf8');
    assert.match(chineseSummary, /人工判断/);
    assert.ok(report.summary['human-review'] > 0);
    assert.doesNotMatch(chineseSummary, /matchedSelector|selectorCandidates/);
    assert.equal(report.checks.find((row) => row.id === 'design-targeted-hover')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-targeted-hover')?.reason.state.restored, true);
    assert.equal(report.instanceCaptures.length, 2);
    for (const capture of report.instanceCaptures) {
      assert.ok(fs.existsSync(capture.jsonPath), 'real CLI writes per-viewport capture JSON');
      assert.ok(fs.existsSync(capture.htmlPath));
      assert.ok(fs.existsSync(capture.cssPath));
      assert.ok(capture.elementCount > 0);
    }
    for (const viewport of ['pc', 'mobile']) {
      assert.equal(report.finderDebug[viewport].rootCount, 1);
      assert.equal(report.finderDebug[viewport].finders.interaction, undefined);
      assert.ok(report.finderDebug[viewport].finders.image.decisions.length <= 80);
    }
    assert.equal(new URL(report.finalUrl).pathname, '/products.html', 'nested link children must never be activated');
    assert.equal(report.checks.find((row) => row.id === 'design-mobile-sample')?.status, 'pass');
    const color = report.checks.find((row) => row.id === 'written-color-1');
    assert.ok(report.checks.filter((row) => row.id.startsWith('written-color-')).every((row) => row.actual?.rootCount >= 1),
      'all checks must preserve the actual instance through the full CLI flow');
    assert.equal(color?.classification, 'instance-scoped-css-only');
    assert.equal(color?.status, 'record');
    assert.equal(color?.actual.stylesheetEvidence.matchCount, 1);
    assert.doesNotMatch(JSON.stringify(report), /stateExercise|revealedByState/);
    assert.equal((result.stdout.match(/旧状态扫描参数已忽略/g) || []).length, 1);
    assert.equal(report.checks.find((row) => row.id === 'bss-button-bg')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'bss-pagination-current')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-matched-typography-mobile')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'bss-breakage-mobile')?.status, 'pass',
      'overlapping text clipped by an overflow-hidden ancestor is not a visible mobile overlap');
    assert.equal(report.checks.find((row) => row.id === 'design-leaf-typography')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-hierarchy-child-typography')?.status, 'pass');
    assert.ok(report.checks.find((row) => row.id === 'design-hierarchy-child-typography')?.actual.functionalChecks
      .every((row) => row.hierarchyLevel === 2));
    assert.equal(report.checks.find((row) => row.id === 'design-palette-default')?.status, 'na', 'mobile must use the run report too, never keep a stale-default failure');
    assert.equal(report.checks.find((row) => row.id === 'design-button-color-scope')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-current-color-scope')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-button-color-scope')?.reason.expectedSource, 'run-report:setting-check-value');
    assert.deepEqual(report.checks.find((row) => row.id === 'design-leaf-typography')?.actual, {
      fontSize: ['16px'], fontWeight: ['600'],
      functionalChecks: [{ label: 'Exact leaf label', role: 'span', fontSize: '16px', fontWeight: '600' }],
    });
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-fixture').actual.imageLoad.timeoutMs, 1200);
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-mobile-fixture').status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-mobile-fixture').actual.imageLoad.timeoutMs, 1200);
    assert.equal(report.checks.find((row) => row.id === 'design-hierarchy-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-scroll-threshold-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-truncation-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-default-expand-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-fixture')?.actual.images.length, 1,
      'one main picture per card participates; the smaller peer, banners and full-width backgrounds do not');
    assert.ok(report.humanReview.some((item) => item.id === 'manual-requirement'
      && item.sourceText === 'Exact unsupported source sentence'), 'unsupported source text must remain visible in humanReview');
    assert.ok(report.checks.find((row) => row.id === 'design-image-ratio-fixture')?.actual.images
      .every((image) => image.positionSource === 'object-position'));
    assert.ok(report.checks.find((row) => row.id === 'bss-category-parent')?.evidence.matchedCount >= 1);
    assert.ok(report.checks.find((row) => row.id === 'bss-category-leaf')?.evidence.matchedCount >= 1);
    assert.equal(report.checks.find((row) => row.id === 'bss-filter-option')?.status, 'pass');
    assert.doesNotMatch(JSON.stringify(report.checks.find((row) => row.id === 'bss-breakage-mobile')?.evidence?.overlaps || []), /compare-bar/);
    assert.match(result.stdout, /stage=style-check-start id=bss-sample-color/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => cssServer.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
