// Block color scheme (区块配色): the single scheme color in the right
// icon rail (配色 → .siteblocks-setting-operateColor flyout). Figma Page 3
// defines exactly one scheme, #1C4587, applied to: button text, slider,
// pagination text, selected custom field, selected product category.
// Slider is out of scope for now (user 2026-10-26). Other colors are
// hardcoded and must not change when the scheme changes.
//
// Ground truth from preview probes (2026-10-26): the scheme color shows
// up as the button BACKGROUND (white text on it), the active pagination
// page background (white text), the Clear Filters text, and the
// accent-color of filter option inputs. Unselected text is hardcoded
// dark gray (categories/product names rgb(34,34,34), filter option spans
// rgb(35,35,35), inactive pagination rgb(77,79,83)). The filter's
// selected state cannot be clicked in editor preview (the whole filter
// form is pointer-events:none), so it is verified through the computed
// accent-color instead. The category's selected state has no observable
// instance on the Products page, so it is verified through the
// stylesheet rule that paints it, if one exists.
import { savePage, openPreview } from '../editor.mjs';
import { TIMEOUT, previewSelector, checkReportText, readBackWithRetry } from './shared.mjs';
import { RAIL, openRailPanel, readSchemeColor, setSchemeColor, saveColorPanel, cancelColorPanel, normalizeColor } from './rail.mjs';
import { createFreshLifecycle } from '../fresh-settings-adapter.mjs';
import { registerFreshSettingsCapability } from '../setting-units.mjs';

const SUITE = 'capability:block-color-scheme';
export const freshSettings = registerFreshSettingsCapability('block-color-scheme', createFreshDefinitions);
const NAMES = {
  'bcs-state': '配色方案个数与当前值',
  'bcs-color-persist': '配色保存回读与恢复',
  'bcs-front-effect': '配色生效范围与写死颜色',
};
const SCHEME = '#1C4587';
const SCHEME_RGB = 'rgb(28, 69, 135)';
const ALT_COLOR = '#FF0000';
const ALT_RGB = 'rgb(255, 0, 0)';

export async function createFreshDefinitions(args) {
  const { canvas, config } = args;
  const lifecycle = args.lifecycle || createFreshLifecycle('right-rail-flyout', {
    open: () => openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel),
    read: () => readSchemeColor(canvas),
    apply: (value) => setSchemeColor(canvas, value),
    commit: () => saveColorPanel(canvas),
    cancel: () => cancelColorPanel(canvas),
  });
  const initial = args.initialValue ?? await (async () => {
    await lifecycle.open();
    try { return await lifecycle.read(); } finally { await lifecycle.cancel(); }
  })();
  if (typeof initial !== 'string') {
    const controls = initial?.controls || [];
    const notes = initial?.notes || [];
    const reason = `Color panel returned ${controls.length} independently inventoried control(s); no profile mapping uniquely identifies the existing scheme-color oracle.`;
    const evidence = { status: initial?.status || 'unresolved', controls: controls.map(({ identity, label, role, position, value, identifiable, inventoryNote }) =>
      ({ identity, label, role, position, value, identifiable, inventoryNote })), notes };
    return { settings: [], notAdaptedReason: reason, persistedControls: [], staticResults: [
      result('bcs-state', 'record', `${reason} Controls are retained in inventory evidence; no color setting was changed.`, evidence),
      result('bcs-color-persist', 'skip', reason, evidence),
      result('bcs-front-effect', 'skip', 'The existing scheme-color setting could not be identified uniquely; its front assertion was not run.', evidence),
    ] };
  }
  const setting = {
    id: 'bcs-color-persist', key: 'scheme-color', name: NAMES['bcs-color-persist'], lifecycle,
    initialValue: initial, originalValue: initial, value: ALT_COLOR, expected: ALT_COLOR,
    apply: () => lifecycle.apply(ALT_COLOR), restore: () => lifecycle.apply(initial),
    check: async () => {
      await lifecycle.open();
      try {
        const actual = await lifecycle.read();
        const pass = normalizeColor(actual) === normalizeColor(ALT_COLOR);
        return { status: pass ? 'pass' : 'fail', expected: ALT_COLOR, actual,
          detail: `原有配色持久化断言：改为 ${ALT_COLOR} 后保存重开应保持该值，实际 ${actual}。` };
      } finally { await lifecycle.cancel(); }
    },
  };
  return { settings: [setting], persistedControls: [{ region: 'right-rail-color', controlIndex: 0, type: 'text' }],
    staticResults: [result('bcs-state', 'record', `配色方案 ${initial ? 1 : 0} 个（设计稿只有配色 1），当前值 ${initial}。`, { count: initial ? 1 : 0, value: initial })] };
}


