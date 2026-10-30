import { saveAndWait, waitForStable } from './ui-waits.mjs';

const PROD_URL = 'https://website.leadong.com/prod';
const TIMEOUT = 15_000;
export const FIELD_TYPE_CODES = Object.freeze({
  文本字段: 0, 单选按钮: 1, 下拉列表: 2, 多选按钮: 3, 色卡: 4, 下载文件: 5, 文本域: 8,
});
const enumeration = new Set([1, 2, 3]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (value) => JSON.stringify(String(value));
const actionLocator = (page, action) => page.locator(`[action=${quote(action)}], [data-action=${quote(action)}]`).filter({ visible: true });

async function unique(locator, step) {
  await locator.first().waitFor({ state: 'attached', timeout: TIMEOUT });
  const count = await locator.count();
  if (count !== 1) throw new Error(`${step}：应有唯一控件，实际找到 ${count} 个。`);
  return locator;
}
async function clickAction(page, action, text) {
  let locator = actionLocator(page, action);
  // hasText with an anchored regex matches against the element's full
  // textContent (including leading whitespace/newlines inside the anchor),
  // so /^管理自定义字段$/ never matches. Use a plain substring instead.
  if (text) locator = locator.filter({ hasText: text instanceof RegExp ? text.source.replace(/^\^/, '').replace(/\$$/, '') : text });
  // Probe shows both sidebar and content “添加产品” links with this action.
  // The sidebar has the observed void(0) href; save actions remain unique.
  if (action === 'prod_new_add' && await locator.count() > 1) locator = locator.and(page.locator('a[href="javascript:void(0)"]'));
  const target = await unique(locator, `CMS ${action}`);
  // Playwright mouse clicks on this SPA's sidebar entries intermittently fail
  // to trigger navigation (probe: 1 of 2 attempts stayed on the product list);
  // a DOM click, as the probes use, navigates reliably. Keep the uniqueness
  // check above so a wrong or ambiguous target still fails loudly.
  await target.evaluate((el) => el.click());
}
async function assertProd(page) {
  const url = new URL(page.url());
  if (url.origin !== new URL(PROD_URL).origin || url.pathname !== '/prod'
    || await page.locator('input[type="password"]:visible').count()) {
    throw new Error('CMS 登录态/SSO 不可用：未进入产品管理 SPA；请先在同一 context 经 editSite 打开编辑器，不在 CMS 内重新登录。');
  }
  await actionLocator(page, 'prod_list').first().waitFor({ state: 'visible', timeout: TIMEOUT })
    .catch(() => { throw new Error('CMS 登录态/SSO 或页面结构异常：未看到产品管理入口 prod_list。'); });
}
export async function openProdPage(context) {
  const page = await context.newPage();
  try {
    await page.goto(PROD_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await assertProd(page);
    return page;
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

export async function listCustomFields(page) {
  await assertProd(page);
  // The field table loads via XHR after the view swaps; reading rows with
  // waitForStable alone can settle on an empty table if the data is >1s late
  // (observed live: 0 fields in 1.8s). Let the navigation + data settle first.
  // The sidebar click can also be lost while the SPA is still initializing
  // (observed live: still on the product list after the 15s wait); retry it
  // when the field list never appeared, up to 3 times.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settleCmsNavigation(page, () => clickAction(page, 'prod_field_list', '管理自定义字段'));
    try {
      await actionLocator(page, 'prod_field_edit').filter({ hasText: '添加自定义字段' })
        .waitFor({ state: 'visible', timeout: TIMEOUT });
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
      const onFieldList = await page.evaluate(() => /字段名称/.test(document.body.innerText || ''));
      if (onFieldList) throw error; // Navigated but the button is missing: a real problem, don't mask it.
    }
  }
  return waitForStable(() => page.evaluate((types) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('table tr')].filter((row) => row.getClientRects().length)
      .map((row) => [...row.querySelectorAll(':scope > td, :scope > th')].map((cell) => norm(cell.innerText)))
      .filter((cells) => cells.length >= 3 && !/^(字段名称|状态标签[：:]?|状态信息[：:]?)$/.test(cells[0])
        && types.includes(cells[1]) && ['开启', '关闭'].includes(cells[2]))
      .map(([name, type, status]) => ({ name, type, status }));
  }, Object.keys(FIELD_TYPE_CODES)));
}
function optionInputs(page) {
  // Probe: enum options are unnamed text inputs. Scope to the field-name form
  // container rather than inventing option IDs/classes (the probes have none).
  return page.locator('input[name="field.fieldName"]').locator('xpath=ancestor::*[.//*[@id="submitFieldOptionJson"]][1]')
    .locator('input[type="text"]:not([name]), input[type="text"][name=""]').filter({ visible: true });
}
async function readOptions(page) {
  const inputs = optionInputs(page);
  await inputs.first().waitFor({ state: 'visible', timeout: TIMEOUT });
  return waitForStable(() => inputs.evaluateAll((nodes) => nodes.map((node) => node.value)));
}
async function openField(page, name) {
  await listCustomFields(page);
  const exactName = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const rows = page.locator('table tr').filter({ has: page.locator('td').filter({ hasText: exactName }) }).filter({ visible: true });
  // Check direct cells too: nested text matches must not select another field.
  const row = await unique(rows, `编辑字段“${name}”的表格行`);
  await (await unique(row.locator('[action="prod_field_edit"], [data-action="prod_field_edit"]'), `编辑字段“${name}”`)).click();
  await page.locator('input[name="field.fieldName"]').waitFor({ state: 'visible', timeout: TIMEOUT });
  if (await page.locator('input[name="field.fieldName"]').inputValue() !== name) throw new Error(`打开的字段不是“${name}”。`);
}
// Extra read-only helper: listCustomFields intentionally returns only name/type/status.
export async function readCustomFieldOptions(page, name) {
  await openField(page, name);
  return readOptions(page);
}

// Both native and DOM confirmation dialogs can occur after a CMS save. Only
// explicit confirmation controls are accepted; never click a global “确定”.
async function saveCms(page, click, options = {}) {
  // Probe v13/v14/v16 (2026-10-28): the product save chain stalls
  // probabilistically after verify returns {} — no similarityJudge, no
  // dialog, no error — and the runner then burns the 30s poll + 90s
  // re-read before failing. When retryClicks is set (product saves only),
  // re-click save if the chain shows no progress: no save-chain request
  // within 5s of a click, or verify without a follow-up within 3s. In
  // every success the follow-up lands within ~1s of verify, so 3s is a
  // wide margin, not a race. Field saves never retry: their endpoint
  // differs and a repeat submit is a real duplicate risk.
  const retryClicks = options.retryClicks || 0;
  const saveChain = [];
  const onSaveRequest = (request) => {
    if (/prod\/doUpdate\/verify|similarityJudge|prod\/new\/doUpdate/.test(request.url())) {
      saveChain.push({ at: Date.now(), url: request.url() });
    }
  };
  if (retryClicks > 0) page.on('request', onSaveRequest);
  let dialogError;
  const nativeDialog = async (dialog) => {
    try {
      if (!['alert', 'confirm'].includes(dialog.type())) throw new Error('CMS 保存出现未支持的输入型弹窗。');
      await dialog.accept();
    } catch (error) { dialogError = error; await dialog.dismiss().catch(() => {}); }
  };
  page.on('dialog', nativeDialog);
  try {
    await saveAndWait(page, async () => {
      // The product save runs verify + similarityJudge before the confirm
      // dialog appears; probe v7 (2026-10-28) measured 8.1s, so the old
      // 5s window missed it every time and the save never fired. Poll 30s.
      const deadline = Date.now() + 30_000;
      let clicked = false;
      let attempts = 0;
      let clickAt = 0;
      const doClick = async () => { clickAt = Date.now(); attempts++; await click(); };
      await doClick();
      do {
        const state = await page.evaluate(() => {
          const norm = (node) => (node.innerText || node.value || '').replace(/\s+/g, ' ').trim();
          const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
          // Probed 2026-10-28 (v6/v7): the repeat-confirm layer is the
          // platform's custom popup #popupLayer_sysConfirmPop > #popWin,
          // “Title、Description和已有产品相同不利于搜索引擎优化，确认提交？”,
          // confirm button #confirmYes. Clicking it fires the real save
          // POST /prod/new/doUpdate (payload carries the field values).
          const layer = document.querySelector('#popupLayer_sysConfirmPop');
          if (layer && visible(layer)) {
            const yes = layer.querySelector('#confirmYes');
            if (yes && visible(yes)) { yes.click(); return { layerOpen: true, clicked: true }; }
            return { layerOpen: true, clicked: false };
          }
          const buttons = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')].filter(visible);
          const targets = buttons.filter((button) => {
            if (!/^(确定|确认)$/.test(norm(button))) return false;
            if (button.closest('[role="dialog"], dialog')) return true;
            // Generic fallback for other custom confirm markup: a container
            // that says “重复确认” and contains an explicit cancel control.
            // No class guesses.
            for (let parent = button.parentElement; parent && !['BODY', 'HTML', 'FORM'].includes(parent.tagName); parent = parent.parentElement) {
              if (/重复确认/.test(norm(parent)) && buttons.some((other) => /^(取消|关闭)$/.test(norm(other)) && parent.contains(other))) return true;
            }
            return false;
          });
          if (targets.length > 1) throw new Error(`CMS 保存确认按钮不唯一，看到 ${targets.length} 个。`);
          if (targets.length === 1) { targets[0].click(); return { layerOpen: false, clicked: true }; }
          return { layerOpen: false, clicked: false };
        });
        if (state.clicked) clicked = true;
        if (clicked && !state.layerOpen) break;
        if (dialogError) throw dialogError;
        if (retryClicks > 0 && !clicked && !state.layerOpen && attempts <= retryClicks) {
          const verifyReq = saveChain.find((req) => /doUpdate\/verify/.test(req.url) && req.at >= clickAt);
          const followupReq = saveChain.find((req) => /similarityJudge|new\/doUpdate/.test(req.url) && req.at >= clickAt);
          const stalled = (!verifyReq && Date.now() - clickAt > 5_000)
            || (verifyReq && !followupReq && Date.now() - verifyReq.at > 3_000);
          if (stalled) await doClick();
        }
        await delay(500);
      } while (Date.now() < deadline);
    });
    if (dialogError) throw dialogError;
  } finally { page.off('dialog', nativeDialog); if (retryClicks > 0) page.off('request', onSaveRequest); }
}
async function saveProduct(page) {
  // Save text is established by setup-oracle-fixture, the action is unprobed.
  const buttons = page.locator('button, a, input[type="submit"], input[type="button"]').filter({ visible: true });
  await saveCms(page, async () => buttons.evaluateAll((nodes) => {
    const found = nodes.filter((node) => /^(保存|提交)$/.test((node.innerText || node.value || '').trim()));
    if (found.length !== 1) throw new Error(`产品保存入口不唯一：看到 ${found.length} 个保存/提交控件，须实跑核查表单。`);
    found[0].click();
  }), { retryClicks: 2 });
}
export async function createCustomField(page, { name, type, typeCode, options = [] }) {
  let step = '核对类型';
  try {
    const code = FIELD_TYPE_CODES[type];
    if (code === undefined || (typeCode !== undefined && Number(typeCode) !== code)) throw new Error(`类型“${type}”与类型码 ${typeCode} 不一致。`);
    if (enumeration.has(code) && (!options.length || options.some((value) => typeof value !== 'string' || !value))) throw new Error('枚举字段缺少有效选项。');
    await listCustomFields(page);
    step = '打开新增字段表单';
    await clickAction(page, 'prod_field_edit', /^添加自定义字段$/);
    const nameInput = await unique(page.locator('input[name="field.fieldName"]'), step);
    await nameInput.fill(name);
    await page.locator('input[name="field.fieldStatus"][value="1"]').check();
    await page.locator(`input[name="field.fieldType"][value=${quote(code)}]`).check();
    step = '填选择项';
    if (enumeration.has(code)) {
      for (let i = 0; i < options.length; i++) {
        if (i > 0) await (await unique(page.getByText(/^\+\s*添加选择项/).filter({ visible: true }), '添加选择项')).click();
        const inputs = optionInputs(page);
        await inputs.nth(i).waitFor({ state: 'visible', timeout: TIMEOUT });
        if (await inputs.count() !== i + 1) throw new Error(`第 ${i + 1} 个选择项：实际文本框 ${await inputs.count()} 个。`);
        await inputs.nth(i).fill(options[i]);
        await inputs.nth(i).blur();
      }
      step = '核对选择项';
      // Probe 2026-10-28: #submitFieldOptionJson stays EMPTY while the form is
      // being filled — fill+blur, real keystrokes and manual input/change/
      // keyup dispatch all leave it blank. It is serialized at submit, not
      // live. So pre-save verification reads the visible option inputs; the
      // hidden JSON is only a post-save concern (the re-read below).
      const visibleOptions = await readOptions(page);
      if (JSON.stringify(visibleOptions) !== JSON.stringify(options)) throw new Error(`选择项文本框应为 ${options.join('、')}，实际为 ${visibleOptions.join('、')}。`);
    }
    step = '保存字段';
    await saveCms(page, () => clickAction(page, 'saveFieldContent'));
    step = '轮询字段列表';
    const deadline = Date.now() + 60_000;
    let record;
    do {
      const found = (await listCustomFields(page)).filter((field) => field.name === name);
      if (found.length > 1) throw new Error(`同名字段“${name}”出现多条。`);
      record = found[0];
      if (record) break;
      await delay(1_000);
    } while (Date.now() < deadline);
    if (!record || record.type !== type || record.status !== '开启') throw new Error(`未读到名称、类型、开启状态一致的字段“${name}”。`);
    step = '重开核对选项';
    if (enumeration.has(code)) {
      const actual = await readCustomFieldOptions(page, name);
      if (JSON.stringify(actual) !== JSON.stringify(options)) throw new Error(`选项应为 ${options.join('、')}，实际为 ${actual.join('、')}。`);
    }
    return record;
  } catch (error) { throw new Error(`创建字段“${name}”在${step}失败：${error.message}`); }
}

async function settleCmsNavigation(page, action) {
  const pending = new Set();
  let revision = 0;
  const onRequest = (request) => {
    if (['xhr', 'fetch'].includes(request.resourceType())) { pending.add(request); revision++; }
  };
  const onDone = (request) => { if (pending.delete(request)) revision++; };
  page.on('request', onRequest); page.on('requestfinished', onDone); page.on('requestfailed', onDone);
  try {
    await action();
    await waitForStable(async () => ({ pending: pending.size, revision,
      tables: await page.locator('table:visible').allTextContents() }), (state) => state.pending === 0);
  } finally {
    page.off('request', onRequest); page.off('requestfinished', onDone); page.off('requestfailed', onDone);
  }
}

export async function findProduct(page, name) {
  await assertProd(page);
  // Live probe 2026-10-30: navigating to /prod?invokeAction=prod_list_sub
  // opens the observed product table directly. The sidebar prod_list toggle
  // did not reveal its submenu when the SPA opened on the product form.
  await gotoAction(page, 'prod_list_sub');
  // Search structure is unprobed: use observed semantic attributes/labels,
  // require a unique input plus a unique search button before using it.
  const inputs = page.locator('input[type="text"], input[type="search"]').filter({ visible: true });
  const searchIndexes = await inputs.evaluateAll((nodes) => nodes.flatMap((node, index) => {
    const labels = [node.placeholder, node.getAttribute('aria-label'), ...(node.labels || [])].map((value) => typeof value === 'string' ? value : value?.innerText || '');
    for (let parent = node.parentElement; parent && !['BODY', 'HTML', 'FORM'].includes(parent.tagName); parent = parent.parentElement) {
      if (parent.querySelectorAll('input:not([type="hidden"]), select, textarea').length > 1) break;
      const text = (parent.innerText || '').replace(/\s+/g, ' ').trim();
      if (text) { if (text.length < 40) labels.push(text); break; }
    }
    return /搜索|产品名|产品名称|关键词|关键字/.test(labels.join(' ')) ? [index] : [];
  }));
  if (searchIndexes.length !== 1) throw new Error(`按产品名搜索不唯一或不可用：看到 ${searchIndexes.length} 个搜索输入框；不能把第一页未找到视为不存在。`);
  if (searchIndexes.length === 1) {
    await inputs.nth(searchIndexes[0]).fill(name);
    const search = page.getByRole('button', { name: /搜索|查询/ }).or(page.locator('a').filter({ hasText: /搜索|查询/ })).filter({ visible: true });
    // Probe v20 / run 2026-10-28 10-19: a Playwright mouse click on the
    // search button timed out for 30s because #popupLayerScreenLocker
    // (the popup dimming overlay) intercepted pointer events — the locker
    // never appeared in v20's identical sequence, so it is a transient
    // platform overlay, not a dialog awaiting input. DOM-click it like the
    // sidebar entries and the save button: the handler is JS, the overlay
    // cannot block a DOM click.
    await settleCmsNavigation(page, async () => (await unique(search, '产品名称搜索按钮')).evaluate((el) => el.click()));
  }
  // If search is unavailable and the product is beyond page one, this scan
  // may report it absent. First live run MUST verify the search path. New
  // AUTOTEST products have no such risk; recently updated fixtures tend to
  // appear on page one. Do not guess undocumented search selectors.
  await page.locator('table').filter({ visible: true }).first().waitFor({ state: 'visible', timeout: TIMEOUT });
  return waitForStable(() => page.evaluate((wanted) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const links = [...document.querySelectorAll('table tr a[href*="prodId="]')]
      .filter((link) => link.getClientRects().length && norm(link.innerText) === wanted);
    const ids = [...new Set(links.map((link) => new URL(link.getAttribute('href'), location.origin).searchParams.get('prodId')))];
    if (ids.length > 1) throw new Error(`产品名“${wanted}”不唯一，匹配 ${ids.length} 个产品。`);
    return ids[0] || null;
  }, name));
}

