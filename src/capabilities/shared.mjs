import { savePage } from '../editor.mjs';
import { waitForControlsReady, retryTransient, saveAndWait, readBackWithRetry, uiWaitConfig, waitForDialogState } from '../ui-waits.mjs';
export { readBackWithRetry } from '../ui-waits.mjs';

export const TIMEOUT = 10_000;
export function baselineRestoreTarget({ snapshot, baselineValue, defaultValue }) {
  if (baselineValue !== undefined && baselineValue !== null) return { value: baselineValue, source: 'baseline' };
  if (typeof snapshot === 'string' && /^AUTOTEST-/i.test(snapshot)) return { value: defaultValue, source: 'default-after-autotest-snapshot' };
  return { value: snapshot, source: 'snapshot' };
}
// Bare numeric IDs identify fields; e.g. 826554_1 identifies a value option.
export const isFieldCheckbox = (item) => item.type === 'checkbox'
  && /^\d+$/.test(item.value || '') && item.label !== '全选';
export const blockSelector = (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`;
// Preview root: the data-appid wrap exists for every block. The LA class
// (e.g. LA样本区块) is block-specific: 另一样本区块 has no LA class in preview, so
// relying on it fails the front layer for blocks that never had one.
export const previewSelector = (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`;

// Human-readable report fields are generated at the point each check is built.
// Keep raw evidence separately for debugging; the HTML uses evidenceText only.
const reportName = (name) => String(name || '检查项').replace(/\s*\boracle\b\s*/gi, '后台');
function cleanReportSentence(value) {
  return String(value || '').trim()
    .replace(/\s*→\s*/g, '，改为')
    .replace(/\bfontSize\b/g, '字号').replace(/\blineHeight\b/g, '行高')
    .replace(/\bbackgroundColor\b/g, '背景色').replace(/\bborderColor\b/g, '边框色')
    .replace(/\bborderRadius\b/g, '圆角').replace(/\bfontWeight\b/g, '字重')
    .replace(/\btextAlign\b/g, '对齐方式').replace(/\bletterSpacing\b/g, '字距')
    .replace(/\bwidth\b/g, '宽').replace(/\bheight\b/g, '高')
    .replace(/font-family/g, '字体声明').replace(/word-break:\s*break-word/g, '断词声明')
    .replace(/pointer-events:\s*none/g, '当前不可交互').replace(/max-width/g, '最大宽度')
    .replace(/accent-color/g, '强调色')
    .replace(/buttonBg/g, '按钮背景').replace(/buttonText/g, '按钮文字颜色')
    .replace(/activePageBg/g, '当前页背景').replace(/activePageText/g, '当前页文字颜色')
    .replace(/clearText/g, '清除按钮文字颜色').replace(/optAccent/g, '筛选强调色')
    .replace(/optSpan/g, '筛选未选文字颜色').replace(/cateText/g, '分类文字颜色')
    .replace(/prodName/g, '产品名称颜色').replace(/inactivePage/g, '非当前页颜色')
    .replace(/maxWidth/g, '最大宽度')
    .replace(/([\u3400-\u9fffA-Za-z0-9_-]+)=([^；，。]+)/g, '$1为$2')
    .replace(/\bnull\b/g, '未取到').replace(/\bundefined\b/g, '未取到')
    .replace(/\{[^{}]*\}/g, '（详细结构保留在原始证据中）')
    .replace(/([^。！？])$/, '$1。');
}
function persistenceExpected(id, evidence) {
  if (!evidence || evidence.original === undefined || evidence.alternate === undefined) return '';
  const control = String(evidence.control || '该控件').trim();
  const original = evidence.original;
  const alternate = evidence.alternate;
  if (evidence.alternateLabel) {
    return `将选项由“${evidence.originalLabel || control}”切换为“${evidence.alternateLabel}”后保存，重新打开应仍选中“${evidence.alternateLabel}”；恢复后应重新选中“${evidence.originalLabel || control}”。`;
  }
  const booleanControl = typeof original === 'boolean' && typeof alternate === 'boolean';
  const yesNo = /是|否/.test(control);
  const from = booleanControl ? (yesNo ? (original ? '是' : '否') : (original ? '勾选' : '未勾选')) : String(original);
  const to = booleanControl ? (yesNo ? (alternate ? '是' : '否') : (alternate ? '勾选' : '未勾选')) : String(alternate);
  return `将${control}由“${from}”改为“${to}”后保存，重新打开应仍为“${to}”；恢复后应回到“${from}”。`;
}
const EXPECTED = {
  'btn-text-backend': '保存测试文字后，画布中唯一的目标按钮应显示刚设置的完整文字。',
  'btn-text-front': '保存测试文字后，临时预览中唯一的目标按钮应显示刚设置的完整文字。',
  'btn-url-backend': '画布目标按钮的真实链接应为百度 https://www.baidu.com，打开方式应保持设置值。',
  'btn-url-front': '临时预览目标按钮的真实地址或点击落地地址应为百度 https://www.baidu.com。',
  'btn-target-backend': '目标按钮在取消新窗口时应使用当前页打开方式，勾选时应使用新窗口打开方式，地址应均为百度。',
  'btn-target-front': '百度按钮取消新窗口时应在当前页打开，勾选时应新开页面；脚本按钮应点击核实地址及页面数量。',
  'pcs-mode-backend': '画布在所有模式下应显示设置清单的全部分类；部分模式下应恰好显示所选的完整分类集合。',
  'pcs-mode-front': '预览在所有模式下应显示设置清单的全部分类；部分模式下应恰好显示所选的完整分类集合。',
  'pcs-categories-backend': '画布分类导航应与本次勾选的完整名称清单逐项一致，不得多出或缺少分类。',
  'pcs-categories-front': '预览分类导航应与本次勾选的完整名称清单逐项一致，不得多出或缺少分类。',
  'cff-fields-backend': '画布自定义筛选组应恰好包含本次勾选的全部字段，不得多出或缺少字段。',
  'cff-fields-front': '预览自定义筛选组应恰好包含本次勾选的全部字段，不得多出或缺少字段。',
  'cff-logic-front': '交集与并集应分别等于夹具真值表计算的产品集合。',
  'cff-trigger-front': '手动模式选值后应保持原产品集合，点搜索后应显示夹具结果；自动模式不点搜索也应显示同一夹具结果。',
  'cff-scope-front': '当前分类与所有产品两种范围的筛选结果应分别等于各自独立夹具中的完整产品名单。',
  'cff-jump-front': '选择另一筛选后跳转页并执行筛选后，临时预览应进入所选页面对应的已确认地址。',
  'cff-background-backend': '画布筛选区域的背景色应等于本次设置的红绿蓝数值，恢复后应回到原颜色。',
  'cff-background-front': '预览筛选区域的背景色应等于本次设置的红绿蓝数值，恢复后应回到原颜色。',
  'pld-fields-backend': '画布每张产品卡应恰好展示本次勾选的完整字段集合，不能多出或缺少字段。',
  'pld-fields-front': '预览每张产品卡应恰好展示本次勾选的完整字段集合，不能多出或缺少字段。',
  'pld-source-category-backend': '来源只选夹具分类后，画布列表应显示夹具计算的上架产品集合。',
  'pld-size-backend': '画布产品数应等于新设置的数量与可用产品数量中的较小值，并记录具体数量及完整产品名。',
  'pld-size-front': '预览产品数应等于新设置的数量与可用产品数量中的较小值，并记录具体数量及完整产品名。',
  'pld-pagination-backend': '有至少两件可用产品、每页设为一件时，画布分页选是应显示分页条，选否应隐藏分页条。',
  'pld-pagination-front': '有至少两件可用产品、每页设为一件时，预览分页选是应显示分页条，选否应隐藏分页条。',
  'pld-compare-backend': '关闭产品对比时画布每张产品卡都应没有对比入口，开启时每张产品卡都应有入口。',
  'pld-compare-off-front': '关闭产品对比后，预览所有产品卡都应没有对比入口。',
  'mw-width-backend': '画布依次设置 1200、1440、1600、1920 像素预设及自定义 1300 像素时，容器最大宽度应等于设置值；全屏时应无限制。',
  'mw-width-front': '预览依次设置 1440、1600、1920 像素预设及自定义 1300 像素时，容器最大宽度应等于设置值；全屏时应无限制。',
  'pld-source-all-backend': '来源设为“所有产品”后，画布应包含全部 3 件 AUTOTEST 产品，且可见数量符合分页/每页或总数量设置；站点其他产品不参与精确名单比较。缺少夹具时跳过并说明原因。',
  'pld-source-all-front': '来源设为“所有产品”后，预览应包含全部 3 件 AUTOTEST 产品，且可见数量符合分页/每页或总数量设置；站点其他产品不参与精确名单比较。缺少夹具时跳过并说明原因。',
  'pld-source-filter-backend': '来源设为“使用筛选条件”后，画布完整产品名单应与该来源的独立夹具逐项一致；缺少夹具时跳过并说明原因。',
  'pld-source-filter-front': '来源设为“使用筛选条件”后，预览完整产品名单应与该来源的独立夹具逐项一致；缺少夹具时跳过并说明原因。',
  'pld-source-products-backend': '来源设为“选择指定产品”后，画布完整产品名单应与该来源的独立夹具逐项一致；缺少夹具时跳过并说明原因。',
  'pld-source-products-front': '来源设为“选择指定产品”后，预览完整产品名单应与该来源的独立夹具逐项一致；缺少夹具时跳过并说明原因。',

  'block-present': '预览内容中应存在目标区块容器。',
  'img-alt': '区块内每张图片都应带有 alt 属性。',
  'link-href': '区块内每个链接都应带有 href 属性。',
  'cursor-pointer': '区块内可见且有效的链接样本，其鼠标指针样式都应为可点击手势。',
  'css-font-follow': '区块专属样式中应记录字体声明及其取证结果，本项只记录观察结果，不判定通过或失败。',
  'css-word-break': '区块专属样式中应记录断词声明及其取证结果，本项只记录观察结果，不判定通过或失败。',
  'carousel-arrows': '轮播幻灯片不多于每屏展示数时箭头应隐藏，否则左右箭头都应显示。',
  'btn-state': '本项只记录按钮链接、按钮文本和新窗口选项的当前值，不判定通过或失败。',
  'pcs-state': '应记录当前分类选择方式、分类总数和已勾选数量；全选模式下所有分类应勾选且不可编辑。',
  'pcs-front-note': '本项只记录预览中的分类导航文本，不判定通过或失败。',
  'cff-settings-fields': '应记录设置弹窗中可选的自定义筛选字段及当前勾选状态，不判定通过或失败。',
  'cff-settings-state': '应记录筛选逻辑、筛选触发方式和产品范围的当前值，不判定通过或失败。',
  'cff-field-front-group': '启用一个自定义字段并保存后，预览中应出现以该字段命名的筛选组；恢复后应回到原勾选状态。',
  'cff-radio-persist': '存在的筛选单选组切换后保存重开应保持新选项，恢复后应回到原选项。',
  'cff-select-persist': '切换筛选后跳转页并保存后，重新打开应保持新页面；恢复后应回到原页面。',
  'cff-color-persist': '背景颜色切换并保存后，重新打开应保持新颜色；恢复并保存后应回到原颜色。',
  'cff-groups-baseline': '本项只记录预览中各筛选组的标题和值清单，不判定通过或失败。',
  'cff-facet-narrow': '选择一个筛选值后，其他筛选组的可选值应收窄为基线子集，且页面应显示已选值。',
  'cff-clear-restore': '清除筛选后，各筛选组的可选值应恢复到筛选前基线。',
  'pld-fields': '本项只记录产品列表可选展示字段及当前勾选状态，不判定通过或失败。',
  'pld-data-source-persist': '切换产品列表数据来源并保存后，重新打开应保持新来源；恢复后应回到原来源。',
  'pld-front-note': '本项只记录预览中是否检测到产品列表候选元素，不判定通过或失败。',
  'pld-page-size-persist': '每页产品数量切换为另一可选数值并保存后，重新打开应保持新数值；恢复后应回到原数值。',
  'pld-pagination-persist': '切换分页展示选项并保存后，重新打开应保持新选项；恢复后应回到原选项。',
  'pld-compare-persist': '切换产品对比开关并保存后，重新打开应保持新状态；恢复后应回到原状态。',
  'pld-display-field-persist': '切换一个产品展示字段的勾选状态并保存后，重新打开应保持新状态；恢复后应回到原状态。',
  'bcs-state': '应记录配色方案数量和当前颜色值，不判定通过或失败。',
  'bcs-color-persist': '临时修改配色后保存重开应保留新颜色，恢复并保存后应回到原颜色。',
  'bcs-front-effect': '临时修改配色后，已确认跟随配色的前台元素应显示新颜色；恢复后应与基线一致。',
  'mw-state': '应记录当前宽度选项、自定义数值、生效宽度和全局应用勾选状态。',
  'mw-front-width': '切换宽度后前台容器的最大宽度应与所选数值一致，恢复后应回到原最大宽度。',
  'btn-front-text': '预览按钮文字应与设置弹窗中读取的按钮文本完全一致。',
  'bss-product-name-clamp': '产品名称最多显示两行，超出部分应隐藏。',
  'pcs-category-front': '仅选择后台的目标分类后，导航应只剩该分类，列表应与该分类的上架产品清单完全一致。',
  'pld-data-source-category-front': '仅选择后台的目标分类后，产品列表应与该分类的上架产品清单完全一致。',
  // Inquiry page heading and Brand column are independent of product-compare settings.
  'pld-compare-front': '启用产品对比并选择产品后，询盘页应带入已选择的产品。',
};
export function checkReportText(name, status, detail, evidence, id) {
  const label = reportName(name);
  let expected = persistenceExpected(id, evidence) || EXPECTED[id];
  if (!expected && id?.startsWith('bss-breakage-')) {
    expected = '页面不得出现横向溢出、元素超框、重叠、文字截断或图片失真。';
  }
  if (!expected && id?.startsWith('bss-')) expected = '样式应与设计稿列出的具体数值一致。';
  if (!expected) expected = `应检查${label}并记录具体观察结果。`;
  const actual = cleanReportSentence(detail) || ({ pass: '检查通过。', fail: '检查失败。', skip: '前置条件不满足，未执行检查。', na: '此区块不存在对应设置项。', record: '已记录观察结果，未作通过或失败判定。' }[status] || '');
  return { description: `检查${label}`, expected, actual, evidenceText: actual ? [actual] : [] };
}

export async function poll(read, accepts) {
  const deadline = Date.now() + TIMEOUT;
  let value;
  do {
    // A read that times out on the last millisecond (or a predicate that
    // cannot handle an empty read) is a non-match, not a crash: callers
    // decide what an unmatched poll means. Without this, a block whose
    // preview never yields groups (另一样本区块) fails the baseline check with a
    // 1ms evaluate timeout instead of recording "no groups".
    try { value = await read(Math.max(1, deadline - Date.now())); } catch { value = undefined; }
    try { if (accepts(value)) return { matched: true, value }; } catch { /* non-match */ }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
  } while (Date.now() <= deadline);
  return { matched: false, value };
}

export async function clickSettings(canvas, config, type, wrapIndex = 0) {
  // Several sub-regions can share one type (另一样本区块 has two gallery wraps:
  // category at 0, list at 1). wrapIndex picks the nth wrap of that type.
  const button = canvas.locator(blockSelector(config.blockId)).first()
    .locator(`.backstage-blocksEditor-wrap[data-blockseditor-type=${JSON.stringify(type)}]`).nth(wrapIndex)
    .locator('a.backstage-widgettool-btns[id^="editorBtn-"]').first();
  await button.waitFor({ state: 'attached', timeout: TIMEOUT });
  await button.evaluate((node) => node.click());
}

// Browser-side snapshot; keep every radio, including unidentified/unchecked groups.
export function controlsSnapshot(root) {
  const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
  return [...root.querySelectorAll('input, select, textarea')].map((input, index) => {
    const label = norm([...(input.labels || [])].map((node) => node.innerText).join(' ')
      || input.closest('li, label, .el-form-item, div')?.innerText);
    let parent = input.parentElement;
    while (parent && parent !== root && !norm(parent.innerText)) parent = parent.parentElement;
    return {
      index, tag: input.tagName, type: input.type, name: input.name || '', label,
      context: norm(parent?.innerText).slice(0, 300), value: input.value,
      checked: Boolean(input.checked), disabled: input.disabled, readOnly: Boolean(input.readOnly),
      options: input.tagName === 'SELECT' ? [...input.options].map((option) => ({
        value: option.value, label: norm(option.textContent), disabled: option.disabled
          || Boolean(option.closest('optgroup')?.disabled),
      })) : undefined,
    };
  });
}

export function controlValue(control) {
  return ['checkbox', 'radio'].includes(control.type) ? control.checked : control.value;
}

// Identity is checked on every reopen, before any write. Index alone is unsafe.
export function findControl(controls, target) {
  return controls.find((item) => item.index === target.index && item.tag === target.tag
    && item.type === target.type && item.name === target.name && item.label === target.label
    && (!['checkbox', 'radio'].includes(item.type) || item.value === target.value));
}

export function controlSession(root, lifecycle) {
  const read = (timeout = uiWaitConfig().timeout) => retryTransient(async () => {
    await waitForControlsReady(root, timeout);
    return root.evaluate(controlsSnapshot, undefined, { timeout });
  });
  const set = async (target, value) => {
    await retryTransient(() => waitForControlsReady(root));
    await root.evaluate((node, { target, value }) => {
      const input = node.querySelectorAll('input, select, textarea')[target.index];
      const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const label = input && norm([...(input.labels || [])].map((label) => label.innerText).join(' ')
        || input.closest('li, label, .el-form-item, div')?.innerText);
      if (!input || input.tagName !== target.tag || input.type !== target.type
        || (input.name || '') !== target.name || label !== target.label || input.disabled
        || (['checkbox', 'radio'].includes(input.type) && input.value !== target.value)) {
        throw new Error('目标控件身份变化、缺失或不可切换');
      }
      if (['checkbox', 'radio'].includes(input.type)) {
        if (input.checked !== value) input.click();
      } else {
        if (input.readOnly) throw new Error('输入框只读');
        const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype
          : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
      }
    }, { target, value }, { timeout: TIMEOUT });
    const settled = await poll(read, (items) => {
      const actual = findControl(items, target);
      return actual && controlValue(actual) === value;
    });
    if (!settled.matched) throw new Error('切换后控件值未达到预期');
  };
  const setMany = async (changes) => {
    if (!Array.isArray(changes) || !changes.length) return;
    await retryTransient(() => waitForControlsReady(root));
    await root.evaluate((node, updates) => {
      const norm = (text) => (text || '').replace(/\\s+/g, ' ').trim();
      const inputs = node.querySelectorAll('input, select, textarea');
      for (const { target, value } of updates) {
        const input = inputs[target.index];
        const label = input && norm([...(input.labels || [])].map((item) => item.innerText).join(' ')
          || input.closest('li, label, .el-form-item, div')?.innerText);
        if (!input || input.tagName !== target.tag || input.type !== target.type
          || (input.name || '') !== target.name || label !== target.label || input.disabled
          || input.type !== 'checkbox' || input.value !== target.value) {
          throw new Error('批量目标控件身份变化、缺失或不可切换');
        }
      }
      for (const { target, value } of updates) {
        const input = inputs[target.index];
        if (input.checked !== value) input.click();
      }
    }, changes, { timeout: TIMEOUT });
    const targets = changes;
    const settled = await poll(read, (items) => targets.every(({ target, value }) => {
      const actual = findControl(items, target);
      return actual && controlValue(actual) === value;
    }));
    if (!settled.matched) throw new Error('批量切换后控件值未全部达到预期');
  };
  return { root, read, set, setMany, ...lifecycle,
    open: () => retryTransient(async () => {
      await lifecycle.open();
      await waitForControlsReady(root);
    }),
    save: () => saveAndWait(root.page(), () => lifecycle.save()),
  };
}

export function widgetSession({ page, canvas, config, type, title, wrapIndex = 0 }) {
  const dialogRoot = page.locator('.backstage-dialog.backstage-dialog-widgetsettinsframe')
    .filter({ hasText: title }).first();
  const root = page.locator('.backstage-dialog.backstage-dialog-widgetsettinsframe')
    .filter({ hasText: title }).filter({ visible: true }).first();
  const anyDialog = page.locator('.backstage-dialog.backstage-dialog-widgetsettinsframe')
    .filter({ visible: true }).first();
  const open = async ({ timeout = Math.max(TIMEOUT, uiWaitConfig().timeout) } = {}) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!await root.isVisible().catch(() => false)) {
        await retryTransient(() => clickSettings(canvas, config, type, wrapIndex));
      }
      try {
        await retryTransient(() => waitForDialogState(dialogRoot, 'open', timeout));
        await root.locator('.backstage-dialog-bottom').waitFor({ state: 'visible', timeout });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        // If a partially rendered dialog exists, dismiss it before the next
        // idempotent open attempt rather than clicking through its backdrop.
        if (await root.isVisible().catch(() => false)) {
          const cancel = root.locator('.backstage-dialog-bottom').getByText(/^(取消|关闭)$/, { exact: true }).first();
          if (await cancel.count().catch(() => 0)) await cancel.evaluate((node) => node.click()).catch(() => {});
          await waitForDialogState(dialogRoot, 'closed', TIMEOUT).catch(() => {});
        }
      }
    }
  };
  const close = async (text) => {
    const button = root.locator('.backstage-dialog-bottom').getByText(text, { exact: true });
    const count = await button.count();
    if (count !== 1) throw new Error(`弹窗“${title}”底部“${text}”按钮应唯一，实际 ${count} 个。`);
    // The editor sometimes leaves a transparent popup locker over the modal.
    // The footer handlers are ordinary JS actions; click the uniquely scoped
    // button directly, then retain the same close/save completion checks.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!await root.isVisible().catch(() => false)) return;
      const activeButton = root.locator('.backstage-dialog-bottom').getByText(text, { exact: true });
      if (await activeButton.count() !== 1) throw new Error(`重试时弹窗“${title}”底部“${text}”按钮不唯一。`);
      await activeButton.evaluate((node) => node.click());
      try {
        await retryTransient(() => waitForDialogState(dialogRoot, 'closed', uiWaitConfig().saveTimeout));
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        // A save callback can miss its first click while the editor is
        // rebuilding the dialog. Reacquire the footer button before retrying.
        await root.waitFor({ state: 'visible', timeout: TIMEOUT }).catch(() => {});
      }
    }
  };
  // The dismiss button is 取消 in most dialogs but 关闭 in 另一样本区块's
  // 设置与选取数据 dialog. Try both, in that order.
  const dismiss = async (dialog) => {
    for (const text of ['取消', '关闭']) {
      const button = dialog.locator('.backstage-dialog-bottom').getByText(text, { exact: true });
      if (await button.count()) {
        const count = await button.count();
        if (count !== 1) throw new Error(`弹窗底部“${text}”按钮不唯一：${count} 个。`);
        await button.evaluate((node) => node.click());
        await waitForDialogState(dialog, 'closed', uiWaitConfig().saveTimeout);
        return;
      }
    }
    throw new Error('弹窗底部既无取消也无关闭按钮');
  };
  return controlSession(root, { open, save: () => close('保存'),
    cancel: async () => {
      // Close the title-matched dialog when it is open. If a different dialog
      // is open instead (wrong wrap clicked, title mismatch), close that one
      // too: a leftover dialog overlays #saveLayout and breaks the whole run.
      if (await root.isVisible()) { await dismiss(root); return; }
      if (await anyDialog.isVisible()) await dismiss(anyDialog);
    } });
}

