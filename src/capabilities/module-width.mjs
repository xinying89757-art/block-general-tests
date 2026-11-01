import { effectCheck, unavailable } from './effect-checks.mjs';
import { waitForStable } from '../ui-waits.mjs';
// Module width (模块宽度): the block-level width setting in the right
// icon rail (模块展开 → .moduleWidth flyout). Radios 1200/1440/1600/1920/
// 全屏/自定义（≥1200px). The design default is 1440px, stored as
// 自定义 1440 — not as the 1440px preset — so the effective value is what
// is asserted, not which radio is checked. The globalApply checkbox is
// never touched: it would apply the width to other modules.
import { savePage, openPreview } from '../editor.mjs';
import { TIMEOUT, previewSelector, checkReportText, readBackWithRetry } from './shared.mjs';
import { RAIL, openRailPanel, readModuleWidth, setModuleWidth, saveWidthPanel, cancelWidthPanel } from './rail.mjs';
import { createFreshLifecycle } from '../fresh-settings-adapter.mjs';
import { registerFreshSettingsCapability } from '../setting-units.mjs';

const SUITE = 'capability:module-width';
export const freshSettings = registerFreshSettingsCapability('module-width', createFreshDefinitions);
const NAMES = {
  'mw-state': '模块宽度当前值',
  'mw-width-persist': '模块宽度保存回读与恢复',
  'mw-front-width': '改宽度后前台容器宽度生效',
};
const ALT_WIDTH = '1200px';
const BASE_WIDTH = 1440;

export function moduleWidthPersistedControls(initial, testedValue = { preset: ALT_WIDTH }) {
  const controls = (initial?.radios || []).map((_, index) => ({ region: 'right-rail-width', controlIndex: index, type: 'radio' }));
  // The custom-width input is active only when the tested selection is
  // custom. A preset test asserts the selected/effective preset; after reload
  // the editor clears the inactive custom input, so comparing its stale value
  // would add a persistence assertion that the existing oracle never made.
  if (testedValue?.custom !== undefined) {
    controls.push({ region: 'right-rail-width', controlIndex: (initial?.radios || []).length, type: 'text' });
  }
  controls.push({ region: 'right-rail-width', controlIndex: (initial?.radios || []).length + 1, type: 'checkbox' });
  return controls;
}

export async function createFreshDefinitions(args) {
  const { canvas, config } = args;
  const lifecycle = args.lifecycle || createFreshLifecycle('right-rail-flyout', {
    open: () => openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel),
    read: () => readModuleWidth(canvas),
    apply: (value) => setModuleWidth(canvas, value),
    commit: () => saveWidthPanel(canvas),
    cancel: () => cancelWidthPanel(canvas),
  });
  const initial = args.initialValue ?? await (async () => {
    await lifecycle.open();
    try { return await lifecycle.read(); } finally { await lifecycle.cancel(); }
  })();
  if (!initial?.checked || initial.effective === null || initial.globalApply === null) {
    return { settings: [], persistedControls: [], staticResults: [result('mw-state', 'skip', '模块宽度复合状态不完整，未写入。')],
      notAdaptedReason: 'The right-rail width snapshot did not uniquely expose the selected width and global-apply state.' };
  }
  const value = { preset: ALT_WIDTH };
  const setting = { id: 'mw-width-persist', key: 'module-width', name: NAMES['mw-width-persist'], lifecycle,
    initialValue: initial, originalValue: initial.effective, value: ALT_WIDTH, expected: ALT_WIDTH,
    apply: () => lifecycle.apply(value),
    restore: async () => {
      if (initial.customVal && Number(initial.customVal) >= 1200) await lifecycle.apply({ custom: initial.customVal });
      if (initial.checked.value !== '-1') await lifecycle.apply({ preset: initial.checked.label });
    },
    check: async () => {
      await lifecycle.open();
      try {
        const actual = await lifecycle.read();
        const pass = actual.effective === Number.parseInt(ALT_WIDTH, 10);
        return { status: pass ? 'pass' : 'fail', expected: ALT_WIDTH, actual,
          detail: `原有模块宽度持久化断言：切换至 ${ALT_WIDTH} 保存重开后生效宽度应为 ${ALT_WIDTH}，实际 ${actual.effective}px；全局应用保持 ${actual.globalApply}。` };
      } finally { await lifecycle.cancel(); }
    } };
  return { settings: [setting], persistedControls: moduleWidthPersistedControls(initial, value),
    staticResults: [result('mw-state', 'record',
      `当前宽度选项=${initial.checked.label}，生效宽度=${initial.effective}px；全局应用未勾选。`, initial)] };
}

function result(id, status, detail, evidence, textFields = {}) {
  return { id, name: NAMES[id], status, detail, suite: SUITE,
    ...checkReportText(NAMES[id], status, detail, evidence, id), ...textFields,
    ...(evidence === undefined ? {} : { evidence }) };
}

