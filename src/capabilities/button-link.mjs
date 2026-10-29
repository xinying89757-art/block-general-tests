import { effectCheck, unavailable, readEffectRoot } from './effect-checks.mjs';
import { baselineRestoreTarget, clickSettings, controlSession, probeControls, persistControl, previewSelector, poll, TIMEOUT, checkReportText, blockSelector } from './shared.mjs';
import { retryTransient, uiWaitConfig } from '../ui-waits.mjs';
import { assertAllowedLinkUrl } from '../url-safety.mjs';

const SUITE = 'capability:button-link';
const DEFAULT_TEXT = 'Please set up the required pop-up form here.';
const MARKER = 'data-autotest-button-link-root';
const NAMES = {
  'btn-state': '按钮链接、文本与新窗口当前值',
  'btn-text-persist': '按钮文本保存回读与恢复',
  'btn-url-persist': '链接网址保存回读与恢复',
  'btn-target-persist': '新窗口打开保存回读与恢复',
  'btn-front-text': '预览按钮文本与配置一致',
};
function result(id, status, detail, evidence, textFields = {}) {
  return { id, name: NAMES[id], suite: SUITE, status, detail, ...checkReportText(NAMES[id], status, detail, evidence, id), ...textFields,
    ...(evidence === undefined ? {} : { evidence }) };
}
const outcomeResult = (id, outcome) => result(id, outcome.status, outcome.detail, outcome.evidence);

// The link editor is rendered inside the canvas document. Its actual settings
// root is the unique editor-box carrying both requested labels.
function discoverPopover(body) {
  const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const visible = (node) => Boolean(node.getClientRects().length)
    && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  const candidates = [...body.querySelectorAll('.editor-box')].filter((node) => {
    if (!visible(node)) return false;
    const labels = [...node.querySelectorAll('.label-title')].map((label) => norm(label.innerText));
    return labels.includes('链接网址') && norm(node.innerText).includes('按钮文本');
  });
  if (candidates.length !== 1) return { found: false, candidateCount: candidates.length, rootCount: candidates.length,
    reason: `画布内同时含“链接网址”和“按钮文本”的 editor-box 候选 ${candidates.length} 个，无法唯一定位。` };
  body.querySelectorAll('[data-autotest-button-link-root]').forEach((node) => node.removeAttribute('data-autotest-button-link-root'));
  const root = candidates[0];
  root.setAttribute('data-autotest-button-link-root', 'true');
  const ancestors = [];
  for (let node = root; node && node !== body && ancestors.length < 4; node = node.parentElement) {
    ancestors.push({ tag: node.tagName, className: node.className, id: node.id });
  }
  return { found: true, candidateCount: candidates.length, rootCount: candidates.length, ancestors };
}

function popoverSession({ page, canvas, config }) {
  const body = canvas.locator('body');
  const root = canvas.locator(`[${MARKER}="true"]`).filter({ visible: true });
  let structure;
  const open = async () => {
    if (!await root.isVisible()) await clickSettings(canvas, config, 'phoenix_blocks_button');
    const discovered = await poll(() => body.evaluate(discoverPopover), (data) => data.found);
    if (!discovered.matched) throw Object.assign(new Error(discovered.value.reason), {
      candidateCount: discovered.value.candidateCount, rootCount: discovered.value.rootCount,
    });
    structure = discovered.value;
    await root.waitFor({ state: 'visible', timeout: TIMEOUT });
  };
  const save = async () => {
    const buttons = root.locator('xpath=..').getByText('保存', { exact: true }).filter({ visible: true });
    if (await buttons.count() !== 1) throw new Error('editor-box 或紧邻操作区的保存控件不唯一');
    await buttons.click({ timeout: TIMEOUT });
    await retryTransient(() => root.waitFor({ state: 'hidden', timeout: uiWaitConfig().saveTimeout }));
  };
  const cancel = async () => {
    if (!await root.isVisible()) return;
    const cancelButton = root.getByText('取消', { exact: true }).filter({ visible: true });
    if (await cancelButton.count() === 1) await cancelButton.click({ timeout: TIMEOUT });
    else {
      // Probe-verified (scripts/probe-final2.mjs): this editor-box has no
      // 取消/close affordance; clicking 保存 is the only way it dismisses.
      // cancel() is only invoked with no unsaved edits pending, so saving
      // the unchanged values is a no-op.
      const saveButtons = root.locator('xpath=..').getByText('保存', { exact: true }).filter({ visible: true });
      if (await saveButtons.count() === 1) await saveButtons.click({ timeout: TIMEOUT });
      else {
        await page.keyboard.press('Escape');
        if (await root.isVisible()) await page.mouse.click(1, 1);
      }
    }
    await root.waitFor({ state: 'hidden', timeout: TIMEOUT });
  };
  return { ...controlSession(root, { open, save, cancel }), structure: () => structure };
}