// Radio group with any number of options (2-option groups keep using
// radioPersist). Returns skip when the group cannot be located uniquely.
export async function radioGroupPersist({ session, page, name, labels }) {
  const probe = await probeControls(session);
  if (probe.reason) return { status: 'skip', detail: `${name}：${probe.reason}` };
  const options = probe.controls.filter((item) => item.type === 'radio' && labels.includes(item.label));
  if (!options.length) return { status: 'na', detail: `${name}：该区块没有此选项组。` };
  const byName = new Map(options.map((item) => [item.name, true]));
  if (options.length !== labels.length || byName.size !== 1
    || options.filter((item) => item.checked).length !== 1 || options.some((item) => item.disabled)) {
    return { status: 'skip', detail: `${name}：无法唯一定位该组选项或当前选中不唯一。`, evidence: options };
  }
  const original = options.find((item) => item.checked);
  const alternate = options.find((item) => !item.checked);
  const groupSession = { ...session,
    set: async (_target, checked) => { await session.set(checked ? original : alternate, true); },
    read: async (...args) => {
      const controls = await session.read(...args);
      const states = options.map((item) => findControl(controls, item));
      if (states.some((item) => !item) || states.filter((item) => item.checked).length !== 1) {
        throw new Error('radio 组保存后未保持唯一选中值');
      }
      return controls;
    } };
  const outcome = await persistControl({ session: groupSession, page, target: original, alternate: false });
  if (outcome.evidence) {
    outcome.evidence.originalLabel = original.label;
    outcome.evidence.alternateLabel = alternate.label;
  }
  outcome.detail = `“${name}”由“${original.label}”切换为“${alternate.label}”后保存重开，恢复后回到“${original.label}”。${outcome.detail}`;
  return outcome;
}