// Measure the width the block actually renders at in preview: the
// computed max-width of the width shell inside the block wrap
// (div.hasDefaultWidth.container — the platform width shell; the wrap
// itself is full viewport width). The editor canvas is only ~1525px wide,
// so a bounding-box measurement cannot distinguish 1600/1920 presets;
// the computed max-width can.
async function measureWidth(frame, blockId) {
  const root = frame.locator(previewSelector(blockId)).first();
  await root.waitFor({ state: 'attached', timeout: TIMEOUT });
  return root.evaluate((wrap) => {
    const cs = (el) => getComputedStyle(el);
    const shell = wrap.querySelector('.hasDefaultWidth') || wrap.querySelector('div.container');
    const wrapRect = wrap.getBoundingClientRect();
    return {
      maxWidth: shell ? cs(shell).maxWidth : null,
      shellWidth: shell ? Math.round(shell.getBoundingClientRect().width) : null,
      shellCls: shell ? String(shell.className).slice(0, 100) : null,
      wrapWidth: Math.round(wrapRect.width),
      viewportWidth: document.documentElement.clientWidth,
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

export async function runSettingsLayer({ page, canvas, context, config, capability }) {
  const checks = [];
  let panel;
  try {
    ({ panel } = await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel));
  } catch (error) {
    return ['mw-state', 'mw-width-persist', 'mw-front-width', 'mw-width-front'].map((id) => result(id, 'skip', `无法打开模块宽度浮层：${error.message}`));
  }
  const initial = await readModuleWidth(canvas);
  const initialEffective = initial.effective;
  checks.push(result('mw-state',
    initial.checked && initialEffective !== null ? 'record' : 'fail',
    initial.checked
      ? `当前宽度=${initial.checked.label}${initial.checked.value === '-1' ? `（自定义值 ${initial.customVal}）` : ''}，生效宽度=${initialEffective === 'fullscreen' ? '全屏' : `${initialEffective}px`}；全局应用未勾选。`
      : '没有选中的宽度选项，当前宽度状态异常。',
    initial));

  if (config.deferFront) {
    checks.push(result('mw-width-persist', 'deferred', 'deferred-to-front-runner'),
      result('mw-front-width', 'deferred', 'deferred-to-front-runner'),
      await widthEffect({ page, canvas, context, config, capability }, 'front'));
    await cancelWidthPanel(canvas).catch(() => {});
    return checks;
  }

  // One flip cycle serves both the persistence check and the effect check:
  // 1200px → save → reopen verify → preview measure → restore 自定义 1440
  // → save → reopen verify → preview measure.
  const persistErrors = [];
  const effectErrors = [];
  const evidence = { initial, alt: null, restored: null, measureAlt: null, measureRestored: null };
  const readBack = async () => {
    await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
    return readModuleWidth(canvas);
  };
  const ready = () => openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
  try {
    await setModuleWidth(canvas, { preset: ALT_WIDTH });
    await saveWidthPanel(canvas);
    evidence.alt = await readBackWithRetry(readBack, (value) => value.effective === 1200, ready);
    if (evidence.alt.effective !== 1200) {
      persistErrors.push(`改 1200px 保存重开后生效宽度为 ${JSON.stringify(evidence.alt.effective)}，不是 1200`);
    } else if (context) {
      evidence.measureAlt = await withPreview(page, context,
        (frame) => measureWidth(frame, config.blockId));
      if (evidence.measureAlt.maxWidth !== '1200px') {
        effectErrors.push(`改 1200px 后前台容器 max-width 为 ${evidence.measureAlt.maxWidth}，不是 1200px`);
      }
    }
  } catch (error) {
    persistErrors.push(`改 1200px 失败：${error.message}`);
  } finally {
    // Restore the original width no matter what the flip did.
    try {
      const current = await readModuleWidth(canvas).catch(() => null);
      const needsRestore = !current || current.effective !== initialEffective;
      if (needsRestore) {
        await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
        if (initial.checked?.value === '-1') {
          await setModuleWidth(canvas, { custom: initial.customVal });
        } else if (initial.checked) {
          await setModuleWidth(canvas, { preset: initial.checked.label });
        }
        await saveWidthPanel(canvas);
      }
      evidence.restored = await readBackWithRetry(readBack,
        (value) => value.effective === initialEffective, ready);
      if (evidence.restored.effective !== initialEffective) {
        persistErrors.push(`恢复后生效宽度为 ${JSON.stringify(evidence.restored.effective)}，不是 ${initialEffective}`);
      } else if (context && evidence.measureAlt) {
        evidence.measureRestored = await withPreview(page, context,
          (frame) => measureWidth(frame, config.blockId));
        const expected = initialEffective === 'fullscreen' ? 'none' : `${initialEffective}px`;
        if (evidence.measureRestored.maxWidth !== expected) {
          effectErrors.push(`恢复后前台容器 max-width 为 ${evidence.measureRestored.maxWidth}，不是 ${expected}`);
        }
      }
    } catch (error) {
      persistErrors.push(`恢复原宽度失败：${error.message}`);
    }
  }
  checks.push(result('mw-width-persist',
    persistErrors.length ? 'fail' : 'pass',
    persistErrors.length ? persistErrors.join('；') : `切换为 1200px 后保存重开回读成功，恢复自定义宽度 ${BASE_WIDTH}px 后再次保存重开回读成功。`,
    evidence, { expected: `切换为 1200px 后保存重开应保持 1200px；恢复后应回到 ${initialEffective === 'fullscreen' ? '全屏' : `${initialEffective}px`}。` }));
  checks.push(result('mw-front-width',
    effectErrors.length ? 'fail' : (evidence.measureAlt ? 'pass' : 'skip'),
    effectErrors.length ? effectErrors.join('；')
      : evidence.measureAlt
        ? `改为 1200px 后前台容器最大宽度为 1200px，恢复后最大宽度为 ${evidence.measureRestored?.maxWidth}；只核对最大宽度，实际显示宽度受预览视口限制。`
        : '宽度翻转未完成，未能量取预览效果。',
    { measureAlt: evidence.measureAlt, measureRestored: evidence.measureRestored },
    { expected: `切换为 1200px 后前台容器最大宽度应为 1200px，恢复后应为 ${initialEffective === 'fullscreen' ? '无限制' : `${initialEffective}px`}。` }));
  checks.push(await widthEffect({ page, canvas, context, config, capability }, 'front'));
  return checks;
}

export async function runFrontLayer() {
  // The width effect is verified inside the settings layer (it needs the
  // canvas to flip the width). No separate front-layer check: check ids
  // must be unique across layers.
  return [];
}

Object.assign(NAMES, {
  'mw-width-backend': '画布模块宽度全部选项生效',
  'mw-width-front': '预览模块宽度其余选项生效',
});
async function widthEffect(args, layer) {
  const session = {
    open: () => openRailPanel(args.canvas, args.config.blockId, RAIL.widthIcon, RAIL.widthPanel),
    cancel: async () => {
      if (await args.canvas.locator(`${RAIL.widthPanel}:visible`).count()) await cancelWidthPanel(args.canvas);
    },
  };
  return effectCheck({ ...args, session, result, id: `mw-width-${layer}`, layer, run: async (tx) => {
    await session.open();
    const initial = await readModuleWidth(args.canvas);
    if (!initial.checked || initial.effective === null) unavailable('无法读取原模块宽度，未改写。');
    const presets = layer === 'backend' ? [1200, 1440, 1600, 1920] : [1440, 1600, 1920];
    const cases = [...presets.map((value) => ({ preset: `${value}px`, expected: `${value}px`, label: `${value} 像素预设` })),
      { preset: '全屏', expected: 'none', label: '全屏' }, { custom: '1300', expected: '1300px', label: '自定义 1300 像素' }];
    tx.expected(cases.map((item) => `${item.label}的容器最大宽度应为${item.expected === 'none' ? '无限制' : item.expected}`).join('；') + '。');
    tx.remember('module-width', async () => {
      // Restore the dormant custom input as well as the selected preset.
      if (initial.customVal && Number(initial.customVal) >= 1200) await setModuleWidth(args.canvas, { custom: initial.customVal });
      if (initial.checked.value !== '-1') await setModuleWidth(args.canvas, { preset: initial.checked.label });
      await saveWidthPanel(args.canvas);
      await session.open();
      const restored = await readModuleWidth(args.canvas);
      tx.evidence.restoredWidth = restored;
      if (restored.effective !== initial.effective || restored.checked?.value !== initial.checked.value
        || restored.customVal !== initial.customVal || restored.globalApply !== initial.globalApply) throw new Error('模块宽度或自定义值未恢复');
    });
    for (const item of cases) {
      await session.open();
      await setModuleWidth(args.canvas, item); await saveWidthPanel(args.canvas);
      await session.cancel(); await savePage(args.page);
      const measured = layer === 'backend'
        ? await waitForStable(() => measureWidth(args.canvas, args.config.blockId))
        : await tx.observe((frame) => waitForStable(() => measureWidth(frame, args.config.blockId)));
      if (measured.maxWidth === null) unavailable('该层没有可识别的模块宽度容器，需实站核实。');
      (tx.evidence.widths ||= []).push({ setting: item.label, expected: item.expected, actual: measured });
      tx.assert(measured.maxWidth === item.expected,
        `${item.label}时，容器最大宽度实际为${measured.maxWidth === 'none' ? '无限制' : measured.maxWidth}，应为${item.expected === 'none' ? '无限制' : item.expected}；实际显示宽度受画布或预览视口限制。`);
    }
  } });
}
export async function runBackendLayer(args) { return [await widthEffect(args, 'backend')]; }