function result(id, status, detail, evidence, textFields = {}) {
  return { id, name: NAMES[id], status, detail, suite: SUITE,
    ...checkReportText(NAMES[id], status, detail, evidence, id), ...textFields,
    ...(evidence === undefined ? {} : { evidence }) };
}

// Snapshot the scheme's footprint in preview: the four observable scopes
// plus a sample of hardcoded colors that must not move.
async function snapshotScheme(frame, blockId) {
  const root = frame.locator(previewSelector(blockId)).first();
  await root.waitFor({ state: 'attached', timeout: TIMEOUT });
  return root.evaluate((wrap) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const cs = (el) => getComputedStyle(el);
    const btn = [...wrap.querySelectorAll('a.blocks-button, button')].find((el) => norm(el.innerText) === 'New Machine')
      || wrap.querySelector('.pf-btn-wrap a, .pf-btn-wrap button');
    const activePage = [...wrap.querySelectorAll('.pf-list-wrap *')].find((el) => el.children.length === 0
      && /^[0-9]+$/.test(norm(el.innerText)) && el.parentElement && /active/.test(el.parentElement.className));
    // The active page number's background may sit on the element itself
    // or on an ancestor: walk up to the first non-transparent background
    // (the parent alone read transparent in the 2026-10-26 probe).
    const bgOf = (el) => {
      let n = el;
      while (n && n !== wrap) {
        const bg = cs(n).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        n = n.parentElement;
      }
      return 'rgba(0, 0, 0, 0)';
    };
    const clear = wrap.querySelector('.pf-clear');
    const optInput = wrap.querySelector('.pf-field-body .pf-opt input');
    const optSpan = wrap.querySelector('.pf-field-body .pf-opt span');
    const cate = wrap.querySelector('.pf-cate-wrap a');
    const prodName = wrap.querySelector('.prodlist-pro-name');
    const inactivePage = [...wrap.querySelectorAll('.pf-list-wrap *')].find((el) => el.children.length === 0
      && /^[0-9]+$/.test(norm(el.innerText)) && !(el.parentElement && /active/.test(el.parentElement.className)));
    // Stylesheet rule that paints a selected category link, if any.
    let cateRule = null;
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; }
      if (!list) continue;
      for (const rule of list) {
        const sel = rule.selectorText || '';
        if (/pf-cate/i.test(sel) && /(active|selected|current)/i.test(sel) && /color/i.test(rule.style?.cssText || '')) {
          cateRule = { selector: sel.slice(0, 160), css: rule.style.cssText.slice(0, 200) };
          break;
        }
      }
      if (cateRule) break;
    }
    return {
      buttonBg: btn ? cs(btn).backgroundColor : null,
      buttonText: btn ? cs(btn).color : null,
      activePageBg: activePage ? bgOf(activePage) : null,
      activePageText: activePage ? cs(activePage).color : null,
      clearText: clear ? cs(clear).color : null,
      optAccent: optInput ? cs(optInput).accentColor : null,
      optSpan: optSpan ? cs(optSpan).color : null,
      cateText: cate ? cs(cate).color : null,
      prodName: prodName ? cs(prodName).color : null,
      inactivePage: inactivePage ? cs(inactivePage).color : null,
      cateRule,
    };
  });
}

async function withPreview(page, context, fn) {
  const before = new Set(context.pages());
  try {
    await savePage(page);
    const preview = await openPreview(page, context);
    return await fn(preview.frame);
  } finally {
    for (const tab of context.pages().filter((tab) => !before.has(tab) && tab !== page)) {
      try { if (!tab.isClosed()) await tab.close(); } catch {}
    }
  }
}

