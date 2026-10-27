// Module width (模块宽度): the block-level width setting in the right
// icon rail (模块展开 → .moduleWidth flyout). Radios 1200/1440/1600/1920/
// 全屏/自定义（≥1200px). The design default is 1440px, stored as
// 自定义 1440 — not as the 1440px preset — so the effective value is what
// is asserted, not which radio is checked. The globalApply checkbox is
// never touched: it would apply the width to other modules.
import { savePage, openPreview } from '../editor.mjs';
import { TIMEOUT, previewSelector } from './shared.mjs';
import { RAIL, openRailPanel, readModuleWidth, setModuleWidth, saveWidthPanel } from './rail.mjs';

const SUITE = 'capability:module-width';
const NAMES = {
  'mw-state': '模块宽度当前值',
  'mw-width-persist': '模块宽度保存回读与恢复',
  'mw-front-width': '改宽度后前台容器宽度生效',
};
const ALT_WIDTH = '1200px';
const BASE_WIDTH = 1440;

function result(id, status, detail, evidence) {
  return { id, name: NAMES[id], status, detail, suite: SUITE,
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

export async function runSettingsLayer({ page, canvas, context, config }) {
  const checks = [];
  let panel;
  try {
    ({ panel } = await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel));
  } catch (error) {
    return Object.keys(NAMES).map((id) => result(id, 'skip', `无法打开模块宽度浮层：${error.message}`));
  }
  const initial = await readModuleWidth(canvas);
  const initialEffective = initial.effective;
  checks.push(result('mw-state',
    initial.checked && initialEffective !== null ? 'record' : 'fail',
    initial.checked
      ? `当前宽度=${initial.checked.label}${initial.checked.value === '-1' ? `（自定义值 ${initial.customVal}）` : ''}，生效宽度=${initialEffective === 'fullscreen' ? '全屏' : `${initialEffective}px`}；全局应用未勾选。`
      : '没有选中的宽度选项，当前宽度状态异常。',
    initial));

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
  try {
    await setModuleWidth(canvas, { preset: ALT_WIDTH });
    await saveWidthPanel(canvas);
    evidence.alt = await readBack();
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
      evidence.restored = await readBack();
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
    persistErrors.length ? persistErrors.join('；') : `1200px → 保存重开回读 → 恢复自定义 ${BASE_WIDTH} → 保存重开回读均完成。`,
    evidence));
  checks.push(result('mw-front-width',
    effectErrors.length ? 'fail' : (evidence.measureAlt ? 'pass' : 'skip'),
    effectErrors.length ? effectErrors.join('；')
      : evidence.measureAlt
        ? `改 1200px 后前台容器 max-width=1200px，恢复后=${evidence.measureRestored?.maxWidth}；实测宽度见 evidence（受预览视口限制，只断言 max-width）。`
        : '宽度翻转未完成，未能量取预览效果。',
    { measureAlt: evidence.measureAlt, measureRestored: evidence.measureRestored }));
  return checks;
}

export async function runFrontLayer() {
  // The width effect is verified inside the settings layer (it needs the
  // canvas to flip the width). No separate front-layer check: check ids
  // must be unique across layers.
  return [];
}
