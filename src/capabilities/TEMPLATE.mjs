import { widgetSession, probeControls, persistControl, radioPersist, radioGroupPersist, previewSelector, TIMEOUT } from './shared.mjs';

// 新能力模块模板。照着它实现，不要从零写弹窗、快照与持久化闭环。
// 1. 把下面三处占位换成真实值：SUITE、弹窗 type 与 title、检查 ID 与名称。
// 2. 设置层用 shared.mjs 的 persistControl / radioPersist；效果层只断关键结果。
// 3. 定位不唯一、控件不可切换、没有可切换的值时，返回 skip，不硬做。
// 4. 每个场景后必须恢复原状。persistControl 已经做了恢复与页面保存，不要绕过它。
// 5. 在 src/run.mjs 的 capabilityRegistry 里登记这个模块，画像里声明 id 才能跑起来。

const SUITE = 'capability:<capability-id>';
const NAMES = {
  '<id>-settings-state': '<设置项当前值>',
  '<id>-persist': '<设置项保存回读与恢复>',
  '<id>-front': '<设置项前台效果>',
};

function result(id, status, detail, evidence) {
  return {
    id, name: NAMES[id], suite: SUITE, status, detail,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

export async function runSettingsLayer({ page, canvas, context, config }) {
  const session = widgetSession({
    page, canvas, config,
    type: '<data-blockseditor-type，例如 phoenix_blocks_filterStyle>',
    title: '<设置弹窗标题，例如 设置自定义字段筛选>',
  });
  const checks = [];
  try {
    const initial = await probeControls(session);
    if (initial.reason) {
      return Object.keys(NAMES).map((id) => result(id, 'skip', `无法打开设置弹窗：${initial.reason}`));
    }
    // 先记录当前值，再挑一个可切换的控件做闭环。
    // 定位规则：用 label / name / value 组合定位，不要只靠序号。
    // const target = initial.controls.find((item) => <条件>);
    // checks.push(result('<id>-settings-state', 'record', '<当前值>', initial.controls));
    // checks.push(result('<id>-persist', (await persistControl({ session, page, target, alternate: <新值> })).status, '...'));
    return checks;
  } finally {
    try { await session.cancel(); } catch (error) {
      const last = checks.at(-1);
      if (last) { last.status = 'fail'; last.detail += `；最终取消失败：${error.message}`; }
    }
  }
}

export async function runFrontLayer({ frame, config }) {
  // 只断关键结果。前台观察不到时，返回 record，不要冒充 pass。
  // const root = frame.locator(previewSelector(config.blockId)).first();
  // previewSelector 是 .siteblocks-setting-wrap[data-appid]，不要用 LA 类名：有的区块预览里没有 LA 类。
  // await root.waitFor({ state: 'attached', timeout: TIMEOUT });
  return [result('<id>-front', 'record', '前台效果待按 Figma 或业务规则确认，未做硬断言。')];
}
