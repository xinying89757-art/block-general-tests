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
      response.end('@media print { [data-appid="90001"] .palette { color: #d0b647; } }');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body>
      <div data-appid="90001" data-id="siteblocks-setting-wrap-setting-smoke" class="fixture" style="width:320px;position:relative">
        <div class="sample">Style sample</div><div class="palette">palette</div>
        <div class="toggle-wrap"><button type="button" onclick="document.querySelector('.toggle-panel').hidden = !document.querySelector('.toggle-panel').hidden">Toggle</button>
          <div class="toggle-panel" hidden>Disclosure panel</div></div>
        <div class="clipper" style="position:relative;width:320px;overflow:hidden">
          <span>overlap one</span><span>overlap two</span>
        </div>
        <div class="transparent-pair"><span>transparent one</span><span>transparent two</span></div>
        <div class="hidden-pair"><span>hidden one</span><span>hidden two</span></div>
        <div class="invisible-pair"><span>invisible one</span><span>invisible two</span></div>
        <div class="zero-pair"><i></i><i></i></div>
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
      ] } }],
      designSpec: { source: { fileKey: 'fixture', nodeId: '1:1' }, overrides: [], requirements: [
        { id: 'mobile-sample', checkType: 'mobile-layout', sourceText: 'sample display',
          expected: { display: 'block' }, checkStage: 'front', params: { viewport: 'mobile', selector: '.sample' } },
      ] },
    }));
    fs.writeFileSync(runPath, JSON.stringify({ blockId: '90001', block: { settingId: 'setting-smoke', currentValues: [
      { section: '区块配色', region: 'right-rail-color', type: 'color', value: '#d0b647' },
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
    assert.equal(report.error, null);
    assert.equal(report.checks.find((row) => row.id === 'design-mobile-sample')?.status, 'pass');
    const color = report.checks.find((row) => row.id === 'written-color-1');
    assert.equal(color?.classification, 'instance-scoped-css-only');
    assert.equal(color?.status, 'record');
    assert.equal(color?.actual.stylesheetEvidence.matchCount, 1);
    assert.ok(color?.actual.stateExercise.exerciseCounts.attempted > 0);
    assert.ok(color?.actual.stateExercise.exerciseCounts.opened > 0);
    assert.ok(color?.actual.stateExercise.exerciseCounts.restored > 0);
    assert.equal(report.checks.find((row) => row.id === 'bss-breakage-mobile')?.status, 'pass',
      'overlapping text clipped by an overflow-hidden ancestor is not a visible mobile overlap');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
