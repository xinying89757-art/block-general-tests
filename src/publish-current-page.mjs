import { closeToolbarMenusBeforeAction } from './editor.mjs';
import { choosePublishMenuItem, waitForPublishSignal } from './publish-confirm.mjs';

async function exactAction(locator, pattern) {
  const hits = [];
  for (let i = 0; i < await locator.count(); i++) {
    if (await locator.nth(i).isVisible() && pattern.test((await locator.nth(i).innerText()).trim())) hits.push(i);
  }
  if (hits.length !== 1) throw new Error(`Expected one action, found ${hits.length}.`);
  return locator.nth(hits[0]);
}

export async function publishCurrentPage(page) {
  await closeToolbarMenusBeforeAction(page);
  const toolbar = page.locator('.backstage-topToolbar');
  await (await exactAction(toolbar.locator('button,a,[role="button"]'), /^(发布|发布网站)$/)).evaluate((el) => el.click());
  const menu = toolbar.locator('.backstage-publish-type > div');
  await menu.first().waitFor({ state: 'visible', timeout: 5000 });
  const labels = await menu.evaluateAll((nodes) => nodes.map((n) => (n.getClientRects().length ? n.textContent : '')));
  await menu.nth(choosePublishMenuItem(labels, 'current')).evaluate((el) => el.click());
  const confirmDialog = page.locator('.backstage-dialog:visible').filter({ hasText: '发布前请先确认以下设置项' });
  await confirmDialog.first().waitFor({ state: 'visible', timeout: 5000 });
  if (await confirmDialog.count() !== 1) throw new Error('Publish confirmation dialog is not unique.');
  const acknowledgment = confirmDialog.getByText('我已确认', { exact: true });
  if (await acknowledgment.count() === 1) {
    const acknowledged = await acknowledgment.evaluate((el) => {
      const container = el.closest('label') || el.parentElement;
      const checkbox = container?.querySelector('input[type="checkbox"]');
      if (checkbox) return checkbox.checked;
      return container?.getAttribute('aria-checked') === 'true' || container?.classList.contains('checked');
    });
    if (!acknowledged) await acknowledgment.evaluate((el) => el.click());
  }
  await (await exactAction(confirmDialog.locator('button,a,[role="button"]'), /^(发布|确定)$/)).evaluate((el) => el.click());
  const signal = await waitForPublishSignal({
    readTexts: () => page.evaluate(() => [...document.querySelectorAll('[class*="message"],[class*="toast"],[class*="notice"],[class*="tip"],[role="alert"],.backstage-dialog')]
      .filter((el) => el.getClientRects().length).map((el) => el.innerText)),
  });
  if (signal.status !== 'confirmed') throw new Error(`Editor did not confirm current-page publish: ${signal.status}`);
  return { status: 'confirmed', signal: signal.signal, publishedAt: new Date().toISOString(), scope: 'current' };
}