export async function runSettingsLayer({ page, canvas, context, config }) {
  const checks = [];
  let initial;
  try {
    await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
    initial = await readSchemeColor(canvas);
  } catch (error) {
    return Object.keys(NAMES).map((id) => result(id, 'skip', `无法打开配色浮层：${error.message}`));
  }
  const count = await canvas.locator(`${RAIL.colorPanel}:visible ${RAIL.colorInput}`).count()
    .catch(() => 0);
  if (typeof initial !== 'string') {
    const reason = `配色浮层中有 ${initial?.controls?.length || 0} 个颜色控件，未能唯一确认既有配色方案设置；已逐项记录，跳过需要映射到单一方案的检查。`;
    const notes = [...(initial?.notes || [])];
    try { await cancelColorPanel(canvas); } catch (error) { notes.push(`无法关闭配色浮层：${error.message}`); }
    const evidence = { controls: initial?.controls || [], notes };
    checks.push(result('bcs-state', 'record', reason, evidence),
      result('bcs-color-persist', 'skip', reason, evidence),
      result('bcs-front-effect', 'skip', '配色设置未能唯一识别，未运行其前台断言。', evidence));
    return checks;
  }
  checks.push(result('bcs-state',
    normalizeColor(initial) === normalizeColor(SCHEME) ? 'record' : 'fail',
    `配色方案 ${count} 个（设计稿只有配色 1），当前值 ${initial}。`,
    { count, value: initial }));

  if (config.deferFront) {
    checks.push(result('bcs-color-persist', 'deferred', 'deferred-to-front-runner'),
      result('bcs-front-effect', 'deferred', 'deferred-to-front-runner'));
    return checks;
  }

  if (!context) {
    checks.push(...['bcs-color-persist', 'bcs-front-effect']
      .map((id) => result(id, 'skip', '未提供浏览器 context，无法打开临时预览。')));
    return checks;
  }

  // Baseline snapshot at the original scheme, then one flip cycle:
  // red → save → reopen verify → preview snapshot → restore → save →
  // reopen verify → preview snapshot (must equal baseline).
  const persistErrors = [];
  const effectErrors = [];
  const unmeasuredScopes = [];
  const evidence = { initial, alt: null, restored: null, base: null, altShot: null, restoredShot: null };
  const readBack = async () => {
    await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
    return readSchemeColor(canvas);
  };
  const ready = () => openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
  try {
    evidence.base = await withPreview(page, context,
      (frame) => snapshotScheme(frame, config.blockId));
  } catch (error) {
    checks.push(result('bcs-color-persist', 'skip', `基线预览快照失败：${error.message}`),
      result('bcs-front-effect', 'skip', `基线预览快照失败：${error.message}`));
    return checks;
  }
  try {
    await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
    await setSchemeColor(canvas, ALT_COLOR);
    await saveColorPanel(canvas);
    evidence.alt = await readBackWithRetry(readBack,
      (value) => normalizeColor(value) === normalizeColor(ALT_COLOR), ready);
    if (normalizeColor(evidence.alt) !== normalizeColor(ALT_COLOR)) {
      persistErrors.push(`改 ${ALT_COLOR} 保存重开后配色为 ${evidence.alt}，不是 ${ALT_COLOR}`);
    } else {
      evidence.altShot = await withPreview(page, context,
        (frame) => snapshotScheme(frame, config.blockId));
      const scope = [
        ['按钮背景', evidence.altShot.buttonBg, ALT_RGB],
        ['分页当前页背景', evidence.altShot.activePageBg, ALT_RGB],
        ['Clear Filters 文字', evidence.altShot.clearText, ALT_RGB],
        ['筛选选项 accent-color', evidence.altShot.optAccent, ALT_RGB],
      ];
      // A scope whose element is absent (e.g. pagination off, no filter
      // fields enabled) is unmeasurable, not a failure: there is nothing
      // to tint. Record it and check the scopes that exist.
      for (const [name, actual, expected] of scope) {
        if (actual == null) { unmeasuredScopes.push(name); continue; }
        if (actual !== expected) effectErrors.push(`${name}改配色后为 ${actual}，不是 ${expected}`);
      }
      const hardcoded = [
        ['按钮文字', evidence.altShot.buttonText, evidence.base.buttonText],
        ['筛选未选文字', evidence.altShot.optSpan, evidence.base.optSpan],
        ['分类未选文字', evidence.altShot.cateText, evidence.base.cateText],
        ['产品名', evidence.altShot.prodName, evidence.base.prodName],
        ['分页非当前页', evidence.altShot.inactivePage, evidence.base.inactivePage],
      ];
      for (const [name, actual, before] of hardcoded) {
        if (actual !== before) effectErrors.push(`写死颜色变化：${name}由 ${before} 变为 ${actual}`);
      }
      if (evidence.altShot.cateRule && !evidence.altShot.cateRule.css.includes('28, 69, 135')
        && !evidence.altShot.cateRule.css.includes('#1c4587')) {
        effectErrors.push(`分类选中态样式规则未用配色：${evidence.altShot.cateRule.css}`);
      }
    }
  } catch (error) {
    persistErrors.push(`改 ${ALT_COLOR} 失败：${error.message}`);
  } finally {
    try {
      const current = await readBack().catch(() => null);
      if (normalizeColor(current) !== normalizeColor(initial)) {
        await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
        await setSchemeColor(canvas, initial);
        await saveColorPanel(canvas);
      }
      evidence.restored = await readBackWithRetry(readBack,
        (value) => normalizeColor(value) === normalizeColor(initial), ready);
      if (normalizeColor(evidence.restored) !== normalizeColor(initial)) {
        persistErrors.push(`恢复后配色为 ${evidence.restored}，不是 ${initial}`);
      } else {
        evidence.restoredShot = await withPreview(page, context,
          (frame) => snapshotScheme(frame, config.blockId));
        for (const key of ['buttonBg', 'buttonText', 'activePageBg', 'clearText', 'optAccent']) {
          if (evidence.restoredShot[key] !== evidence.base[key]) {
            effectErrors.push(`恢复后 ${key} 为 ${evidence.restoredShot[key]}，基线是 ${evidence.base[key]}`);
          }
        }
      }
    } catch (error) {
      persistErrors.push(`恢复原配色失败：${error.message}`);
    }
  }
  checks.push(result('bcs-color-persist',
    persistErrors.length ? 'fail' : 'pass',
    persistErrors.length ? persistErrors.join('；') : `原配色为 ${initial}，临时改为 ${ALT_COLOR} 后保存重开回读成功，恢复并保存后仍为 ${initial}。`,
    evidence, { expected: `配色临时改为 ${ALT_COLOR} 后保存重开应保持该颜色；恢复并保存后应回到 ${initial}。` }));
  const allUnmeasured = evidence.altShot && unmeasuredScopes.length === 4;
  const unmeasuredNote = unmeasuredScopes.length
    ? `未量到（该区块未启用对应功能）：${unmeasuredScopes.join('、')}。` : '';
  checks.push(result('bcs-front-effect',
    effectErrors.length ? 'fail' : (evidence.altShot ? (allUnmeasured ? 'skip' : 'pass') : 'skip'),
    effectErrors.length ? effectErrors.join('；')
      : evidence.altShot
        ? allUnmeasured
          ? `改配色后没有可量到的生效范围：${unmeasuredScopes.join('、')}。`
          : `改配色后按钮背景、分页当前页背景、Clear Filters 文字、筛选 accent-color 均跟随新配色，5 处写死颜色未变；恢复后与基线一致。${evidence.altShot.cateRule ? '分类选中态有样式规则。' : '分类选中态在编辑器预览里无可观察实例、未找到对应样式规则，只记录。'}${unmeasuredNote}`
        : '改配色后未取到前台快照。',
    { base: evidence.base, altShot: evidence.altShot, restoredShot: evidence.restoredShot },
    { expected: `临时改为 ${ALT_COLOR} 后，按钮背景、分页当前页背景、Clear Filters 文字和已启用的筛选强调色应跟随新配色；恢复后应与修改前一致。` }));
  return checks;
}

export async function runFrontLayer() {
  // The color effect is verified inside the settings layer (it needs the
  // canvas to flip the scheme). No separate front-layer check: check ids
  // must be unique across layers.
  return [];
}
