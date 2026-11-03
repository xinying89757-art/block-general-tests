/**
 * Lightweight front-entry selection. Importing this module never starts a browser.
 * Published entries defer preview checks to Mac; they do not publish the site.
 * @module front-provider
 */

/** @type {Readonly<{ PREVIEW: 'preview', PUBLISHED: 'published' }>} */
export const FRONT_PROVIDERS = Object.freeze({ PREVIEW: 'preview', PUBLISHED: 'published' });

/** Signal that a preview-dependent check must be deferred to Mac. */
export class FrontProviderPublishedError extends Error {
  /** @param {string} [message] Human-readable deferral reason. */
  constructor(message = '前台入口为 published，跳过预览，延期到 Mac 验证') {
    super(message);
    this.name = 'FrontProviderPublishedError';
    this.code = 'FRONT_PROVIDER_PUBLISHED';
  }
}

/** @type {{ available: boolean, reason: string } | undefined} */
let lastPreviewDetection;

/**
 * Read FRONT_PROVIDER without performing browser operations.
 * Unset/invalid values fall back to preview. In auto mode, use the latest
 * explicit detectPreviewAvailable() result in this process; before a probe,
 * retain preview and request detection via needsDetection. Doctor/scripts own
 * that probe so the existing openPreview workflow remains unchanged.
 * @param {{ FRONT_PROVIDER?: string }} [env=process.env] Injectable environment.
 * @returns {{ provider: 'preview' | 'published', mode: 'preview' | 'published' | 'auto', needsDetection: boolean }}
 */
export function selectFrontProvider(env = process.env) {
  const value = String(env.FRONT_PROVIDER ?? '').trim().toLowerCase();
  const mode = ['preview', 'published', 'auto'].includes(value) ? value : 'preview';
  return {
    provider: mode === 'published' || (mode === 'auto' && lastPreviewDetection?.available === false)
      ? FRONT_PROVIDERS.PUBLISHED : FRONT_PROVIDERS.PREVIEW,
    mode,
    needsDetection: mode === 'auto' && lastPreviewDetection === undefined,
  };
}

/**
 * Open a throwaway editor preview and look for its content frame by hostname.
 * The deadline covers clicking, opening the tab and waiting for the frame
 * (10 seconds by default). Always close the probe tab, including on success;
 * operational failures return an unavailable result rather than throwing.
 * This probe is independent of editor.openPreview and updates auto selection.
 * @param {import('playwright-core').Page} page Editor page with .clickToPreview.
 * @param {import('playwright-core').BrowserContext} context Editor context.
 * @param {{ timeoutMs?: number }} [options] Total probe deadline in milliseconds.
 * @returns {Promise<{ available: boolean, reason: string }>} Probe outcome.
 */
export async function detectPreviewAvailable(page, context, { timeoutMs = 10_000 } = {}) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;
  let previewPage, onFrame, timer, finished = false;
  const isContent = (frame) => {
    try { return new URL(frame.url()).hostname.endsWith('.preview.leadong.com'); }
    catch { return false; }
  };
  const closePreview = async (tab) => {
    if (tab && !tab.isClosed()) await tab.close();
  };
  let result;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`预览探测超时（${timeout}ms），未找到 .preview.leadong.com 内容 frame。`)), timeout);
    });
    const opened = context.waitForEvent('page', { timeout }).then(async (tab) => {
      previewPage = tab;
      // A slow popup may arrive after a failed click or the overall deadline.
      if (finished) {
        await closePreview(tab).catch(() => {});
        return;
      }
      return new Promise((resolve) => {
        onFrame = (frame) => { if (isContent(frame)) resolve(frame); };
        tab.on('framenavigated', onFrame);
        const frame = tab.frames().find(isContent);
        if (frame) resolve(frame);
      });
    });
    await Promise.race([
      Promise.all([opened, page.locator('.clickToPreview').click({ timeout })]),
      deadline,
    ]);
    result = { available: true, reason: '预览内容 frame 可用（.preview.leadong.com）。' };
  } catch {
    // Do not echo browser errors: they can contain preview tokens or URLs.
    result = { available: false, reason: `预览不可用：${timeout}ms 内未能打开预览并找到 .preview.leadong.com 内容 frame。` };
  } finally {
    finished = true;
    clearTimeout(timer);
    try {
      if (previewPage && onFrame) previewPage.off('framenavigated', onFrame);
      await closePreview(previewPage);
    } catch {
      result = { available: false, reason: '预览探测结束，但临时预览页未能正常关闭。' };
    }
  }
  lastPreviewDetection = result;
  return result;
}