function identify(controls) {
  const texts = controls.filter((item) => ['text', 'url'].includes(item.type) || item.tag === 'TEXTAREA');
  const unique = (items) => items.length === 1 ? items[0] : null;
  const urlCandidates = texts.filter((item) => /链接网址\s*域名\s*邮箱地址/.test(item.label + item.context));
  const textCandidates = texts.filter((item) => /按钮文本/.test(item.label + item.context));
  const url = unique(urlCandidates);
  const text = unique(textCandidates);
  const boxes = controls.filter((item) => item.type === 'checkbox');
  const targetCandidates = boxes.filter((item) => /在新窗口打开/.test(item.label + item.context));
  const target = unique(targetCandidates);
  return { url, text, target, candidateCounts: {
    url: urlCandidates.length, text: textCandidates.length, target: targetCandidates.length,
  } };
}

// Small public surface shared by baseline capture/guard/apply. The labels are
// deliberately the ones used by this module's DOM recognizer.
export async function readButtonPopover({ page, canvas, config }) {
  const session = popoverSession({ page, canvas, config });
  try {
    await session.open();
    const controls = await buttonControls(session);
    const link = await readLinkType(session, controls);
    return {
      text: controls.text.value,
      url: controls.url.value,
      linkType: link.selected,
      newWindow: controls.target.checked,
      want: [
        { label: '按钮文本', type: 'text', to: controls.text.value },
        { label: '链接网址', type: 'text', to: controls.url.value },
        { label: '新窗口打开', type: 'checkbox', to: controls.target.checked },
      ],
    };
  } finally {
    // The editor-box has no cancel button. A read must not use its Save
    // fallback, so dismiss it with Escape and a neutral canvas click only.
    if (await session.root.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
      if (await session.root.isVisible().catch(() => false)) {
        await page.mouse.click(1, 1);
        await page.waitForTimeout(300);
      }
      // Still open: leave it. No edits were made and nothing is saved, so an
      // open popover carries no change; the next open() reuses it.
      // The editor-box has no cancel affordance (scripts/probes/probe-final2.mjs).
      // Nothing was edited, so its Save fallback commits the unchanged values
      // (a no-op); leaving it open breaks every later open/close of the zone.
      if (await session.root.isVisible().catch(() => false)) await session.cancel();
    }
  }
}

export async function writeButtonPopover({ page, canvas, config, want }) {
  const requestedUrl = want.find((item) => item.label === '链接网址');
  if (requestedUrl) assertAllowedLinkUrl(requestedUrl.to);
  const session = popoverSession({ page, canvas, config });
  const get = (label) => want.find((item) => item.label === label);
  try {
    await session.open();
    const text = get('按钮文本');
    if (text) {
      let controls = await buttonControls(session);
      await session.set(controls.text, text.to);
    }
    const url = get('链接网址');
    const window = get('新窗口打开');
    if (url) {
      const controls = await buttonControls(session);
      const tabs = await readLinkType(session, controls);
      await setLink(session, tabs.selected || '域名', url.to);
    }
    if (window) {
      const controls = await buttonControls(session);
      await session.set(controls.target, window.to);
      await session.save();
    } else if (text) await session.save();
    await session.open();
    const after = await buttonControls(session);
    const values = { text: after.text.value, url: after.url.value, newWindow: after.target.checked };
    const verified = (!text || values.text === text.to) && (!url || values.url === url.to)
      && (!window || values.newWindow === window.to);
    if (!verified) throw new Error('按钮浮层写入后回读与目标值不一致');
    return { values, verified };
  } finally { await session.cancel(); }
}