export async function probeControls(session, accepts) {
  try {
    await session.open();
    const controls = accepts
      ? await readBackWithRetry(() => session.read(), accepts,
        async () => { await session.cancel(); await session.open(); })
      : await session.read();
    return { controls };
  }
  catch (error) { return { reason: `控件探查不可用：${error.message}` }; }
}

// A mutation is a transaction: verify the alternate persisted value, then always
// attempt recovery, verify it, close the editor UI, and save the restored page.
// Discovery failures skip; failures from the first attempted write onward fail.
export async function persistControl({ session, page, target, alternate, afterSwitch, restoreValue = controlValue(target), restoreSource = 'snapshot' }) {
  const evidence = { control: target.label || target.context, original: controlValue(target), alternate, controlType: target.type,
    restoreTarget: restoreValue, restoreSource };
  const errors = [];
  let stage = '翻转控件';
  try {
    // A previous transaction ends with the dialog closed. Reopen it here so
    // a persist that follows another one does not fail on a hidden dialog.
    if (typeof session.open === 'function') await session.open();
    await session.set(target, alternate);
    stage = '保存翻转状态';
    await session.save();
    stage = '重开回读翻转状态';
    await session.open();
    const actual = await readBackWithRetry(
      async () => findControl(await session.read(), target),
      (control) => control && controlValue(control) === alternate,
      async () => { await session.cancel(); await session.open(); });
    evidence.afterSave = actual ? controlValue(actual) : null;
    if (!actual || evidence.afterSave !== alternate) throw new Error('保存后值不符合预期');
    if (afterSwitch) {
      stage = '保存页面及预览效果';
      await session.cancel();
      await afterSwitch(evidence, (next) => { stage = next; });
    }
  } catch (error) { errors.push(`${stage}失败：${error.message}`); }
  finally {
    let restoreError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        stage = '恢复前重新打开';
        await session.cancel();
        await session.open();
        stage = '恢复原值';
        await session.set(target, restoreValue);
        stage = '保存恢复状态';
        await session.save();
        stage = '重开断言恢复';
        await session.open();
        const restored = await readBackWithRetry(
          async () => findControl(await session.read(), target),
          (control) => control && controlValue(control) === restoreValue,
          async () => { await session.cancel(); await session.open(); });
        evidence.restored = restored ? controlValue(restored) : null;
        if (!restored || evidence.restored !== restoreValue) throw new Error('未恢复目标值');
        restoreError = null;
        break;
      } catch (error) {
        restoreError = error;
        try { await session.cancel(); } catch { /* next attempt reopens explicitly */ }
      }
    }
    if (restoreError) errors.push(`${stage}失败：${restoreError.message}`);
    // Keep these attempts independent: failed readback must not prevent page save.
    try { await session.cancel(); } catch (error) { errors.push(`退出设置失败：${error.message}`); }
    try { await savePage(page); } catch (error) { errors.push(`保存恢复页面失败：${error.message}`); }
  }
  const display = (value) => typeof value === 'boolean'
    ? (/是|否/.test(evidence.control) ? (value ? '是' : '否') : (value ? '勾选' : '未勾选')) : String(value);
  const originalText = display(evidence.original);
  const restoreText = display(restoreValue);
  const alternateText = display(alternate);
  return { status: errors.length ? 'fail' : 'pass',
    detail: `控件“${evidence.control}”原值是“${originalText}”，改为“${alternateText}”后保存，重新打开${evidence.afterSave === alternate ? `仍为“${alternateText}”` : '未保持切换值'}，恢复目标为“${restoreText}”${evidence.restored === restoreValue ? '且回读一致' : '但回读不一致'}。${errors.join('；') || '恢复页面已保存。'}`, evidence };
}

