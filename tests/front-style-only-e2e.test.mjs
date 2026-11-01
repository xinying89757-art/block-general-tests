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
    response.end('@media print { [data-id="siteblocks-setting-wrap-setting-smoke"] .palette { color: #d0b647; } }\n.hover-color:hover { color: #12ab34; }');
  });
  await new Promise((resolve) => cssServer.listen(0, '127.0.0.1', resolve));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="http://127.0.0.1:${cssServer.address().port}/fixture.css"></head><body>
      <div data-appid="90001" data-id="siteblocks-setting-wrap-setting-smoke" class="fixture" style="width:320px;position:relative">
        <div class="sample">Style sample</div><div class="palette">palette</div>
        <a href="/away" style="cursor:pointer"><span>Do not follow this nested link</span></a>
        <button type="button" class="hover-color" style="cursor:pointer">Hover for palette</button>
        <div class="typography-wrapper" style="font-size:12px">Exact leaf label <span style="font-size:16px;font-weight:600;line-height:20px">Exact leaf label</span></div>
        <ul class="category-tree"><li>Parent category<ul><li>Nested category</li></ul></li></ul>
        <div class="clamped" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden">A long text block for line clamp verification</div>
        <div class="scroll-container" style="height:40px;overflow-y:auto"><div class="scroll-row" style="height:30px">one</div><div class="scroll-row" style="height:30px">two</div><div class="scroll-row" style="height:30px">three</div></div>
        <article class="item-card"><img class="lazy-image" data-src="/lazy.png" style="display:block;width:100px;height:100px;object-position:50% 50%;background-position:0% 0%">
        <picture style="display:block;width:100px;height:100px"><img data-srcset="/picture.png 1x" style="width:100%;height:100%"></picture></article>
        <img class="banner" data-src="/banner.png" style="width:320px;height:40px">
        <div class="background-image" style="width:320px;height:40px;background-image:url('/background.png');background-position:0% 0%"></div>
        <button class="live-button" style="background-color:#ff0000;line-height:24px;font-size:16px">Actual style</button>
        <nav class="pagination"><span class="paging-current" style="background-color:#ff0000">1</span></nav>
        <div class="toggle-wrap"><button type="button" style="cursor:pointer" onclick="document.querySelector('.toggle-panel').classList.toggle('open')"><span>Toggle</span></button>
          <div class="toggle-panel">Disclosure panel</div></div>
        <div class="clipper" style="position:relative;width:320px;overflow:hidden">
          <span>overlap one</span><span>overlap two</span>
        </div>
        <div class="transparent-pair"><span>transparent one</span><span>transparent two</span></div>
        <div class="hidden-pair"><span>hidden one</span><span>hidden two</span></div>
        <div class="invisible-pair"><span>invisible one</span><span>invisible two</span></div>
        <div class="zero-pair"><i></i><i></i></div>
        <div class="compare-bar" style="display:none;position:absolute;left:0;top:0;width:100%;height:40px"><span>0 items</span><span>Compare</span></div>
      </div><style>
        .sample { display:block; color:rgb(0, 0, 0); }
        .palette { color:transparent; }
        .toggle-panel { display:none; color:#ab12cd; }
        .toggle-panel.open { display:block; }
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
        { id: 'button-bg', kind: 'first', selectorCandidates: ['.live-button'], learnedSelectorRequired: true,
          props: { backgroundColor: '#ff0000' } },
        { id: 'pagination-current', kind: 'text', text: '1', selectorCandidates: ['.paging-current'], learnedSelectorRequired: true,
          props: { backgroundColor: '#ff0000' }, scope: { containerKind: 'pagination' } },
        { id: 'unread-typography', kind: 'record-only', selectorCandidates: ['.live-button'], props: {} },
      ] } }],
      designSpec: { source: { fileKey: 'fixture', nodeId: '1:1' }, overrides: [], requirements: [
        { id: 'mobile-sample', checkType: 'mobile-layout', sourceText: 'sample display',
          expected: { display: 'block' }, checkStage: 'front', params: { viewport: 'mobile', selector: '.sample' } },
        { id: 'leaf-typography', checkType: 'typography', sourceText: 'Exact leaf label', expected: { fontSize: '16px', fontWeight: '600', lineHeight: '20px' },
          checkStage: 'front', params: {} },
        { id: 'image-ratio-fixture', checkType: 'image-ratio', sourceText: 'Images square', expected: { ratio: '1:1', centered: true },
          checkStage: 'front', params: {} },
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
      { section: '区块配色', region: 'right-rail-color', type: 'color', value: '#12ab34' },
      { section: '区块配色', region: 'right-rail-color', type: 'color', value: '#ab12cd' },
    ] } }));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/front-style-only.mjs', '--block', '90001', '--url',
        `http://127.0.0.1:${address.port}/products.html`, '--profile', profilePath, '--run-report', runPath,
        '--out', outputPath, '--channel', 'chrome', '--exercise-states', '1'], { cwd: repo });
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
    assert.equal(new URL(report.finalUrl).pathname, '/products.html', 'nested link children must never be activated');
    assert.equal(report.checks.find((row) => row.id === 'design-mobile-sample')?.status, 'pass');
    const color = report.checks.find((row) => row.id === 'written-color-1');
    assert.ok(report.checks.filter((row) => row.id.startsWith('written-color-')).every((row) => row.actual?.rootCount >= 1),
      'state exercise must preserve the actual instance through the full CLI flow');
    assert.equal(color?.classification, 'instance-scoped-css-only');
    assert.equal(color?.status, 'record');
    assert.equal(color?.actual.stylesheetEvidence.matchCount, 1);
    assert.ok(color?.actual.stateExercise.exerciseCounts.attempted > 0);
    assert.ok(color?.actual.stateExercise.exerciseCounts.opened > 0);
    assert.ok(color?.actual.stateExercise.exerciseCounts.restored > 0);
    const hoverColor = report.checks.find((row) => row.id === 'written-color-2');
    assert.equal(hoverColor?.status, 'pass', 'a visible instance-local hover target reveals the written color');
    assert.equal(hoverColor?.classification, 'found-on-element');
    assert.equal(hoverColor?.actual.stateExercise.revealedBy, 'hover');
    const toggleColor = report.checks.find((row) => row.id === 'written-color-3');
    assert.equal(toggleColor?.status, 'pass');
    assert.equal(toggleColor?.actual.stateExercise.revealedBy, 'category-expanded');
    assert.equal(report.checks.find((row) => row.id === 'bss-button-bg')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'bss-pagination-current')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-matched-typography-mobile')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'bss-breakage-mobile')?.status, 'pass',
      'overlapping text clipped by an overflow-hidden ancestor is not a visible mobile overlap');
    assert.equal(report.checks.find((row) => row.id === 'design-leaf-typography')?.status, 'pass');
    assert.deepEqual(report.checks.find((row) => row.id === 'design-leaf-typography')?.actual, {
      fontSize: ['16px'], fontWeight: ['600'], lineHeight: ['20px'],
      functionalChecks: [{ label: 'Exact leaf label', role: 'span', fontSize: '16px', fontWeight: '600', lineHeight: '20px' }],
    });
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-hierarchy-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-scroll-threshold-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-truncation-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-default-expand-fixture')?.status, 'pass');
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-fixture')?.actual.images.length, 3,
      'only the content image and picture sources participate; banners and full-width backgrounds do not');
    assert.ok(report.humanReview.some((item) => item.id === 'manual-requirement'
      && item.sourceText === 'Exact unsupported source sentence'), 'unsupported source text must remain visible in humanReview');
    assert.ok(report.checks.find((row) => row.id === 'design-image-ratio-fixture')?.actual.images
      .every((image) => image.positionSource === 'object-position'));
    assert.ok(report.checks.find((row) => row.id === 'bss-category-parent')?.evidence.matchedCount >= 1);
    assert.ok(report.checks.find((row) => row.id === 'bss-category-leaf')?.evidence.matchedCount >= 1);
    assert.doesNotMatch(JSON.stringify(report.checks.find((row) => row.id === 'bss-breakage-mobile')?.evidence?.overlaps || []), /compare-bar/);
    assert.match(result.stdout, /stage=style-check-start id=bss-sample-color/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => cssServer.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
