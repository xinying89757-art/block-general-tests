import fs from 'node:fs/promises';
import path from 'node:path';
import { addBlockIfNeeded, closeToolbarMenusBeforeAction, gotoFreshTargetPage, openEditor, savePage } from './editor.mjs';
import { inventorySettings } from './baseline.mjs';
import { currentValuesFromInventory } from './fresh-settings-adapter.mjs';
import { matchingDeleteConfirmMatches, waitForUniqueDeleteAction } from './fresh-editor-actions.mjs';
import { waitForPublishSignal, verifyFrontInstance, choosePublishMenuItem, publishStageDiagnostics } from './publish-confirm.mjs';
import { inspectActiveModuleLibraryOpener, probeModuleLibraryModes,
  waitForUniqueVisibleModuleLibraryPanel } from './module-library-browser.mjs';
import { RAIL, openRailPanel, readSchemeColor, readModuleWidth, cancelColorPanel, cancelWidthPanel } from './capabilities/rail.mjs';
import { waitForEditorLoadingToClear } from './ui-waits.mjs';

const wrapSelector = (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`;

export function resolveFreshPageTarget(target, pageItem) {
  const page = target.name || pageItem?.name || pageItem?.title;
  if (!page) throw new Error('Selected page has no resolved display name for editor reload/readback.');
  return { ...target, page, kind: target.kind };
}

async function listInstances(frame) {
  return frame.locator('body').evaluate((body, id) => {
    const all = [...body.querySelectorAll('.siteblocks-setting-wrap[data-appid]')];
    return all.flatMap((element) => {
      const blockId = element.getAttribute('data-appid');
      const rect = element.getBoundingClientRect();
      const attrs = [...element.attributes, ...[...element.querySelectorAll('*')].flatMap((node) => [...node.attributes])];
      const settingId = attrs.find((attr) => /setting.?id/i.test(attr.name))?.value || '';
      return [{ blockId: String(blockId), settingId,
        ordinal: all.filter((candidate) => candidate.getAttribute('data-appid') === String(blockId)).indexOf(element),
        position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        text: (element.innerText || '').slice(0, 400) }];
    });
  });
}

async function locateInstance(frame, instance) {
  if (!instance?.settingId || !Number.isInteger(instance.ordinal)) {
    throw new Error('Block instance has no unique settingId/ordinal; refusing destructive editor action.');
  }
  const wraps = frame.locator(wrapSelector(instance.blockId));
  const wrap = wraps.nth(instance.ordinal);
  const current = await wrap.evaluate((element) => {
    const attrs = [...element.attributes, ...[...element.querySelectorAll('*')].flatMap((node) => [...node.attributes])];
    return { settingId: attrs.find((attr) => /setting.?id/i.test(attr.name))?.value || '' };
  });
  if (current.settingId !== instance.settingId) {
    throw new Error('Block instance identity changed before action; refusing to continue.');
  }
  return wrap;
}

export function freshRailInventoryRegions(color, width) {
  const widthControls = (width?.radios || []).map((radio, index) => ({ index, tag: 'INPUT', type: 'radio',
    name: 'modulewidth', label: radio.label || '', value: radio.value, checked: Boolean(radio.checked), disabled: false }));
  const customIndex = widthControls.length;
  widthControls.push({ index: customIndex, tag: 'INPUT', type: 'text', name: '', label: '自定义宽度',
    value: width?.customVal ?? '', checked: false, disabled: false });
  widthControls.push({ index: customIndex + 1, tag: 'INPUT', type: 'checkbox', name: 'globalApply', label: '全局应用',
    value: 'on', checked: Boolean(width?.globalApply), disabled: false });
  const colorControls = typeof color === 'string' ? [{ index: 0, tag: 'INPUT', type: 'text', name: 'scheme-color',
    label: '配色方案', value: color, checked: false, disabled: false }] : (color?.controls || []).map((control, index) => ({
    index, tag: 'INPUT', type: 'color', name: control.name || control.identity || '',
    label: control.label || `Color input at position ${index + 1}`, value: control.value ?? null, checked: false,
    disabled: false, role: control.role || 'textbox', position: control.position, identity: control.identity,
    inventoryNote: control.inventoryNote || (!control.identifiable ? 'Color input identity is ambiguous; skipped for setting mapping.' : undefined),
  }));
  return [
    { title: 'right-rail-color', type: 'rail:color-scheme', wrapIndex: 0, kind: 'right-rail-flyout',
      controls: colorControls, ...(color?.notes?.length ? { notes: color.notes } : {}) },
    { title: 'right-rail-width', type: 'rail:module-width', wrapIndex: 0, kind: 'right-rail-flyout', controls: widthControls },
  ];
}

export function createFreshBlockBrowserAdapter({ config, session, targetPage, settingsAdapter, discoverAndPrepareSettings }) {
  let page = session.page;
  let frame;
  let pageItem;
  let resolvedTarget;
  const readFreshInventory = async () => {
    let color;
    try {
      await openRailPanel(frame, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
      color = await readSchemeColor(frame);
    } catch (error) {
      color = { status: 'panel-unavailable', controls: [], notes: [error.message] };
    } finally {
      try { await cancelColorPanel(frame); } catch (error) {
        color = { ...(typeof color === 'object' ? color : {}), status: color?.status || 'panel-close-unavailable',
          controls: typeof color === 'object' ? color.controls || [] : [],
          notes: [...(typeof color === 'object' ? color.notes || [] : []), error.message] };
      }
    }
    await openRailPanel(frame, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
    let width;
    try { width = await readModuleWidth(frame); } finally { await cancelWidthPanel(frame); }
    // Keep the button popover last: its verified close operation confirms
    // unchanged values when no non-saving dismissal is available.
    return [...freshRailInventoryRegions(color, width),
      ...await inventorySettings({ page, canvas: frame, config, blockId: config.blockId, degradeInventoryErrors: true })];
  };
  const selectedCreated = (instance) => ({ blockId: String(config.blockId), settingId: instance.settingId,
    ordinal: instance.ordinal, position: instance.position });

  const adapter = {
    get batchAdapter() { return settingsAdapter.prepared?.batchAdapter || settingsAdapter.batchAdapter; },
    async openPage(target) {
      page = (await openEditor(page, config)).page;
      // openEditor may return a newly opened pagebuilder tab. Keep the shared
      // session reference aligned so capability save callbacks use that tab.
      session.page = page;
      const selected = await gotoFreshTargetPage(page, { ...target, blockId: config.blockId });
      frame = selected.frame;
      pageItem = selected.pageItem || { pageurl: target.url || '' };
      resolvedTarget = resolveFreshPageTarget(target, pageItem);
      config.resolvedTarget = resolvedTarget;
      return { editorLink: target.editorHref || page.url(), frontLink: target.url || pageItem.pageurl || null };
    },
    async verifyModuleAvailability(blockId) {
      // Match the same canvas-scoped, first active opener used by addBlockIfNeeded.
      // The editor can keep hidden duplicate openers mounted for other layouts.
      const { locator: addButton, matchCount: openerCount } = await inspectActiveModuleLibraryOpener(frame);
      config.moduleLibraryOpenerMatchCount = openerCount;
      if (openerCount !== 1) {
        const error = new Error(`Module-library opener matched ${openerCount} controls; stopped before opening any mode.`);
        error.environment = true;
        error.code = 'ENV_MODULE_LIBRARY_OPENER_UNAVAILABLE';
        error.libraryLookup = ['review', 'develop', 'online'].map((mode) => ({ mode,
          query: String(blockId), found: false, searched: false, status: 'not-attempted', screenshot: null,
          waitedForLazyResults: false, scrolledToEnd: false,
          error: 'Stopped before opening the module library; this mode was not entered.' }));
        throw error;
      }
      await addButton.first().click({ timeout: config.actionTimeoutMs });
      const panel = await waitForUniqueVisibleModuleLibraryPanel(page, config.actionTimeoutMs);
      let lookup;
      try { lookup = await probeModuleLibraryModes({ page, panel, frame, targetBlockId: blockId, config }); }
      finally {
        const close = panel.locator('.addmodules_searchContainer > .block-iconbaseline-close');
        if (await close.count() === 1 && await close.first().isVisible()) await close.first().click({ timeout: 5_000 });
        else await page.keyboard.press('Escape').catch(() => {});
        await panel.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
      }
      if (lookup.some((mode) => mode.found)) return { openerMatchCount: openerCount, lookup };
      const completeSearch = lookup.every((mode) => mode.searched && mode.status === 'checked' && !mode.error);
      const error = new Error(completeSearch
        ? `区块 ${blockId} 在模块列表中未找到；已按目标编号查询全部可用模式。`
        : `无法完成区块 ${blockId} 的模块库编号搜索。`);
      error.libraryLookup = lookup;
      error.openerMatchCount = openerCount;
      if (!completeSearch) { error.environment = true; error.code = 'ENV_LIBRARY_SEARCH_UNAVAILABLE'; }
      throw error;
    },
    async listAllBlockInstances() { return listInstances(frame); },
    async waitForInventoryReady({ timeoutMs } = {}) {
      const options = { timeoutMs: Math.min(Number(timeoutMs) || 15_000, Number(config.inventoryOverlayTimeoutMs) || 15_000), intervalMs: 100 };
      await waitForEditorLoadingToClear(page, options);
      await waitForEditorLoadingToClear(frame, options);
      await frame.locator('body').waitFor({ state: 'visible', timeout: options.timeoutMs });
    },
    async prepareSettings() {
      const args = { page, canvas: frame, frame, config };
      const inventory = await readFreshInventory();
      if (discoverAndPrepareSettings) {
        return discoverAndPrepareSettings({ ...args, inventory });
      }
      return settingsAdapter.prepare({ ...args, inventory });
    },
    async deleteBlockInstance(instance) {
      if (String(instance.blockId) !== String(config.blockId)) {
        throw new Error('Deletion is restricted to the configured target block number.');
      }
      await deleteInstance(instance);
    },
    async addDefaultBlock(blockId) {
      const before = (await listInstances(frame)).filter((item) => item.blockId === String(blockId));
      const result = await addBlockIfNeeded(page, frame, { ...config, blockId, addAnotherInstance: true });
      if (!result.added || result.countAfter !== before.length + 1) throw new Error('Fresh add did not create exactly one new block instance.');
      const after = (await listInstances(frame)).filter((item) => item.blockId === String(blockId));
      const created = after.filter((item) => !before.some((prior) => prior.settingId && prior.settingId === item.settingId));
      if (created.length !== 1 || !created[0].settingId) throw new Error('Could not uniquely identify the newly added block instance.');
      return selectedCreated(created[0]);
    },
    async savePage() { await savePage(page); },
    async reloadPage() {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      // The reload is scoped to the editor URL and returns to the same explicit page.
      const selected = await gotoFreshTargetPage(page, resolvedTarget);
      frame = selected.frame;
    },
    async discardUnsavedChanges() {
      const onDialog = (dialog) => {
        if (dialog.type() === 'beforeunload') return dialog.accept();
        return dialog.dismiss();
      };
      page.on('dialog', onDialog);
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      } finally {
        page.off('dialog', onDialog);
      }
      const selected = await gotoFreshTargetPage(page, resolvedTarget);
      frame = selected.frame;
      pageItem = selected.pageItem || pageItem;
    },
    async writeStopReport(report) {
      const projectRoot = config.projectRoot || process.cwd();
      const directory = path.resolve(projectRoot, config.reportDir || 'reports');
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, `fresh-block-${config.blockId}-${Date.now()}-pre-save-stop.json`);
      await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
      console.error(`[fresh-block] pre-save guard report: ${file}`);
      return file;
    },
    async readDefaults() {
      const inventory = await readFreshInventory();
      const values = currentValuesFromInventory(inventory);
      values.inventoryErrors = inventory.filter((region) => region.inventoryError).map((region) => region.inventoryError);
      return values;
    },
    async readCurrentValues() {
      return currentValuesFromInventory(await readFreshInventory());
    },
    async readPublishedValues(instance) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      const selected = await gotoFreshTargetPage(page, resolvedTarget);
      frame = selected.frame;
      pageItem = selected.pageItem || pageItem;
      const instances = await listInstances(frame);
      const targets = instances.filter((item) => item.blockId === String(config.blockId));
      if (targets.length !== 1 || String(targets[0].settingId) !== String(instance.settingId)) {
        throw new Error(`Post-publish readback expected one fresh instance ${instance.settingId}; found ${targets.length} target instances.`);
      }
      return currentValuesFromInventory(await readFreshInventory());
    },
    async captureFailureScreenshot({ runId, stage }) {
      const projectRoot = config.projectRoot || process.cwd();
      const directory = path.resolve(projectRoot, config.reportDir || 'reports', 'screenshots');
      await fs.mkdir(directory, { recursive: true });
      const safe = (value) => String(value || 'failure').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 100);
      const file = path.join(directory, `fresh-${safe(runId)}-${safe(stage)}.png`);
      await page.screenshot({ path: file, fullPage: true, timeout: 30_000 });
      return file;
    },
    async publishPage({ settingId } = {}) {
      let stage = 'close-page-chooser';
      const readVisibility = async () => page.evaluate(() => {
        const visible = (element) => element.getClientRects().length > 0
          && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
        return {
          chooserVisibleCount: [...document.querySelectorAll('.backstage-topToolbar-pageBox a[data-href]')].filter(visible).length,
          publishMenuVisibleCount: [...document.querySelectorAll('.backstage-publish-type > div')].filter(visible).length,
          confirmDialogVisibleCount: [...document.querySelectorAll('.backstage-dialog')].filter(visible).length,
        };
      }).catch(() => ({ chooserVisibleCount: -1, publishMenuVisibleCount: -1, confirmDialogVisibleCount: -1 }));
      try {
        const toolbar = page.locator('.backstage-topToolbar');
        await closeToolbarMenusBeforeAction(page);
        const afterDismiss = await readVisibility();
        if (afterDismiss.chooserVisibleCount !== 0) throw new Error('页面选择菜单未关闭；拒绝打开发布菜单。');
        stage = 'open-publish-dropdown';
        const publish = toolbar.locator('button,a,[role="button"]');
        const publishIndexes = await exactActionIndexes(publish, /^(发布|发布网站)$/);
        if (publishIndexes.length !== 1) throw new Error(`页面发布控件匹配 ${publishIndexes.length} 个；拒绝把保存按钮当作发布操作。`);
        await publish.nth(publishIndexes[0]).click();
        // This flow is approved to publish only the selected page. Never offer
        // or accept the whole-site action here.
        const menu = toolbar.locator('.backstage-publish-type > div');
        await menu.first().waitFor({ state: 'visible', timeout: Number(config.publishMenuTimeoutMs) || 5_000 });
        const labels = await menu.evaluateAll((nodes) => nodes.map((n) => (n.getClientRects().length ? n.textContent : '')));
        stage = 'select-current-page-publish';
        await menu.nth(choosePublishMenuItem(labels, 'current')).click();
        // A confirmation dialog is required; absence must never be treated as
        // a successful publish or silently skipped.
        stage = 'wait-confirm-dialog';
        const dialog = page.locator('.backstage-dialog:visible');
        await dialog.first().waitFor({ state: 'visible', timeout: Number(config.publishDialogTimeoutMs) || 5_000 });
        if (await dialog.count() !== 1) throw new Error(`发布确认对话框可见数量为 ${await dialog.count()}；拒绝确认。`);
        stage = 'confirm-current-page-publish';
        const confirm = dialog.locator('button,a,[role="button"]');
        const indexes = await exactActionIndexes(confirm, /^(发布|确定)$/);
        if (indexes.length !== 1) throw new Error('发布确认控件不唯一。');
        await confirm.nth(indexes[0]).click();
        stage = 'wait-publish-success';
        const publishSignal = await waitForPublishSignal({
          timeoutMs: Number(config.publishSignalTimeoutMs) || 60_000,
          readTexts: () => page.evaluate(() => [...document.querySelectorAll(
            '[class*="message"],[class*="toast"],[class*="notice"],[class*="tip"],[role="alert"],.backstage-dialog')]
            .filter((el) => el.getClientRects().length).map((el) => el.innerText)).catch(() => []),
        });
        if (publishSignal.status !== 'confirmed') throw new Error(publishSignal.status === 'failed'
          ? `编辑器提示发布失败：${publishSignal.signal}` : '等待编辑器发布成功信号超时。');
        stage = 'verify-cache-busted-front';
        let frontLink = resolvedTarget.kind === 'system' ? resolvedTarget.url : pageItem?.pageurl;
        const scheme = (config.frontScheme || process.env.FRONT_SCHEME || 'http').replace(/:.*$/, '');
        if (frontLink && !/^https?:\/\//i.test(frontLink)) frontLink = new URL(frontLink, `${scheme}://${config.siteDomain}`).href;
        const frontVerification = frontLink && settingId !== undefined
          ? await verifyFrontInstance({ url: frontLink, blockId: config.blockId, settingId: settingId || null,
            attempts: Number(config.frontVerifyAttempts) || 6, delayMs: Number(config.frontVerifyDelayMs) || 10_000,
            fetchText: async (url) => { const r = await page.context().request.get(url, { timeout: 30_000 }); return { status: r.status(), text: await r.text() }; } })
          : { status: 'skipped' };
        return { frontLink, publishedAt: new Date().toISOString(), publishSignal, frontVerification,
          confirmed: publishSignal.status === 'confirmed' && frontVerification.status === 'present' };
      } catch (error) {
        const visibility = await readVisibility();
        error.publishDiagnostics = publishStageDiagnostics({ stage, ...visibility });
        throw error;
      }
    },
    editorLink: () => page.url(),
  };

  async function exactActionIndexes(locator, pattern) {
    return locator.evaluateAll((nodes, source) => nodes.flatMap((element, index) => {
      const label = [element.innerText, element.getAttribute('title'), element.getAttribute('aria-label')]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      return new RegExp(source).test(label) ? [index] : [];
    }), pattern.source);
  }

  async function actionDescriptors(locator) {
    return locator.evaluateAll((nodes) => nodes.map((element) => ({
      dataId: element.getAttribute('data-id'),
      // Several toolbar actions have visible child labels whose innerText is
      // empty in this editor iframe. textContent reads the persisted DOM label.
      text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
      title: element.getAttribute('title'), ariaLabel: element.getAttribute('aria-label'),
      iconClasses: [...element.querySelectorAll('[class]')].map((node) => String(node.className?.baseVal || node.className || '')),
      visible: Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none',
    })));
  }

  async function deleteInstance(instance) {
    if (String(instance.blockId) !== String(config.blockId)) throw new Error('Refusing to delete a non-target block number.');
    await closeToolbarMenusBeforeAction(page);
    const wrap = await locateInstance(frame, instance);
    await wrap.scrollIntoViewIfNeeded();
    await wrap.click();
    await closeToolbarMenusBeforeAction(page);
    // The editor action is keyed to the selected wrap by data-id. Avoid a
    // version-specific toolbar-container class; require both exact delete
    // wording and a trash/delete icon on the identity-bound action.
    const targetDataId = `siteblocks-setting-wrap-${instance.settingId}`;
    const selector = `[data-id=${JSON.stringify(targetDataId)}]`;
    const selectedAction = await waitForUniqueDeleteAction({ settingId: instance.settingId,
      timeoutMs: Math.min(Number(config.deleteToolbarTimeoutMs) || 10_000, 15_000),
      readScopes: async () => {
        const scopes = [{ name: 'page', locator: page.locator(selector) },
          ...page.frames().filter((candidate) => candidate !== page.mainFrame())
            .map((candidate, index) => ({ name: `frame-${index}`, locator: candidate.locator(selector) }))];
        return Promise.all(scopes.map(async (scope) => ({ ...scope, actions: await actionDescriptors(scope.locator) })));
      } });
    await selectedAction.locator.nth(selectedAction.index).click();
    const dialogSelector = '[role="dialog"]:visible,[role="alertdialog"]:visible,.backstage-dialog:visible,.layui-layer:visible,.el-message-box:visible';
    const dialogScopes = [{ name: 'page', locator: page.locator(dialogSelector) },
      ...page.frames().filter((candidate) => candidate !== page.mainFrame())
        .map((candidate, index) => ({ name: `frame-${index}`, locator: candidate.locator(dialogSelector) }))];
    const dialogs = [];
    for (const scope of dialogScopes) {
      const count = await scope.locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) dialogs.push({ scope: scope.name, locator: scope.locator.nth(index) });
    }
    if (dialogs.length > 1) throw new Error(`Delete opened ${dialogs.length} possible confirmation dialogs; refusing to guess.`);
    if (dialogs.length === 1) {
      const dialog = dialogs[0].locator;
      const message = (await dialog.evaluate((element) => element.textContent || '')).replace(/\s+/g, ' ').trim();
      if (!/(删除|delete|remove)/i.test(message)) throw new Error('Delete confirmation content is unrecognized; refusing to confirm.');
      const confirmations = dialog.locator('button,a,[role="button"]');
      const confirmMatches = matchingDeleteConfirmMatches([{ name: dialogs[0].scope, locator: confirmations,
        actions: await actionDescriptors(confirmations) }]);
      if (confirmMatches.length !== 1) throw new Error(`Delete confirmation action matched ${confirmMatches.length}; refusing to guess.`);
      await confirmMatches[0].locator.nth(confirmMatches[0].index).click();
    }
    await wrap.waitFor({ state: 'detached', timeout: 15_000 });
    await savePage(page);
  }

  return adapter;
}