export async function createProduct(page, { name }) {
  // First live run MUST inspect the add form. Only a uniquely labelled
  // product-name input is filled; other required fields cause an explicit
  // save/readback failure, never guessed defaults or invented form IDs.
  await settleCmsNavigation(page, () => clickAction(page, 'prod_new_add', /^添加产品$/));
  const inputs = page.locator('input[type="text"], textarea').filter({ visible: true });
  // Probe v19 (2026-10-28): the add form renders ~2s after the click, and
  // its 产品名称 label is plain text, not a <label for> — the label walk
  // finds nothing (labels [] and parent text empty, because the ancestors
  // hold several inputs). The platform's own save code reads the name from
  // input[name=product.prodName] (prod_config.js), so that attribute is a
  // grounded fallback, not a guess. Poll until exactly one match appears.
  const matchDeadline = Date.now() + 30_000;
  let indexes = [];
  do {
    indexes = await inputs.evaluateAll((nodes) => nodes.flatMap((node, index) => {
      const normalize = (t) => (t || '').replace(/[\s*：:]/g, '');
      if (node.name === 'product.prodName' || node.id === 'product.prodName') return [index];
      const labels = [...(node.labels || [])].map((label) => label.innerText);
      labels.push(node.getAttribute('aria-label'), node.placeholder);
      for (let parent = node.parentElement; parent && !['BODY', 'HTML', 'FORM'].includes(parent.tagName); parent = parent.parentElement) {
        if (parent.querySelectorAll('input[type="text"], textarea').length > 1) break;
        const text = normalize(parent.innerText);
        if (text) { labels.push(text); break; }
      }
      return labels.some((label) => /^(产品名称|产品名)$/.test(normalize(label))) ? [index] : [];
    }));
    if (indexes.length === 1) break;
    await delay(500);
  } while (Date.now() < matchDeadline);
  if (indexes.length !== 1) throw new Error(`新增产品表单：产品名称输入框匹配 ${indexes.length} 个，首次实跑须核查新增表单。`);
  await inputs.nth(indexes[0]).fill(name);
  await page.evaluate(() => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], select')].filter((input) => {
      if (input.tagName === 'SELECT') return input.getClientRects().length && [...input.options].some((option) => norm(option.text) === '上架');
      const labels = [...(input.labels || [])];
      return labels.some((label) => label.getClientRects().length && norm(label.innerText) === '上架')
        || (input.parentElement?.getClientRects().length && norm(input.parentElement.innerText) === '上架');
    });
    if (candidates.length > 1) throw new Error('新增产品表单上架控件不唯一，须核查新增表单。');
    const input = candidates[0];
    if (!input) return; // No observable listing control: keep the form default.
    if (input.disabled) throw new Error('新增产品表单上架控件不可编辑。');
    if (input.tagName === 'SELECT') {
      const options = [...input.options].filter((option) => norm(option.text) === '上架' && !option.disabled);
      if (options.length !== 1) throw new Error('上架选项无法唯一确定。');
      input.value = options[0].value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (!input.checked) input.click();
  });
  await saveProduct(page);
  // Verify identity by exact name as well as ID; an unchanged form URL alone
  // cannot prove the create succeeded.
  const deadline = Date.now() + 60_000;
  do {
    const id = await findProduct(page, name);
    if (id) return id;
    await delay(1_000);
  } while (Date.now() < deadline);
  throw new Error(`新增产品“${name}”保存后 60 秒内未读到 prodId；须核查必填项和上架状态。`);
}

