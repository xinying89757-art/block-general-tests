// Read-only fresh-flow probe for capability surface close controls.
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, gotoFreshTargetPage } from '../../src/editor.mjs';
import { clickSettings } from '../../src/capabilities/shared.mjs';
import { openRailPanel, readModuleWidth, readSchemeColor, RAIL } from '../../src/capabilities/rail.mjs';

const config = loadConfig();
const target = { kind: 'system', id: process.env.FRESH_PAGE_ID, url: process.env.FRESH_PAGE_URL,
  blockId: config.blockId };
if (!config.siteDomain || !target.id || !target.url) throw new Error('Explicit site and system-page config are required.');
let { browser, page } = await launchSession(config);
const evidence = { siteHost: new URL(`https://${config.siteDomain}`).host, blockId: config.blockId,
  pageId: target.id, pageUrl: target.url, surfaces: {} };
try {
  ({ page } = await openEditor(page, config));
  const selected = await gotoFreshTargetPage(page, target);
  const canvas = selected.frame;
  const instances = await canvas.locator(`.siteblocks-setting-wrap[data-appid=${JSON.stringify(config.blockId)}]`).count();
  if (instances !== 1) throw new Error(`Expected exactly one approved target block; found ${instances}.`);

  await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
  evidence.surfaces.rightRailColor = { value: await readSchemeColor(canvas),
    actions: await canvas.locator(`${RAIL.colorPanel}:visible`).first().evaluate((panel) =>
      [...panel.querySelectorAll('button,a,[role="button"]')].map((el) => ({
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(), title: el.getAttribute('title'),
        ariaLabel: el.getAttribute('aria-label'),
      }))), };
  await page.keyboard.press('Escape');
  evidence.surfaces.rightRailColor.escapeDismissed = await canvas.locator(`${RAIL.colorPanel}:visible`).count() === 0;
  if (!evidence.surfaces.rightRailColor.escapeDismissed) {
    const selectedRail = canvas.locator(`${RAIL.rail}:visible`).first();
    await selectedRail.locator(RAIL.colorIcon).click();
    evidence.surfaces.rightRailColor.iconDismissed = await canvas.locator(`${RAIL.colorPanel}:visible`).count() === 0;
    if (!evidence.surfaces.rightRailColor.iconDismissed) throw new Error('Color flyout did not close by Escape or its own toggle; stopped read-only probe.');
  }

  await openRailPanel(canvas, config.blockId, RAIL.widthIcon, RAIL.widthPanel);
  const widthPanel = canvas.locator(`${RAIL.widthPanel}:visible`).first();
  evidence.surfaces.rightRailWidth = { value: await readModuleWidth(canvas), actions:
    await widthPanel.evaluate((panel) => [...panel.querySelectorAll('button,a,[role="button"]')].map((el) =>
      (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)) };
  const cancel = widthPanel.getByText('取消', { exact: true });
  evidence.surfaces.rightRailWidth.cancelCount = await cancel.count();
  if (evidence.surfaces.rightRailWidth.cancelCount !== 1) throw new Error('Width flyout has no unique non-saving cancel control.');
  await cancel.click();
  evidence.surfaces.rightRailWidth.cancelDismissed = await canvas.locator(`${RAIL.widthPanel}:visible`).count() === 0;
  if (!evidence.surfaces.rightRailWidth.cancelDismissed) throw new Error('Width flyout remained open after its cancel control.');

  await clickSettings(canvas, config, 'phoenix_blocks_button');
  const popoverInfo = await canvas.locator('body').evaluate((body) => {
    const visible = (el) => Boolean(el.getClientRects().length) && getComputedStyle(el).display !== 'none'
      && getComputedStyle(el).visibility !== 'hidden';
    const boxes = [...body.querySelectorAll('.editor-box')].filter(visible);
    return boxes.map((box) => ({ text: (box.innerText || '').replace(/\s+/g, ' ').trim(),
      controls: [...box.querySelectorAll('input,textarea')].map((el) => ({ type: el.type, value: el.value })),
      nearbyActions: [...(box.parentElement?.querySelectorAll('button,a,[role="button"]') || [])]
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean) }));
  });
  evidence.surfaces.canvasPopover = { candidates: popoverInfo };
  await page.keyboard.press('Escape');
  let visiblePopoverCount = await canvas.locator('.editor-box:visible').count();
  evidence.surfaces.canvasPopover.escapeDismissed = visiblePopoverCount === 0;
  if (visiblePopoverCount) {
    await page.mouse.click(2, 2);
    visiblePopoverCount = await canvas.locator('.editor-box:visible').count();
    evidence.surfaces.canvasPopover.neutralDismissed = visiblePopoverCount === 0;
  }
  // Never click 保存 in this read-only probe. Closing the browser discards any UI-only state.
  evidence.surfaces.canvasPopover.dismissedWithoutSave = visiblePopoverCount === 0;
} finally {
  await browser.close();
}
console.log(JSON.stringify(evidence, null, 2));