export async function radioPersist({ session, page, name, prefixes, afterSwitch }) {
  const probe = await probeControls(session);
  if (probe.reason) return { status: 'skip', detail: `${name}：${probe.reason}` };
  const options = prefixes.map((prefix) => probe.controls.filter((item) => item.type === 'radio' && item.label.startsWith(prefix)));
  if (options.every((items) => items.length === 0)) return { status: 'na', detail: `${name}：该区块没有此选项组。` };
  if (options.some((items) => items.length !== 1) || options[0][0].index === options[1][0].index) {
    return { status: 'skip', detail: `${name}：无法按标签前缀唯一定位两个选项。` };
  }
  const pair = options.map(([item]) => item);
  if (pair.some((item) => item.disabled) || pair.filter((item) => item.checked).length !== 1
    || pair[0].name !== pair[1].name) {
    return { status: 'skip', detail: `${name}：选项不可切换或当前值/组归属不唯一。`, evidence: pair };
  }
  const original = pair.find((item) => item.checked);
  const alternate = pair.find((item) => !item.checked);
  // Setting one radio false cannot select its sibling; adapt reads/writes to the
  // original control's boolean value while explicitly clicking the other radio.
  const radioSession = { ...session, set: async (_target, checked) => {
    await session.set(checked ? original : alternate, true);
  }, read: async (...args) => {
    const controls = await session.read(...args);
    const left = findControl(controls, original);
    const right = findControl(controls, alternate);
    if (!left || !right || left.checked === right.checked) throw new Error('radio 组保存后未保持唯一选中值');
    return controls;
  } };
  const outcome = await persistControl({ session: radioSession, page, target: original, alternate: false, afterSwitch });
  if (outcome.evidence) {
    outcome.evidence.originalLabel = original.label;
    outcome.evidence.alternateLabel = alternate.label;
  }
  outcome.detail = `“${name}”由“${original.label}”切换为“${alternate.label}”后保存重开，恢复后回到“${original.label}”。${outcome.detail}`;
  return outcome;
}

// AUTOTEST category usable for category-scoped checks, or the reason it is not
// (fixture prep failed, or the site could not host the category).
export function fixtureCategoryState(profile, report) {
  const name = profile?.fixture?.category?.name;
  if (!name) return { name: null, reason: '画像未提供 AUTOTEST 分类。' };
  const record = report?.fixture?.records?.category;
  if (record?.unavailable) return { name: null, reason: `AUTOTEST 分类不可用：${record.unavailable}` };
  return { name, reason: null };
}
