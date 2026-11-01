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
  const server = http.createServer((request, response) => {
    if (request.url === '/fixture.css') {
      response.writeHead(200, { 'content-type': 'text/css' });
      response.end('@media print { [data-appid="90001"] .palette { color: #d0b647; } }\n.hover-color:hover { color: #12ab34; }');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body>
      <div data-appid="90001" data-id="siteblocks-setting-wrap-setting-smoke" class="fixture" style="width:320px;position:relative">
        <div class="sample">Style sample</div><div class="palette">palette</div>
        <button type="button" class="hover-color" style="cursor:pointer">Hover for palette</button>
        <div class="typography-wrapper" style="font-size:12px">Exact leaf label <span style="font-size:16px;font-weight:600;line-height:20px">Exact leaf label</span></div>
        <ul class="category-tree"><li>Parent category<ul><li>Nested category</li></ul></li></ul>
        <img class="lazy-image" data-src="/lazy.png" style="display:block;width:100px;height:100px">
        <picture style="display:block;width:100px;height:100px"><img data-srcset="/picture.png 1x" style="width:100%;height:100%"></picture>
        <div class="background-image" style="width:100px;height:100px;background-image:url('/background.png');background-position:50% 50%"></div>
        <div class="toggle-wrap"><button type="button" onclick="document.querySelector('.toggle-panel').hidden = !document.querySelector('.toggle-panel').hidden">Toggle</button>
          <div class="toggle-panel" hidden>Disclosure panel</div></div>
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
      ] } }],
      designSpec: { source: { fileKey: 'fixture', nodeId: '1:1' }, overrides: [], requirements: [
        { id: 'mobile-sample', checkType: 'mobile-layout', sourceText: 'sample display',
          expected: { display: 'block' }, checkStage: 'front', params: { viewport: 'mobile', selector: '.sample' } },
        { id: 'leaf-typography', checkType: 'typography', sourceText: 'Exact leaf label', expected: { fontSize: '16px', fontWeight: '600', lineHeight: '20px' },
          checkStage: 'front', params: {} },
        { id: 'image-ratio-fixture', checkType: 'image-ratio', sourceText: 'Images square', expected: { ratio: '1:1', centered: true },
          checkStage: 'front', params: {} },
      ] },
    }));
    fs.writeFileSync(runPath, JSON.stringify({ blockId: '90001', block: { settingId: 'setting-smoke', currentValues: [
      { section: '区块配色', region: 'right-rail-color', type: 'color', value: '#d0b647' },
      { section: '区块配色', region: 'right-rail-color', type: 'color', value: '#12ab34' },
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
    assert.equal(report.checks.find((row) => row.id === 'design-mobile-sample')?.status, 'pass');
    const color = report.checks.find((row) => row.id === 'written-color-1');
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
    assert.equal(report.checks.find((row) => row.id === 'bss-breakage-mobile')?.status, 'pass',
      'overlapping text clipped by an overflow-hidden ancestor is not a visible mobile overlap');
    assert.equal(report.checks.find((row) => row.id === 'design-leaf-typography')?.status, 'pass');
    assert.deepEqual(report.checks.find((row) => row.id === 'design-leaf-typography')?.actual, {
      fontSize: ['16px'], fontWeight: ['600'], lineHeight: ['20px'],
      functionalChecks: [{ label: 'Exact leaf label', role: 'span', fontSize: '16px', fontWeight: '600', lineHeight: '20px' }],
    });
    assert.equal(report.checks.find((row) => row.id === 'design-image-ratio-fixture')?.status, 'pass');
    assert.ok(report.checks.find((row) => row.id === 'bss-category-parent')?.evidence.matchedCount >= 1);
    assert.ok(report.checks.find((row) => row.id === 'bss-category-leaf')?.evidence.matchedCount >= 1);
    assert.doesNotMatch(JSON.stringify(report.checks.find((row) => row.id === 'bss-breakage-mobile')?.evidence?.overlaps || []), /compare-bar/);
    assert.match(result.stdout, /stage=style-check-start id=bss-sample-color/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
