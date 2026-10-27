import { clickSettings, controlSession, probeControls, persistControl, previewSelector, poll, TIMEOUT, checkReportText } from './shared.mjs';

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
    await root.waitFor({ state: 'hidden', timeout: TIMEOUT });
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

export async function runSettingsLayer({ page, canvas, context, config }) {
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
      ['btn-url-persist', 'url', current.url.value.startsWith('mailto:')
        ? 'mailto:autotest@example.com' : 'https://example.com/autotest'],
      ['btn-target-persist', 'target', !current.target.checked],
    ]) {
      const probe = await probeControls(session);
      const currentIndices = await session.root.evaluate((root) => [...root.querySelectorAll('input, textarea')]
        .map((input, index) => ({ input, index })).filter(({ input }) => input.getClientRects().length
          && getComputedStyle(input).display !== 'none' && getComputedStyle(input).visibility !== 'hidden')
        .map(({ index }) => index));
      const target = probe.controls && identify(probe.controls.filter((item) => currentIndices.includes(item.index)))[key];
      checks.push(!target || target.disabled || target.readOnly ? result(id, 'skip', probe.reason || '浮层控件缺失或不可编辑。')
        : outcomeResult(id, await persistControl({ session, page, target, alternate })));
    }
  } finally {
    try { await session.cancel(); } catch (error) {
      if (checks.length) { checks.at(-1).status = 'fail'; checks.at(-1).detail += `；退出浮层失败：${error.message}`; }
    }
    await canvas.locator(`[${MARKER}]`).evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute('data-autotest-button-link-root'))).catch(() => {});
  }
  return checks;
}

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
