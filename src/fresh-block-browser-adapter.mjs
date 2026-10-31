import { addBlockIfNeeded, gotoFreshTargetPage, openEditor, savePage } from './editor.mjs';
import { inventorySettings } from './baseline.mjs';
import { currentValuesFromInventory } from './fresh-settings-adapter.mjs';
import { matchingDeleteActionIndexes, matchingDeleteConfirmIndexes } from './fresh-editor-actions.mjs';

const wrapSelector = (id) => `.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(id))}]`;

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

export function createFreshBlockBrowserAdapter({ config, session, targetPage, settingsAdapter }) {
  let page = session.page;
  let frame;
  let pageItem;
  let resolvedTarget;
  const selectedCreated = (instance) => ({ blockId: String(config.blockId), settingId: instance.settingId,
    ordinal: instance.ordinal, position: instance.position });

  const adapter = {
    batchAdapter: settingsAdapter.batchAdapter,
    async openPage(target) {
      page = (await openEditor(page, config)).page;
      resolvedTarget = target;
      const selected = await gotoFreshTargetPage(page, { ...target, blockId: config.blockId });
      frame = selected.frame;
      pageItem = selected.pageItem || { pageurl: target.url || '' };
      return { editorLink: page.url(), frontLink: target.url || pageItem.pageurl || null };
    },
    async listAllBlockInstances() { return listInstances(frame); },
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
    async readDefaults() {
      return currentValuesFromInventory(await inventorySettings({ page, canvas: frame, config, blockId: config.blockId }));
    },
    async readCurrentValues() {
      return currentValuesFromInventory(await inventorySettings({ page, canvas: frame, config, blockId: config.blockId }));
    },
    async publishPage() {
      const toolbar = page.locator('.backstage-topToolbar');
      const publish = toolbar.locator('button,a,[role="button"]');
      const publishIndexes = await exactActionIndexes(publish, /^(发布|发布网站)$/);
      if (publishIndexes.length !== 1) throw new Error(`页面发布控件匹配 ${publishIndexes.length} 个；拒绝把保存按钮当作发布操作。`);
      await publish.nth(publishIndexes[0]).click();
      const dialog = page.locator('.backstage-dialog:visible');
      if (await dialog.count()) {
        const confirm = dialog.locator('button,a,[role="button"]');
        const indexes = await exactActionIndexes(confirm, /^(发布|确定)$/);
        if (indexes.length !== 1) throw new Error('发布确认控件不唯一。');
        await confirm.nth(indexes[0]).click();
      }
      await page.waitForTimeout(1_000);
      let frontLink = resolvedTarget.kind === 'system' ? resolvedTarget.url : pageItem?.pageurl;
      if (frontLink && !/^https?:\/\//i.test(frontLink)) frontLink = new URL(frontLink, `https://${config.siteDomain}`).href;
      return { frontLink, publishedAt: new Date().toISOString() };
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
      text: (element.innerText || '').replace(/\s+/g, ' ').trim(),
      title: element.getAttribute('title'), ariaLabel: element.getAttribute('aria-label'),
      iconClasses: [...element.querySelectorAll('[class]')].map((node) => String(node.className?.baseVal || node.className || '')),
      visible: Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden'
        && getComputedStyle(element).display !== 'none',
    })));
  }

  async function deleteInstance(instance) {
    if (String(instance.blockId) !== String(config.blockId)) throw new Error('Refusing to delete a non-target block number.');
    const wrap = await locateInstance(frame, instance);
    await wrap.scrollIntoViewIfNeeded();
    await wrap.click();
    // The editor action is keyed to the selected wrap by data-id. Avoid a
    // version-specific toolbar-container class; require both exact delete
    // wording and a trash/delete icon on the identity-bound action.
    const targetDataId = `siteblocks-setting-wrap-${instance.settingId}`;
    const candidates = frame.locator(`[data-id=${JSON.stringify(targetDataId)}]`);
    const indexes = matchingDeleteActionIndexes(await actionDescriptors(candidates), instance.settingId);
    if (indexes.length !== 1) throw new Error(`Selected block delete control is ambiguous (${indexes.length}); nothing was deleted.`);
    await candidates.nth(indexes[0]).click();
    const dialogs = page.locator('[role="dialog"]:visible,[role="alertdialog"]:visible,.backstage-dialog:visible,.layui-layer:visible,.el-message-box:visible');
    const dialogCount = await dialogs.count();
    if (dialogCount > 1) throw new Error(`Delete opened ${dialogCount} possible confirmation dialogs; refusing to guess.`);
    if (dialogCount === 1) {
      const dialog = dialogs.first();
      const message = (await dialog.innerText()).replace(/\s+/g, ' ').trim();
      if (!/(删除|delete|remove)/i.test(message)) throw new Error('Delete confirmation content is unrecognized; refusing to confirm.');
      const confirmations = dialog.locator('button,a,[role="button"]');
      const indexes = matchingDeleteConfirmIndexes(await actionDescriptors(confirmations));
      if (indexes.length !== 1) throw new Error(`Delete confirmation action matched ${indexes.length}; refusing to guess.`);
      await confirmations.nth(indexes[0]).click();
    }
    await wrap.waitFor({ state: 'detached', timeout: 15_000 });
    await savePage(page);
  }

  return adapter;
}