export async function runSettingsLayer({ page, canvas, context, config }) {
  if (config.frontOnly) return buttonEffectChecks({ page, canvas, context, config }, 'front');
  const session = popoverSession({ page, canvas, config });
  const ids = ['btn-state', 'btn-text-persist', 'btn-url-persist', 'btn-target-persist'];
  const checks = [];
  try {
    const initial = await probeControls(session);
    if (initial.reason) return ids.map((id) => result(id, 'skip', `链接编辑浮层不可用：${initial.reason}`,
      { candidateCount: initial.candidateCount ?? null, rootCount: initial.rootCount ?? null }));
    const visibleIndices = await session.root.evaluate((root) => [...root.querySelectorAll('input, textarea')]
      .map((input, index) => ({ input, index })).filter(({ input }) => input.getClientRects().length
        && getComputedStyle(input).display !== 'none' && getComputedStyle(input).visibility !== 'hidden')
      .map(({ index }) => index));
    const visibleControls = initial.controls.filter((item) => visibleIndices.includes(item.index));
    const current = identify(visibleControls);
    if (!current.url || !current.text || !current.target || current.url.index === current.text.index) {
      return ids.map((id) => result(id, 'fail', `已找到 editor-box，但可见控件无法唯一定位，未执行任何改写；候选数：链接网址 ${current.candidateCounts.url}、按钮文本 ${current.candidateCounts.text}、新窗口复选框 ${current.candidateCounts.target}。`,
        { structure: session.structure(), candidateCounts: current.candidateCounts, controls: initial.controls }));
    }
    config.buttonLinkText = current.text.value;
    checks.push(result('btn-state', 'record', '已记录链接网址、按钮文本与新窗口勾选状态。', {
      url: current.url.value, text: current.text.value, target: current.target.checked, structure: session.structure(),
    }));
    // Confirm dismissal and reopen before the first mutation; an uncertain
    // popover lifecycle must degrade to skip, never strand an edited value.
    try { await session.cancel(); await session.open(); }
    catch (error) { return checks.concat(ids.slice(1).map((id) => result(id, 'skip', `浮层关闭/重开定位不稳定：${error.message}`))); }
    for (const [id, key, alternate] of [
      ['btn-text-persist', 'text', current.text.value === 'AUTOTEST-BTN' ? 'AUTOTEST-BTN-ALT' : 'AUTOTEST-BTN'],
      ['btn-url-persist', 'url', BAIDU],
      ['btn-target-persist', 'target', !current.target.checked],
    ]) {
      if (id === 'btn-url-persist') {
        checks.push(await urlPersistenceCheck({ page, canvas, context, config }, session));
        continue;
      }
      const probe = await probeControls(session);
      const currentIndices = await session.root.evaluate((root) => [...root.querySelectorAll('input, textarea')]
        .map((input, index) => ({ input, index })).filter(({ input }) => input.getClientRects().length
          && getComputedStyle(input).display !== 'none' && getComputedStyle(input).visibility !== 'hidden')
        .map(({ index }) => index));
      const target = probe.controls && identify(probe.controls.filter((item) => currentIndices.includes(item.index)))[key];
      const snapshot = target && target[key === 'text' ? 'value' : 'checked'];
      const canonical = key === 'text' ? '按钮文本' : key === 'url' ? '链接网址' : '新窗口打开';
      const baselineRestore = config.baselineValue?.('phoenix_blocks_button', canonical);
      const restore = baselineRestoreTarget({ snapshot, baselineValue: baselineRestore,
        defaultValue: key === 'text' ? DEFAULT_TEXT : 'javascript:void(0)' });
      checks.push(!target || target.disabled || target.readOnly ? result(id, 'skip', probe.reason || '浮层控件缺失或不可编辑。')
        : outcomeResult(id, await persistControl({ session, page, target, alternate,
          restoreValue: restore.value, restoreSource: restore.source })));
    }
  } finally {
    try { await session.cancel(); } catch (error) {
      if (checks.length) { checks.at(-1).status = 'fail'; checks.at(-1).detail += `；退出浮层失败：${error.message}`; }
    }
    await canvas.locator(`[${MARKER}]`).evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute('data-autotest-button-link-root'))).catch(() => {});
  }
  checks.push(...await buttonEffectChecks({ page, canvas, context, config }, 'front'));
  return checks;
}

