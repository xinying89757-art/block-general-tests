// Read at call time so values from the repository's .env are available too.
// Defaults: controls 15s, saves 45s, unchanged UI/network window 1s.
export function uiWaitConfig() {
  const ms = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    timeout: ms('UI_READY_TIMEOUT_MS', 15_000),
    saveTimeout: ms('UI_SAVE_TIMEOUT_MS', 45_000),
    stableMs: ms('UI_STABLE_MS', 1_000),
  };
}

const ENVIRONMENT_WAIT_STAGES = new Set(['navigation', 'editor-load', 'library-load']);

export function environmentTimeoutRetries(value = process.env.ENV_TIMEOUT_RETRIES) {
  const parsed = Number(value ?? 1);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2) {
    throw new Error('ENV_TIMEOUT_RETRIES must be an integer from 0 to 2.');
  }
  return parsed;
}

export function isEnvironmentTimeout(error) {
  return error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT'
    || /timeout|timed out/i.test(String(error?.message || ''));
}

/** Retry bounded idempotent environment waits only; assertion and mutation stages are rejected. */
export async function retryEnvironmentTimeout(action, { stage, retries = environmentTimeoutRetries() } = {}) {
  if (!ENVIRONMENT_WAIT_STAGES.has(stage)) throw new Error(`Environment timeout retry is not allowed for stage: ${stage || '(missing)'}`);
  if (!Number.isInteger(retries) || retries < 0 || retries > 2) throw new Error('Environment timeout retries must be from 0 to 2.');
  for (let attempt = 0; ; attempt += 1) {
    try { return await action({ attempt }); }
    catch (error) {
      if (attempt >= retries || !isEnvironmentTimeout(error)) throw error;
    }
  }
}

const transient = (error) => error?.name === 'TimeoutError'
  || /detached|not attached|Execution context was destroyed|Cannot find context/i.test(error?.message || '');

// Retry only a wait/read or an idempotent open, never a whole mutation/check.
export async function retryTransient(action) {
  try { return await action(); }
  catch (error) {
    if (!transient(error)) throw error;
    return action();
  }
}

export async function waitForStable(read, ready = () => true, options = {}) {
  const { timeout, stableMs } = { ...uiWaitConfig(), ...options };
  const deadline = Date.now() + timeout;
  let previous, since = Date.now();
  while (Date.now() < deadline) {
    let value;
    try { value = await read(Math.max(1, deadline - Date.now())); }
    catch (error) {
      if (!transient(error)) throw error;
      previous = undefined;
      since = Date.now();
    }
    const signature = value === undefined ? undefined : JSON.stringify(value);
    if (signature === undefined || !ready(value) || signature !== previous) since = Date.now();
    else if (Date.now() - since >= stableMs) return value;
    previous = signature;
    // Polling interval only; completion depends on observed stability, not sleep.
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
  }
  const error = new Error('等待控件或保存状态稳定超时');
  error.name = 'TimeoutError';
  throw error;
}

export async function waitForControlsReady(root, timeout = uiWaitConfig().timeout) {
  await root.waitFor({ state: 'visible', timeout });
  return waitForStable((remaining) => root.evaluate((node) => {
    const inputs = [...node.querySelectorAll('input, select, textarea')];
    const visible = (element) => element && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden';
    const rect = node.getBoundingClientRect();
    return {
      // Styled radios and Spectrum keep the native input hidden; require its
      // visible label/replacement instead of treating a hidden input as ready.
      ready: inputs.some((input) => input.type !== 'hidden' && (visible(input)
        || [...(input.labels || [])].some(visible) || visible(input.closest('label'))
        || (input.nextElementSibling?.matches('.sp-replacer') && visible(input.nextElementSibling))))
        && !node.matches('[aria-busy="true"]') && !node.querySelector('[aria-busy="true"]')
        && !node.getAnimations({ subtree: true }).some((animation) =>
          animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity),
      rect: [rect.x, rect.y, rect.width, rect.height],
      html: node.innerHTML,
      values: inputs.map((input) => [input.value, input.checked, input.disabled]),
    };
  }, undefined, { timeout: remaining }), (state) => state.ready, { timeout });
}

// Dialog transitions in the page builder are not always reflected by a single
// Playwright visibility state: the modal can be removed, hidden, or covered by
// a stale overlay while its save callback is still completing. Observe several
// independent signals before giving up.
export async function waitForDialogState(dialog, state, timeout = uiWaitConfig().saveTimeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const observed = await dialog.evaluate((node) => ({
      attached: node.isConnected,
      visible: !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
        && getComputedStyle(node).display !== 'none',
      hiddenClass: /(?:^|\s)(?:hide|hidden)(?:\s|$)/i.test(node.className || ''),
      ariaHidden: node.getAttribute('aria-hidden') === 'true',
    })).catch(() => ({ attached: false, visible: false, hiddenClass: true, ariaHidden: true }));
    const closed = !observed.attached || !observed.visible || observed.hiddenClass || observed.ariaHidden;
    if (state === 'closed' ? closed : observed.attached && observed.visible) return observed;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const error = new Error(`等待设置弹窗${state === 'closed' ? '关闭' : '打开'}超时`);
  error.name = 'TimeoutError';
  throw error;
}

// Observe requests BEFORE clicking. Closure alone can precede the asynchronous
// save; require relevant writes to finish and the editor/canvas to stop changing.
export async function saveAndWait(page, action) {
  const pending = new Set();
  let revision = 0;
  const onRequest = (request) => {
    if (['xhr', 'fetch'].includes(request.resourceType())
      && (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /save/i.test(request.url()))) {
      pending.add(request);
      revision++;
    }
  };
  const onDone = (request) => { if (pending.delete(request)) revision++; };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  try {
    await action();
    await retryTransient(() => waitForStable(async () => {
      const frames = await Promise.all(page.frames().map((frame) => frame.evaluate(() => {
        const save = document.querySelector('#saveLayout');
        return {
          ready: document.readyState !== 'loading'
            && (!save || (!save.disabled && save.getAttribute('aria-disabled') !== 'true')),
          save: save?.outerHTML,
          // Ignore carousel/clock content that can keep animating after a save.
          blocks: [...document.querySelectorAll('.siteblocks-setting-wrap')].map((node) => {
            const rect = node.getBoundingClientRect();
            return [node.dataset.appid, node.childElementCount, rect.width, rect.height];
          }),
        };
      })));
      return { pending: pending.size, revision, frames };
    }, (state) => state.pending === 0 && state.frames.every((frame) => frame.ready),
    { timeout: uiWaitConfig().saveTimeout }));
  } finally {
    page.off('request', onRequest);
    page.off('requestfinished', onDone);
    page.off('requestfailed', onDone);
  }
}

// A mismatched first read may be an initialization race. Repeat only the read
// once, after readiness/reopen; callers retain their original final assertion.
export async function readBackWithRetry(read, accepts, prepare) {
  try {
    const value = await read();
    if (accepts(value)) return value;
  } catch { /* read-only failure: try one fresh read before reporting it */ }
  await prepare();
  return read();
}