async function openProduct(page, prodId) {
  const url = new URL(PROD_URL);
  url.searchParams.set('invokeAction', 'prod_new_update');
  url.searchParams.set('prodId', prodId);
  // Wait for 'load', not just domcontentloaded: probe v9 (2026-10-28) showed
  // the runner's save click landing before the page JS had bound the save
  // handler — verify/similarityJudge never fired and the 90s re-read timed
  // out — while the same clicks after a 3s wait (v10/v11) worked. The form
  // values are server-rendered and stable early, so waitProductFields alone
  // cannot prove the handler is ready; 'load' waits for the page scripts.
  await page.goto(url.href, { waitUntil: 'load', timeout: 60_000 });
  await assertProd(page);
}
// Browser-side discovery/read/write uses field text, never option_<fixed ID>.
// Container layouts and multi-checkbox markup remain first-live-run checks.
function productFields({ names, values }) {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const title = (t) => norm(t).replace(/^[*＊]\s*/, '').replace(/\s*[：:]$/, '');
  const available = (node) => node.getClientRects().length || [...(node.labels || [])].some((label) => label.getClientRects().length);
  const result = {};
  for (const name of names) {
    const labels = [...document.querySelectorAll('label, th, td, span, div, dt')]
      .filter((node) => title(node.textContent) === name && ![...node.children].some((child) => title(child.textContent) === name));
    const groups = [];
    for (const label of labels) {
      for (let parent = label; parent && !['BODY', 'HTML', 'FORM'].includes(parent.tagName); parent = parent.parentElement) {
        const controls = [...parent.querySelectorAll('input[type="radio"], input[type="checkbox"], select')].filter(available);
        if (!controls.length) continue;
        const types = new Set(controls.map((input) => input.tagName === 'SELECT' ? 'select' : input.type));
        const groupNames = new Set(controls.map((input) => input.name));
        if (types.size === 1 && (controls[0].tagName === 'SELECT' ? controls.length === 1 : groupNames.size === 1 && controls[0].name)) groups.push(controls);
        break;
      }
    }
    const unique = groups.filter((group, index) => !groups.slice(0, index).some((other) => other.length === group.length && other.every((node, i) => node === group[i])));
    if (unique.length !== 1) throw new Error(`字段“${name}”：按字段名定位到 ${unique.length} 个唯一控件组（字段标题匹配 ${labels.length} 个）。`);
    const controls = unique[0], type = controls[0].tagName === 'SELECT' ? 'select' : controls[0].type;
    const optionLabel = (input) => {
      const texts = [...(input.labels || [])].map((label) => norm(label.innerText)).filter(Boolean);
      if (texts.length === 1) return texts[0];
      return norm((input.closest('label') || input.parentElement)?.innerText);
    };
    if (values) {
      const wanted = values[name];
      if (typeof wanted !== 'string') throw new Error(`字段“${name}”要求单个字符串值。`);
      if (type === 'select') {
        const options = [...controls[0].options].filter((option) => norm(option.text) === wanted && !option.disabled);
        if (options.length !== 1 || controls[0].disabled) throw new Error(`字段“${name}”无法唯一选择“${wanted}”。`);
        controls[0].value = options[0].value;
        controls[0].dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const targets = controls.filter((input) => optionLabel(input) === wanted);
        if (targets.length !== 1 || controls.some((input) => input.disabled)) throw new Error(`字段“${name}”的 ${type} 组无法唯一选择“${wanted}”。`);
        if (type === 'radio') { if (!targets[0].checked) targets[0].click(); }
        else for (const input of controls) if (input.checked !== (input === targets[0])) input.click();
      }
    }
    if (type === 'select') result[name] = norm(controls[0].selectedOptions[0]?.text);
    else {
      const checked = controls.filter((input) => input.checked).map(optionLabel);
      if (type === 'radio' && checked.length > 1) throw new Error(`字段“${name}”单选组有多个选中值。`);
      result[name] = type === 'checkbox' ? checked : checked[0] || '';
    }
  }
  return result;
}
async function waitProductFields(page, names) {
  let lastError;
  try {
    const state = await waitForStable(async () => {
      try { return { ready: true, values: await page.evaluate(productFields, { names }) }; }
      catch (error) { lastError = error; return { ready: false }; }
    }, (state) => state.ready);
    return state.values;
  } catch (error) { throw lastError || error; }
}
export async function readProductFieldValues(page, prodId, fieldNames) {
  await openProduct(page, prodId);
  return waitProductFields(page, fieldNames);
}
export async function setProductFieldValues(page, prodId, values) {
  await openProduct(page, prodId);
  await waitProductFields(page, Object.keys(values));
  const inDom = await page.evaluate(productFields, { names: Object.keys(values), values });
  // Fail fast if the DOM clicks did not take: a silent miss here used to
  // burn the 30s confirm poll plus the 90s re-read before surfacing.
  for (const [name, wanted] of Object.entries(values)) {
    const got = inDom[name];
    const ok = Array.isArray(got) ? got.includes(wanted) : got === wanted;
    if (!ok) throw new Error(`产品字段“${name}”设值后页面内未勾选“${wanted}”（读到 ${JSON.stringify(got)}）；未保存。`);
  }
  await saveProduct(page);
  const deadline = Date.now() + 90_000;
  let actual, mismatch = Object.keys(values), lastError;
  do {
    // Do not immediately read: CMS synchronization follows save confirmation.
    await delay(Math.min(5_000, Math.max(0, deadline - Date.now())));
    try {
      actual = await readProductFieldValues(page, prodId, Object.keys(values));
      mismatch = Object.keys(values).filter((name) => Array.isArray(actual[name])
        ? actual[name].length !== 1 || actual[name][0] !== values[name] : actual[name] !== values[name]);
      if (!mismatch.length) return actual;
      lastError = '';
    } catch (error) { lastError = error.message; }
  } while (Date.now() < deadline);
  throw new Error(`产品字段保存后回读超时，不一致字段：${mismatch.join('、')}；实际 ${JSON.stringify(actual || {})}${lastError ? `；${lastError}` : ''}。`);
}