export async function runFrontEffectsLayer(args) { return buttonEffectChecks(args, 'front'); }

export async function runFrontLayer({ frame, config }) {
  const expected = config.buttonLinkText ?? DEFAULT_TEXT;
  const source = config.buttonLinkText === undefined ? '盘点默认值（设置层未读到文案）' : '设置层读取值';
  try {
    const root = frame.locator(previewSelector(config.blockId)).first();
    await root.waitFor({ state: 'attached', timeout: TIMEOUT });
    const matched = await poll(() => root.getByText(expected, { exact: true }).count(), (count) => count > 0);
    return [result('btn-front-text', expected.trim() && matched.matched ? 'pass' : 'fail',
      `从${source}读取的按钮文字“${expected}”在预览中精确匹配 ${matched.value} 个元素。`, { expected, matches: matched.value, source },
      { expected: `预览中应有按钮文字“${expected}”，且文字内容应与设置值完全一致。` })];
  } catch (error) {
    return [result('btn-front-text', 'fail', `预览按钮文字检查失败：${error.message}`, { expected, source },
      { expected: `预览中应有按钮文字“${expected}”，且文字内容应与设置值完全一致。` })];
  }
}

const BAIDU = 'https://www.baidu.com';
Object.assign(NAMES, {
  'btn-text-backend': '修改后的按钮文字在画布生效',
  'btn-text-front': '修改后的按钮文字在预览生效',
  'btn-url-backend': '百度链接在画布生效',
  'btn-url-front': '百度链接在预览生效',
  'btn-target-backend': '按钮打开方式在画布生效',
  'btn-target-front': '按钮打开方式在预览生效',
});

async function buttonControls(session) {
  const probe = await probeControls(session);
  if (probe.reason) unavailable('按钮设置浮层暂时读不到。');
  const indices = await session.root.evaluate((root) => [...root.querySelectorAll('input, textarea')]
    .map((input, index) => ({ input, index })).filter(({ input }) => input.getClientRects().length
      && getComputedStyle(input).visibility !== 'hidden').map(({ index }) => index));
  const current = identify(probe.controls.filter((item) => indices.includes(item.index)));
  if (!current.text || !current.url || !current.target) unavailable('不能唯一确定按钮的文字、链接和新窗口设置。');
  return current;
}

// Prefer an unambiguous active-tab marker. Some editor versions expose no
// usable marker; readLinkType below preserves the previously working URL rule.
async function linkTabs(session, click) {
  return session.root.evaluate((root, wanted) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const tabs = ['域名', '邮箱地址'].map((text) => {
      const candidates = [...root.querySelectorAll('a, button, li, label, span, div, [role="tab"]')]
        .filter((node) => visible(node) && norm(node.innerText) === text);
      const leaves = candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
      const node = leaves.length === 1 ? leaves[0] : null;
      const active = (item) => item && (item.getAttribute('aria-selected') === 'true'
        || /(^|\s)(active|selected|current|on)(\s|$)/i.test(item.className || '')
        || item.querySelector('input[type="radio"]:checked'));
      return { text, node, selected: Boolean(node && (active(node) || active(node.parentElement))) };
    });
    const selected = tabs.filter((tab) => tab.selected);
    if (wanted) {
      const tab = tabs.find((item) => item.text === wanted);
      if (!tab?.node) return { found: false };
      tab.node.click();
    }
    return { found: tabs.every((tab) => tab.node), selected: selected.length === 1 ? selected[0].text : null,
      tabs: tabs.map(({ text, selected }) => ({ text, selected })) };
  }, click);
}

