import { readInstanceStructure } from './front-structure.mjs';
import { readPrimaryImageMetrics } from './image-geometry.mjs';

export const DEFAULT_IMAGE_LOAD_TIMEOUT_MS = 8000;
export function imageLoadTimeout(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_IMAGE_LOAD_TIMEOUT_MS;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Image load timeout must be a positive integer in milliseconds.');
  return number;
}

async function bounded(operation, ms) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('image-load-timeout'), { code: 'image-load-timeout' })), Math.max(1, ms));
  })]); } finally { clearTimeout(timer); }
}

// Only scroll operations mutate UI state. Source/lazy attributes are read, never
// copied into src/srcset; the page's own lazy loader remains responsible for it.
export async function preparePrimaryImages({ page, rootSelector, structureOptions = {}, timeoutMs }) {
  const budget = imageLoadTimeout(timeoutMs), started = performance.now();
  const restoreReserve = Math.min(1000, budget / 3), deadline = started + budget - restoreReserve;
  const remaining = () => Math.max(1, deadline - performance.now());
  const run = (operation) => {
    if (performance.now() >= deadline) throw Object.assign(new Error('image-load-timeout'), { code: 'image-load-timeout' });
    return bounded(operation, remaining());
  };
  const loading = { timeoutMs: budget, scrollSteps: 0, loaded: 0, total: 0, timedOut: false, scrollRestored: false };
  let saved, structure, metrics = [];
  try {
    saved = await run(() => page.evaluateHandle(({ rootSelector }) => {
      const root = document.querySelector(rootSelector);
      const nodes = root ? [...new Set([root, ...root.querySelectorAll('*'), ...(() => {
        const result = []; for (let parent = root.parentElement; parent; parent = parent.parentElement) result.push(parent); return result;
      })()])] : [];
      return { x: scrollX, y: scrollY, positions: nodes.filter((node) => node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)
        .map((node) => ({ node, left: node.scrollLeft, top: node.scrollTop })) };
    }, { rootSelector }));
    structure = await run(() => page.evaluate(readInstanceStructure, { rootSelector, ...structureOptions }));
    if (structure.rootFound && await run(() => page.locator(rootSelector).locator('img, picture, [style*="background"]').count())) {
      await run(() => page.locator(rootSelector).scrollIntoViewIfNeeded({ timeout: remaining() })); loading.scrollSteps++;
      const range = await run(() => page.evaluate(({ rootSelector }) => {
        const rect = document.querySelector(rootSelector).getBoundingClientRect();
        return { start: scrollY + rect.top, end: scrollY + rect.bottom - innerHeight, step: Math.max(1, innerHeight * .7) };
      }, { rootSelector }));
      const stops = [];
      for (let top = range.start; top < Math.max(range.start, range.end); top += range.step) stops.push(top);
      stops.push(Math.max(range.start, range.end));
      for (const top of stops) {
        await run(() => page.evaluate((y) => { scrollTo({ top: y, left: scrollX, behavior: 'instant' }); }, top));
        loading.scrollSteps++;
        await run(() => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      }
      structure = await run(() => page.evaluate(readInstanceStructure, { rootSelector, ...structureOptions }));
      // scrollIntoView also exposes selected images in nested scroll containers.
      for (const image of structure.images) {
        await run(() => page.locator(rootSelector).locator(image.path).scrollIntoViewIfNeeded({ timeout: remaining() }));
        loading.scrollSteps++;
        await run(() => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve))));
      }
      await run(() => page.waitForFunction(({ rootSelector, paths }) => {
        const root = document.querySelector(rootSelector);
        return Boolean(root) && paths.every((path) => {
          const node = path === ':scope' ? root : root.querySelector(path);
          const image = node?.matches('picture') ? node.querySelector('img') : node?.matches('img') ? node : null;
          return node && (!image || image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        });
      }, { rootSelector, paths: structure.images.map((image) => image.path) }, { timeout: remaining(), polling: 50 }));
    }
  } catch (error) {
    loading.timedOut = error.code === 'image-load-timeout' || error.name === 'TimeoutError';
    loading.code = loading.timedOut ? 'image-load-timeout' : 'image-load-preparation-unavailable';
  } finally {
    // Measurements are captured before restoring scroll. Metadata reads get a
    // small reserved portion of the same total deadline, never a per-img wait.
    try {
      const tailBudget = Math.max(1, started + budget - performance.now());
      const final = await bounded(async () => {
        const snapshot = await page.evaluate(readInstanceStructure, { rootSelector, ...structureOptions });
        const measured = await page.evaluate(readPrimaryImageMetrics, { rootSelector, paths: snapshot.images.map((image) => image.path) });
        if (!Array.isArray(measured)) throw new Error('image-metrics-unavailable');
        return { snapshot, measured };
      }, Math.max(1, tailBudget * .7));
      structure = final.snapshot; metrics = final.measured;
    } catch { loading.code ||= 'image-metrics-unavailable'; }
    try {
      if (saved) {
        loading.scrollRestored = await bounded(() => page.evaluate(function restoreImageScroll(snapshot) {
          for (const { node, left, top } of snapshot.positions) if (node.isConnected) node.scrollTo({ left, top, behavior: 'instant' });
          scrollTo({ left: snapshot.x, top: snapshot.y, behavior: 'instant' });
          return Math.abs(scrollX - snapshot.x) <= 1 && Math.abs(scrollY - snapshot.y) <= 1
            && snapshot.positions.every(({ node, left, top }) => !node.isConnected
              || Math.abs(node.scrollLeft - left) <= 1 && Math.abs(node.scrollTop - top) <= 1);
        }, saved), Math.max(1, started + budget - performance.now()));
        if (!loading.scrollRestored) loading.code = 'image-load-scroll-restore-failed';
      }
    } catch { loading.code = 'image-load-scroll-restore-failed'; }
    if (saved) await bounded(() => saved.dispose(), Math.max(1, started + budget - performance.now())).catch(() => {});
  }
  loading.total = (structure?.images || []).filter((row) => row.kind !== 'background-image').length;
  loading.loaded = metrics.filter((row) => row.kind === 'image' && row.loaded).length;
  loading.elapsedMs = Math.round(performance.now() - started);
  return { structure, metrics, loading };
}