// These semantic CMS locators are deliberately strict; their DOM structure must
// be checked on a test site before enabling fixture writes in production use.
const autoName = name => typeof name === 'string' && name.startsWith('AUTOTEST-') && name.length > 9;
function requireAuto(name) { if (!autoName(name)) throw new Error('拒绝操作非 AUTOTEST 数据。'); }
export async function getCustomFieldIdentity(page, name) {
  requireAuto(name);
  await openField(page, name);
  // Live probe 2026-10-30: the edit form carries the field id in the single
  // hidden input field.encodePkId (other hidden inputs are page-level).
  const id = await page.evaluate(() => {
    const ids = [...new Set([...document.querySelectorAll('input[type="hidden"][name="field.encodePkId"]')].map(x => x.value).filter(Boolean))];
    if (ids.length !== 1) throw new Error('字段 ID 隐藏控件 field.encodePkId 不唯一，需核实 CMS 表单。');
    return ids[0];
  });
  const record = (await listCustomFields(page)).filter(f => f.name === name);
  if (record.length !== 1) throw new Error('字段名称不唯一。');
  return { ...record[0], id };
}
export async function updateCustomField(page, name, { missing = [], type, enable = false }) {
  requireAuto(name);
  await openField(page, name);
  if (type) {
    const radio = page.locator(`input[name="field.fieldType"][value=${quote(FIELD_TYPE_CODES[type])}]`);
    if (await radio.count() !== 1 || await radio.isDisabled()) throw new Error('字段类型控件不可安全修改。');
    if (!await radio.isChecked()) await radio.check();
  }
  if (enable) await page.locator('input[name="field.fieldStatus"][value="1"]').check();
  for (const option of missing) {
    const inputs = optionInputs(page), before = await inputs.count();
    await (await unique(page.getByText(/^\+\s*添加选择项/).filter({ visible: true }), '添加选择项')).click();
    if (await inputs.count() !== before + 1) throw new Error('新增字段选项控件数量不一致。');
    await inputs.nth(before).fill(option); await inputs.nth(before).blur();
  }
  await saveCms(page, () => clickAction(page, 'saveFieldContent'));
}
// Live probe 2026-10-30: invokeAction=prod_group_list lists every category
// row with a dataId checkbox (= group id) and a viewProductListByGoup link
// carrying the name; invokeAction=prod_group_add may answer with a
// "分类数量已经达到最大限制" system alert instead of a form.
export class CategoryLimitError extends Error { code = 'CATEGORY_LIMIT'; }
async function gotoAction(page, action, params = {}) {
  const url = new URL(PROD_URL); url.searchParams.set('invokeAction', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  await page.goto(url.href, { waitUntil: 'load', timeout: 60_000 });
  await assertProd(page);
  await page.waitForTimeout(3000);
}
export async function findCategory(page, name) {
  requireAuto(name);
  await gotoAction(page, 'prod_group_list');
  await page.locator('input[type="checkbox"][name="dataId"]').first().waitFor({ state: 'attached', timeout: TIMEOUT }).catch(() => {});
  // Every row (leaf or not) carries its name in the dataId checkbox groupname.
  return page.evaluate(wanted => {
    const rows = [...document.querySelectorAll('input[type="checkbox"][name="dataId"]')].filter(n => (n.getAttribute('groupname') || '').trim() === wanted);
    if (rows.length > 1) throw new Error('夹具分类重名。');
    return rows.length ? { name: wanted, id: rows[0].value, parents: rows[0].closest('tr')?.getAttribute('parentgroup') ?? null } : null;
  }, name);
}
export async function createCategory(page, name) {
  requireAuto(name);
  await gotoAction(page, 'prod_group_add');
  const limit = await page.evaluate(() => /分类数量已经达到最大限制/.test(document.body.innerText || ''));
  if (limit) throw new CategoryLimitError('站点产品分类数量已达上限，无法新建 AUTOTEST 分类。');
  const form = await unique(page.locator('form[action="/prod/group/doAdd"]'), '新增分类表单');
  const selected = form.locator('#treeboxbox_tree_pop .selectedTreeRow');
  if (await selected.count() !== 1 || (await selected.innerText()).trim() !== '所有分组'
      || await form.locator('#strParentGroup').inputValue() !== '') {
    throw new Error('新增分类表单未选中顶级位置。');
  }
  const input = await unique(form.locator('input[name="group.groupName"]'), '分类名称');
  await input.fill(name);
  await input.blur();
  const save = await unique(page.locator('a[action="prod_group_save_verify"][flag="list"]').filter({ visible: true }), '保存分类');
  // The form enables this anchor asynchronously after the input event.
  await page.locator('a[action="prod_group_save_verify"][flag="list"]:visible:not([disabled])')
    .waitFor({ state: 'visible', timeout: TIMEOUT });
  await saveCms(page, async () => {
    if (await save.getAttribute('disabled') !== null) throw new Error('保存分类按钮不可用。');
    await save.evaluate(node => node.click());
  });
  const created = await findCategory(page, name);
  if (!created || created.parents !== '-1') throw new Error('创建后未找到唯一顶级夹具分类。');
  return created;
}
async function openAutoProduct(page, prodId) {
  await openProduct(page, prodId);
  const input = await unique(page.locator('input[name="product.prodName"]'), '产品名称');
  requireAuto(await input.inputValue());
}
// Live probe 2026-10-30: the product form stores categories in the hidden
// input groupIds (comma separated ids); productGroupSelect() opens a picker
// with checkboxGroupIds checkboxes and confirm #popWinProdGroupConfirm.
const groupIds = page => page.locator('input[type="hidden"][name="groupIds"]').inputValue().then(v => v.split(',').map(s => s.trim()).filter(Boolean));
export async function readProductCategories(page, prodId) {
  await openAutoProduct(page, prodId);
  return groupIds(page);
}
export async function addProductCategory(page, prodId, categoryId, categoryName) {
  requireAuto(categoryName);
  await openAutoProduct(page, prodId);
  await page.evaluate(() => window.productGroupSelect());
  const box = page.locator(`#popWin input[type="checkbox"][name="checkboxGroupIds"][value="${categoryId}"]`);
  await (await unique(box, '分类选择框')).check();
  await (await unique(page.locator('#popWinProdGroupConfirm'), '分类确认')).click();
  if (!(await groupIds(page)).includes(categoryId)) throw new Error('分类选择后 groupIds 未包含目标分类。');
  await saveProduct(page);
}
