// Read-only right-rail inventory. This is deliberately separate from baseline capture.
import { RAIL, selectBlock, visibleRailIndex, openRailPanel, readModuleWidth, cancelWidthPanel } from './capabilities/rail.mjs';

export async function inventoryRightPanel({ page, canvas, config, blockId, onProgress }) {
  const regions = [];
  let icons;
  try {
    await selectBlock(canvas, blockId);
    const rail = canvas.locator(RAIL.rail).nth(await visibleRailIndex(canvas));
    icons = await rail.evaluate((root) => [...root.children].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }).map(el => ({ title: el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title') || '',
      className: String(el.className || ''), text: (el.innerText || '').trim(),
      color: el.matches('.backstage-container-color') || !!el.querySelector('.backstage-container-color, .backstage-container-color a'),
      width: el.matches('.block_telescopic') || !!el.querySelector('.block_telescopic') })));
  } catch (error) {
    return [{ kind: 'rail-icon', type: 'rail:inventory', title: '右侧图标栏', wrapIndex: 0, controls: [], skipped: error.message }];
  }
  for (const [index, icon] of icons.entries()) {
    onProgress?.({ index: index + 1, total: icons.length, title: icon.title || icon.text || icon.className });
    const kind = icon.color ? 'color-scheme' : icon.width ? 'module-width' : null;
    if (!kind) {
      regions.push({ kind: 'rail-icon', type: 'rail:icon', wrapIndex: index, title: icon.title || icon.text || icon.className,
        controls: [{ type: 'icon', label: icon.title, context: icon.text, value: icon.className }] });
      continue;
    }
    const region = { kind: 'right-panel', type: `rail:${kind}`, wrapIndex: index, title: icon.title || icon.text || kind, controls: [] };
    try {
      await openRailPanel(canvas, blockId, kind === 'color-scheme' ? RAIL.colorIcon : RAIL.widthIcon,
        kind === 'color-scheme' ? RAIL.colorPanel : RAIL.widthPanel);
      if (kind === 'color-scheme') {
        // A scheme can hold several colors (colorVal0..N); read them all, read-only.
        const inputs = await canvas.locator(`${RAIL.colorPanel}:visible`).first().locator(RAIL.colorInput)
          .evaluateAll((nodes) => nodes.map((n) => ({ name: n.name || '', value: n.value })));
        region.controls.push(...inputs.map((c, i) => ({ type: 'color', label: `配色${i + 1}`, name: c.name, value: c.value })));
      }
      else {
        const value = await readModuleWidth(canvas);
        region.controls.push(...value.radios.map(r => ({ type: 'radio', label: r.label, value: r.value, checked: r.checked })),
          { type: 'text', label: '自定义宽度', value: value.customVal },
          { type: 'checkbox', label: '全局应用', checked: value.globalApply },
          { type: 'value', label: '生效宽度', value: value.effective });
      }
    } catch (error) { region.skipped = error.message; }
    finally {
      try {
        if (kind === 'module-width' && await canvas.locator(`${RAIL.widthPanel}:visible`).count()) await cancelWidthPanel(canvas);
        if (kind === 'color-scheme' && await canvas.locator(`${RAIL.colorPanel}:visible`).count()) {
          const rail = canvas.locator(RAIL.rail).nth(await visibleRailIndex(canvas));
          await rail.locator(RAIL.colorIcon).first().click();
          await canvas.locator(`${RAIL.colorPanel}:visible`).first().waitFor({ state: 'hidden', timeout: 10000 });
        }
      } catch (error) { region.skipped = [region.skipped, `关闭面板失败：${error.message}`].filter(Boolean).join('；'); }
    }
    regions.push(region);
  }
  return regions;
}
