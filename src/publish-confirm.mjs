// Generic publish confirmation. Clicking 发布 is not proof of publishing:
// wait for an explicit success/failure signal from the editor, then check the
// public front page (cache-busted with ?t=) for the exact block instance.
export const PUBLISH_SUCCESS = /发布成功|已发布|publish(ed)? success/i;
export const PUBLISH_FAILURE = /发布失败|publish(ing)? failed/i;

export async function waitForPublishSignal({ readTexts, timeoutMs = 60_000, pollMs = 500, sleep = defaultSleep, now = Date.now }) {
  const start = now();
  for (;;) {
    const texts = (await readTexts()).map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const failed = texts.find((t) => PUBLISH_FAILURE.test(t));
    if (failed) return { status: 'failed', signal: failed };
    const ok = texts.find((t) => PUBLISH_SUCCESS.test(t));
    if (ok) return { status: 'confirmed', signal: ok };
    if (now() - start >= timeoutMs) return { status: 'no-signal', signal: null };
    await sleep(pollMs);
  }
}

export function cacheBustedUrl(url, t = Date.now()) {
  const u = new URL(url);
  u.searchParams.set('t', String(t));
  return u.href;
}

export function frontHasInstance(html, { blockId, settingId }) {
  const hasBlock = new RegExp(`data-appid=["']${String(blockId).replace(/[^\w-]/g, '')}["']`).test(html);
  const hasSetting = settingId ? String(html).includes(String(settingId)) : null;
  return { hasBlock, hasSetting };
}

export async function verifyFrontInstance({ fetchText, url, blockId, settingId, attempts = 6, delayMs = 10_000, sleep = defaultSleep, now = Date.now }) {
  const tries = [];
  for (let i = 0; i < attempts; i += 1) {
    const target = cacheBustedUrl(url, now());
    let result;
    try {
      const { status, text } = await fetchText(target);
      result = { url: target, status, ...frontHasInstance(text || '', { blockId, settingId }) };
    } catch (error) { result = { url: target, error: error.message }; }
    tries.push(result);
    if (result.hasBlock && result.hasSetting !== false) return { status: 'present', tries };
    if (i < attempts - 1) await sleep(delayMs);
  }
  const reachable = tries.some((t) => t.status === 200);
  return { status: reachable ? 'absent' : 'unreachable', tries };
}

function defaultSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// The toolbar 发布 is a dropdown toggle (整站发布 / 当前页面发布). Clicking it alone
// publishes nothing. Pick exactly one submenu entry for the requested scope.
export const PUBLISH_SCOPES = { current: /^当前页面发布$/, all: /^整站发布$/ };
export function choosePublishMenuItem(labels, scope = 'current') {
  const pattern = PUBLISH_SCOPES[scope];
  if (!pattern) throw new Error(`未知发布范围 ${scope}；可选 current 或 all。`);
  const hits = labels.flatMap((l, i) => (pattern.test(String(l || '').replace(/\s+/g, ' ').trim()) ? [i] : []));
  if (hits.length !== 1) throw new Error(`发布菜单「${scope}」匹配 ${hits.length} 个；拒绝发布。`);
  return hits[0];
}

export function publishStageDiagnostics({ stage, chooserVisibleCount = 0, publishMenuVisibleCount = 0,
  confirmDialogVisibleCount = 0 }) {
  return { stage, chooserVisibleCount, publishMenuVisibleCount, confirmDialogVisibleCount };
}