async function readLinkType(session, current) {
  const tabs = await linkTabs(session);
  return { ...tabs, selected: tabs.selected || (/^mailto:/i.test(current.url.value) ? '邮箱地址' : '域名'),
    source: tabs.selected ? 'tab-marker' : 'url-prefix' };
}

async function setLink(session, tab, value) {
  assertAllowedLinkUrl(value);
  await session.open();
  const structure = await linkTabs(session);
  if (!structure.found) unavailable('链接类型页签无法唯一定位，未改写链接。');
  if (structure.selected !== tab) {
    await linkTabs(session, tab);
    // Without markers, the old content still describes the old type at this
    // point. Click the requested tab, fill, then verify after save/reopen;
    // polling the old mailto: value here would prevent switching to a domain.
    if (structure.selected) {
      const ready = await poll(() => linkTabs(session), (data) => data.selected === tab);
      if (!ready.matched) throw new Error('切换后无法确认链接类型页签');
    }
  }
  const current = await buttonControls(session);
  await session.set(current.url, value);
  await session.save();
  await session.open();
  const back = await buttonControls(session);
  const tabs = await readLinkType(session, back);
  if (back.url.value !== value || tabs.selected !== tab) throw new Error('链接类型或链接保存重开后不一致');
  return tabs;
}

async function prepareBaidu(tx, session) {
  const original = await buttonControls(session);
  const tabs = await readLinkType(session, original);
  tx.evidence.linkTabs = tabs;
  if (!tabs.found) unavailable('链接类型页签无法唯一定位，未改写链接。');
  const restoreUrl = baselineRestoreTarget({ snapshot: original.url.value,
    baselineValue: txConfigBaseline(tx, original.url.label), defaultValue: 'javascript:void(0)' });
  tx.remember('button-url-and-type', async () => {
    const restored = await setLink(session, tabs.selected, restoreUrl.value);
    tx.evidence.restoredLink = { type: restored.selected, source: restored.source, value: restoreUrl.value,
      restoreTarget: restoreUrl.source };
  });
  tx.evidence.baiduLinkType = await setLink(session, '域名', BAIDU);
  return original;
}

function txConfigBaseline(tx, label) {
  return tx.baselineValue?.('phoenix_blocks_button', label);
}

async function urlPersistenceCheck(args, session) {
  return effectCheck({ ...args, session, result, id: 'btn-url-persist', layer: 'settings', run: async (tx) => {
    const original = await prepareBaidu(tx, session);
    tx.expected(`链接改为百度 ${BAIDU} 后保存重开应保持百度，恢复后链接及域名或邮箱类型应与原设置一致。`);
    const back = await buttonControls(session);
    tx.assert(back.url.value === BAIDU, `原链接为“${original.url.value}”，保存重开后链接为“${back.url.value}”。`);
  } });
}

