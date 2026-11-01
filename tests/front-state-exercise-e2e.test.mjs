import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { exerciseWrittenColorStates } from '../src/design-spec-checklist.mjs';
import { readInstanceStructure } from '../src/front-structure.mjs';

const fixture = `<!doctype html><style>
  .target { width: 360px; } .icon-toggle { display:inline-block;cursor:pointer;width:32px;height:24px; }
  .class-panel { display:none;color:#13579b; } .class-panel.open { display:block; }
  .slide-panel { display:none;height:0;overflow:hidden;color:#2468ac; }
</style><div class="target">
  <ul><li><span class="icon-toggle" onclick="this.nextElementSibling.classList.toggle('open')">+</span><ul class="class-panel"><li>Panel</li></ul></li></ul>
  <div><button type="button" style="cursor:pointer" onclick="slideToggle(this.nextElementSibling)">Slide</button><div class="slide-panel"><span>Animated panel</span></div></div>
</div><script>
function slideToggle(panel) {
  const opening = getComputedStyle(panel).display === 'none';
  panel.style.display = 'block';
  const started = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - started) / 160);
    panel.style.height = (opening ? progress * 36 : (1 - progress) * 36) + 'px';
    if (progress < 1) requestAnimationFrame(frame);
    else if (!opening) panel.style.display = 'none';
  }
  requestAnimationFrame(frame);
}
</script>`;

test('state exercise opens and restores icon/sibling class toggles and animated slideToggle panels', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    const result = await exerciseWrittenColorStates(page, '.target', [
      { id: 'class-color', value: '#13579b' }, { id: 'slide-color', value: '#2468ac' },
    ], { overallTimeoutMs: 15000 });
    assert.equal(result.revealed['class-color']?.state, 'category-expanded');
    assert.equal(result.revealed['slide-color']?.state, 'category-expanded');
    assert.equal(result.exerciseCounts.togglesOpened, 2);
    assert.equal(result.exerciseCounts.restored, 2);
    assert.ok(result.candidateDiagnostics.every((entry) => entry.clickTarget?.rect?.width > 0));
    assert.ok(result.candidateDiagnostics.filter((entry) => entry.status === 'opened').every((entry) => entry.observation.mutationCount > 0 && entry.restored));
    assert.equal(await page.locator('.class-panel').isVisible(), false);
    assert.equal(await page.locator('.slide-panel').isVisible(), false);
  } finally { await browser.close(); }
});

test('actionability timeout uses a bounded DOM fallback and restores the same instance-local toggle', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    await page.locator('.slide-panel').locator('..').evaluate((element) => element.remove());
    await page.locator('.icon-toggle').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const overlay = document.createElement('div');
      Object.assign(overlay.style, { position: 'absolute', left: `${rect.x}px`, top: `${rect.y}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, zIndex: '999' });
      document.body.appendChild(overlay);
    });
    const result = await exerciseWrittenColorStates(page, '.target', [{ id: 'color', value: '#13579b' }],
      { actionTimeoutMs: 650, overallTimeoutMs: 10000 });
    assert.equal(result.exerciseCounts.togglesOpened, 1);
    assert.equal(result.exerciseCounts.restored, 1);
    assert.equal(result.candidateDiagnostics[0].trial.status, 'timeout');
    assert.equal(result.candidateDiagnostics[0].clickMethod, 'dom-click-after-actionability-timeout');
    assert.equal(await page.locator('.class-panel').isVisible(), false);
  } finally { await browser.close(); }
});

test('category arrow SVG resolves once to its span, waits for delayed li class change and restores', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>.icon {display:inline-block;width:28px;height:28px;cursor:pointer}.icon svg {width:14px;height:14px}
      .sub{display:none;color:#2468ac}li.open > .sub{display:block}</style>
      <div class="target"><button class="reset-all" style="position:absolute;top:-16px" onclick="window.resetCount++">Reset all</button>
      <ul><li><a href="/must-not-navigate">Parent</a><span class="icon"><svg viewBox="0 0 20 20"><path d="M2 5L10 15L18 5"/></svg></span>
      <ul class="sub"><li>Child</li></ul></li></ul></div>`);
    await page.evaluate(() => { window.resetCount = 0; document.querySelector('.icon').addEventListener('click', function () {
      setTimeout(() => this.parentElement.classList.toggle('open'), 300);
    }); });
    const structure = await page.evaluate(readInstanceStructure, { rootSelector: '.target' });
    assert.equal(structure.disclosures.length, 1, 'reset/anchor/SVG/path are not extra disclosure actions');
    const result = await exerciseWrittenColorStates(page, '.target', [{ id: 'tree-color', value: '#2468ac' }], { overallTimeoutMs: 15000 });
    assert.equal(result.exerciseCounts.attempted, 1);
    assert.equal(result.exerciseCounts.togglesOpened, 1);
    assert.equal(result.exerciseCounts.restored, 1);
    assert.equal(result.revealed['tree-color']?.state, 'category-expanded');
    assert.equal(result.candidateDiagnostics[0].clickTarget.tag, 'span');
    assert.ok(result.candidateDiagnostics[0].observation.waitedMs >= 1400);
    assert.equal(await page.locator('li.open').count(), 0);
    assert.equal(await page.locator('.sub').isVisible(), false);
    assert.equal(await page.evaluate(() => window.resetCount), 0);
    assert.equal(page.url(), 'about:blank');
  } finally { await browser.close(); }
});