const BUTTON = 'a.blocks-button, .backstage-component-btn, .pf-btn-wrap a, .pf-btn-wrap button';
function buttonSnapshot(root) {
  const candidates = [...root.querySelectorAll('a.blocks-button, .backstage-component-btn, .pf-btn-wrap a, .pf-btn-wrap button')]
    .filter((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  // Deduplicate nested editor/preview wrappers, but never pick an arbitrary link.
  const nodes = candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
  if (nodes.length !== 1) return { unique: false, count: nodes.length };
  const node = nodes[0], link = node.matches('a') ? node : node.closest('a');
  return { unique: true, text: (node.innerText || '').trim(), href: link?.getAttribute('href') ?? null,
    target: link?.getAttribute('target') ?? null, scripted: Boolean(link?.getAttribute('onclick') || node.getAttribute('onclick')) };
}
const isBaidu = (value) => { try { const url = new URL(value); return url.origin === BAIDU && url.pathname === '/' && !url.search && !url.hash; } catch { return false; } };

async function inspectButton(frame, previewPage, config, kind, wanted) {
  const observed = await readEffectRoot(frame, config, buttonSnapshot);
  if (!observed.unique) unavailable('目标按钮无法唯一定位，未以区块中的其他链接替代。');
  if (kind === 'text') return observed;
  const real = observed.href && /^(https?:|mailto:)/i.test(observed.href);
  if (real && !observed.scripted) return { ...observed, sameAddress: isBaidu(observed.href), newWindow: observed.target === '_blank' };
  if (!previewPage) unavailable('画布按钮使用占位地址或脚本控制，后台看不到真实链接或打开方式。');
  const context = previewPage.context(), before = new Set(context.pages());
  const originalUrl = frame.url(), originalTopUrl = previewPage.url();
  const root = frame.locator(blockSelector(config.blockId)).first();
  const button = root.locator(BUTTON).filter({ visible: true });
  if (await button.count() !== 1) unavailable('临时预览中可点击的目标按钮不唯一。');
  const navigations = [];
  const onNavigation = (changed) => { if (changed === frame) navigations.push(changed.url()); };
  const onRequest = (request) => { if (request.isNavigationRequest() && request.frame() === frame) navigations.push(request.url()); };
  previewPage.on('framenavigated', onNavigation);
  previewPage.on('request', onRequest);
  try {
    await button.click({ timeout: TIMEOUT, noWaitAfter: true });
    const landed = await poll(async () => {
      const tabs = context.pages().filter((tab) => !before.has(tab));
      const popup = tabs[0];
      const addresses = popup ? [popup.url(), ...popup.frames().map((child) => child.url())] : [frame.url(), previewPage.url(), ...navigations];
      return { tabs: tabs.length, addresses, changed: Boolean(popup || navigations.length || frame.url() !== originalUrl || previewPage.url() !== originalTopUrl) };
    }, (value) => value.changed && value.addresses.some(isBaidu));
    return { ...observed, click: landed.value, sameAddress: landed.matched, newWindow: Boolean(landed.value?.tabs), wanted };
  } finally {
    previewPage.off('framenavigated', onNavigation);
    previewPage.off('request', onRequest);
  }
}

export function buttonMatchesTargetExpectation(observed, checked) {
  return observed.sameAddress === true && observed.newWindow === checked;
}

async function buttonEffectChecks(args, layer) {
  const checks = [];
  for (const kind of ['text', 'url', 'target']) {
    const session = popoverSession(args), id = `btn-${kind}-${layer}`;
    checks.push(await effectCheck({ ...args, session, result, id, layer, run: async (tx) => {
      const initial = await buttonControls(session);
      if (kind === 'text') {
        const value = initial.text.value === 'AUTOTEST-BTN' ? 'AUTOTEST-BTN-ALT' : 'AUTOTEST-BTN';
        tx.expected(`目标按钮本身的文字应恰好为“${value}”。`);
        await tx.set(initial.text, value); await tx.save();
        const observed = layer === 'backend' ? await inspectButton(args.canvas, null, args.config, kind)
          : await tx.observe((frame, tab) => inspectButton(frame, tab, args.config, kind));
        tx.evidence.button = observed;
        tx.assert(observed.text === value, `目标按钮文字为“${observed.text}”，设置文字为“${value}”。`);
      } else {
        await prepareBaidu(tx, session);
        const states = kind === 'target' ? [false, true] : [initial.target.checked];
        tx.expected(`目标按钮地址应为百度 ${BAIDU}；${kind === 'target' ? '取消新窗口时应在当前页打开，勾选时应新开页面' : `打开方式应保持${initial.target.checked ? '新窗口' : '当前页'}`}。`);
        for (const checked of states) {
          const current = await buttonControls(session);
          await tx.set(current.target, checked); await tx.save();
          const observed = layer === 'backend' ? await inspectButton(args.canvas, null, args.config, kind, checked)
            : await tx.observe((frame, tab) => inspectButton(frame, tab, args.config, kind, checked));
          (tx.evidence.buttons ||= []).push(observed);
          tx.assert(buttonMatchesTargetExpectation(observed, checked),
            `设置为${checked ? '新窗口' : '当前页'}打开百度；观察到地址“${observed.href || '由点击跳转取证'}”，${observed.newWindow ? '新开页面' : '当前页打开'}，地址核对${observed.sameAddress ? '一致' : '不一致'}。`);
        }
      }
    } }));
  }
  return checks;
}
export async function runBackendLayer(args) { return buttonEffectChecks(args, 'backend'); }
