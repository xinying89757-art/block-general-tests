// Read-only control-shape inspection for one existing block instance.
// Opens its editor settings and color rail, records only style-shaped values
// and structural metadata, then closes surfaces without saving or publishing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.mjs';
import { launchSession } from '../../src/browser.mjs';
import { openEditor, gotoFreshTargetPage } from '../../src/editor.mjs';
import { inventorySettings } from '../../src/baseline.mjs';
import { RAIL, openRailPanel, readSchemeColor, cancelColorPanel } from '../../src/capabilities/rail.mjs';
import { snapshotInstanceComputedStyles } from '../../src/style-effect-learning.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = loadConfig();
config.projectRoot = root;
config.siteDomain = new URL(/^https?:\/\//i.test(config.siteDomain)
  ? config.siteDomain : `https://${config.siteDomain}`).host.toLowerCase();
const targetSettingId = String(process.env.TARGET_SETTING_ID || '').trim();
const profile = JSON.parse(await fs.readFile(path.join(root, 'profiles', `${config.blockId}.json`), 'utf8'));
const siteData = JSON.parse(await fs.readFile(path.join(root, 'sites', config.siteDomain, 'pages.json'), 'utf8'));
const pageConfig = Object.entries(siteData.pages || {}).find(([key, item]) =>
  String(item.id) === String(profile.target?.pageId || '')
  || item.name === profile.target?.page || item.page === profile.target?.page
  || key === profile.target?.page)?.[1];
if (siteData.siteHost !== config.siteDomain || !pageConfig) throw new Error('Host-scoped target page configuration did not resolve uniquely.');

const safeStyleValue = (value) => {
  const text = String(value ?? '').trim();
  if (/^#[\da-f]{3,8}$/i.test(text) || /^rgba?\([\d.,%\s]+\)$/i.test(text)) return { kind: 'color', value: text };
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ex|ch|lh|rlh|vw|vh|vmin|vmax|%|pt|pc|cm|mm|in)$/i.test(text)) {
    return { kind: 'css-length', value: text };
  }
  return { kind: null, value: null };
};
const secretLike = (value) => /password|token|secret|credential|cookie|authorization|密钥|密码/i.test(String(value || ''));

let session;
const report = { schemaVersion: 1, flow: 'read-only-style-control-inspection', blockId: String(config.blockId),
  targetSettingId: targetSettingId || null, siteHost: config.siteDomain,
  page: { id: pageConfig.id, url: pageConfig.url }, inspectedAt: new Date().toISOString(),
  mutations: { settingsChanged: false, pageSaved: false, published: false },
  colorPanel: null, settingsDialogs: null };
try {
  session = await launchSession(config);
  const opened = await openEditor(session.page, config);
  session.page = opened.page;
  const selected = await gotoFreshTargetPage(session.page, { kind: 'system', id: pageConfig.id,
    url: pageConfig.url, blockId: config.blockId });
  const canvas = selected.frame;
  const instances = await canvas.locator('body').evaluate((body, blockId) =>
    [...body.querySelectorAll(`.siteblocks-setting-wrap[data-appid="${CSS.escape(blockId)}"]`)].map((node) => {
      const attrs = [...node.attributes, ...[...node.querySelectorAll('*')].flatMap((child) => [...child.attributes])];
      return { settingId: attrs.find((item) => /setting.?id/i.test(item.name))?.value || '',
        identityAttributes: attrs.filter((item) => /setting.?id/i.test(item.name)
          || (item.name === 'data-id' && String(item.value).startsWith('siteblocks-setting-wrap-')))
          .map((item) => ({ name: item.name, value: item.value })) };
    }), String(config.blockId));
  if (instances.length !== 1 || !instances[0].settingId || (targetSettingId && instances[0].settingId !== targetSettingId)) {
    throw new Error(`Target instance identity guard failed: found ${instances.length} instance(s); no panel was opened.`);
  }
  report.targetSettingId = instances[0].settingId;
  report.canvasIdentityDiagnostics = await canvas.locator('body').evaluate((body, { blockId, settingId }) => {
    const appRoots = [...body.querySelectorAll('[data-appid]')].filter((node) => node.getAttribute('data-appid') === blockId);
    const wrappers = [...body.querySelectorAll('.siteblocks-setting-wrap[data-appid]')]
      .filter((node) => node.getAttribute('data-appid') === blockId);
    const matches = wrappers.filter((node) => {
      const attrs = [...node.attributes, ...[...node.querySelectorAll('*')].flatMap((child) => [...child.attributes])];
      return attrs.some((item) => (/setting.?id/i.test(item.name)
        || (item.name === 'data-id' && String(item.value).startsWith('siteblocks-setting-wrap-')))
        && String(item.value).replace(/^siteblocks-setting-wrap-/, '')
          === String(settingId).replace(/^siteblocks-setting-wrap-/, ''));
    });
    return { dataAppIdRootCount: appRoots.length, settingWrapperCount: wrappers.length,
      identityMatchCount: matches.length, targetIdentityAttributes: instancesSafe(matches[0]) };
    function instancesSafe(node) {
      if (!node) return [];
      return [...node.attributes, ...[...node.querySelectorAll('*')].flatMap((child) => [...child.attributes])]
        .filter((item) => /setting.?id/i.test(item.name)
          || (item.name === 'data-id' && String(item.value).startsWith('siteblocks-setting-wrap-')))
        .map((item) => ({ name: item.name, value: item.value }));
    }
  }, { blockId: String(config.blockId), settingId: String(report.targetSettingId) });

  // Read computed style values on the exact canvas instance before opening
  // controls. This is observational only; no page or setting write occurs.
  const canvasStyleSnapshot = await snapshotInstanceComputedStyles(canvas, { blockId: config.blockId,
    settingId: report.targetSettingId, properties: ['color', 'backgroundColor', 'borderColor', 'outlineColor',
      'fill', 'stroke', 'boxShadow', 'backgroundImage'] });
  report.canvasStyleSnapshot = canvasStyleSnapshot.status === 'ok'
    ? { status: 'ok', elementCount: canvasStyleSnapshot.elements.length,
      computedStyles: canvasStyleSnapshot.elements.map((entry) => ({ ...entry.styles, pseudo: entry.pseudoStyles })) }
    : { status: canvasStyleSnapshot.status || 'unavailable', reason: canvasStyleSnapshot.reason || 'snapshot-unavailable',
      instanceMatchCount: canvasStyleSnapshot.matchCount ?? null };
  if (report.canvasIdentityDiagnostics.identityMatchCount === 1) {
    report.editorCanvasStylesByTargetRoot = await canvas.locator('body').evaluate((body, { blockId, settingId }) => {
      const wrappers = [...body.querySelectorAll('.siteblocks-setting-wrap[data-appid]')]
        .filter((node) => node.getAttribute('data-appid') === blockId);
      const matches = wrappers.filter((node) => [...node.attributes, ...[...node.querySelectorAll('*')]
        .flatMap((child) => [...child.attributes])].some((item) => /setting.?id/i.test(item.name)
          && String(item.value).replace(/^siteblocks-setting-wrap-/, '')
            === String(settingId).replace(/^siteblocks-setting-wrap-/, '')));
      if (matches.length !== 1) return { status: 'unavailable', matchCount: matches.length };
      const properties = ['color', 'backgroundColor', 'borderColor', 'outlineColor', 'fill', 'stroke',
        'boxShadow', 'backgroundImage'];
      const read = (node, pseudo = null) => {
        const style = getComputedStyle(node, pseudo);
        const svgPaint = node.namespaceURI === 'http://www.w3.org/2000/svg';
        return Object.fromEntries(properties.map((property) => [property,
          (property === 'fill' || property === 'stroke') && !svgPaint ? null : style[property] || null]));
      };
      const root = matches[0];
      const nodes = [root, ...root.querySelectorAll('*')];
      return { status: 'ok', elementCount: nodes.length, computedStyles: nodes.map((node) => ({
        ...read(node), before: read(node, '::before'), after: read(node, '::after') })) };
    }, { blockId: String(config.blockId), settingId: String(report.targetSettingId) });
  }

  await openRailPanel(canvas, config.blockId, RAIL.colorIcon, RAIL.colorPanel);
  try {
    const panel = canvas.locator(`${RAIL.colorPanel}:visible`);
    report.colorPanel = await panel.evaluate((element) => {
      const secretLike = (value) => /password|token|secret|credential|cookie|authorization|密钥|密码/i.test(String(value || ''));
      const visible = (node) => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { rendered: node.getClientRects().length > 0, display: style.display,
          visibility: style.visibility, width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      const chain = (node) => {
        const result = [];
        for (let current = node, depth = 0; current && current !== element.parentElement && depth < 5;
          current = current.parentElement, depth += 1) {
          result.push({ tag: current.tagName.toLowerCase(), classes: String(current.className?.baseVal || current.className || '').slice(0, 180),
            role: current.getAttribute('role'), type: current.getAttribute('type'), ...visible(current) });
          if (current === element) break;
        }
        return result;
      };
      const inputs = [...element.querySelectorAll('input, textarea, select')].map((node, index) => {
        const name = node.getAttribute('name') || '';
        const rawValue = secretLike(name) ? '' : (node.value ?? '');
        return { index, tag: node.tagName.toLowerCase(), type: node.getAttribute('type') || '',
          name: secretLike(name) ? '[redacted]' : name, classes: String(node.className || '').slice(0, 180),
          value: safeShape(rawValue), visibility: visible(node), ancestors: chain(node),
          pickerProxyCount: node.parentElement?.querySelectorAll('.sp-replacer, [role="colorpicker"], [data-color-picker]').length || 0 };
      });
      const interactiveStyleNodes = [...element.querySelectorAll('button, [role="button"], [role="colorpicker"], .sp-replacer')]
        .map((node, index) => ({ index, tag: node.tagName.toLowerCase(), role: node.getAttribute('role'),
          classes: String(node.className || '').slice(0, 180), titlePresent: Boolean(node.getAttribute('title')),
          ariaLabelPresent: Boolean(node.getAttribute('aria-label')), visibility: visible(node) }));
      return { panelCount: 1, inputs, interactiveStyleNodes,
        readResult: undefined };
      function safeShape(value) {
        const text = String(value ?? '').trim();
        if (/^#[\da-f]{3,8}$/i.test(text) || /^rgba?\([\d.,%\s]+\)$/i.test(text)) return { kind: 'color', value: text };
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ex|ch|lh|rlh|vw|vh|vmin|vmax|%|pt|pc|cm|mm|in)$/i.test(text)) return { kind: 'css-length', value: text };
        return { kind: null };
      }
    });
    const read = await readSchemeColor(canvas);
    report.colorPanel.readResult = typeof read === 'string' ? safeStyleValue(read) : {
      status: read?.status || 'unresolved', visibleInputCount: read?.controls?.length || 0,
      noteCount: read?.notes?.length || 0,
      controls: (read?.controls || []).map((control, index) => ({ index,
        value: safeStyleValue(control.value), identity: String(control.identity || '').slice(0, 100) })) };
  } finally { await cancelColorPanel(canvas); }

  const inventory = await inventorySettings({ page: session.page, canvas, config,
    blockId: config.blockId, degradeInventoryErrors: true });
  report.settingsDialogs = inventory.map((region) => ({ regionType: region.type, wrapIndex: region.wrapIndex,
    kind: region.kind || 'settings-dialog', title: region.title || null,
    skipped: region.skipped || null,
    styleControls: (region.controls || []).flatMap((control, index) => {
      const shaped = safeStyleValue(control.value);
      const kind = control.type === 'color' || control.valueKind === 'color' ? 'color'
        : /font[\s_-]*size|fontsize/i.test(String(control.type || control.role || control.property || '')) ? 'font-size'
          : shaped.kind === 'color' ? 'color' : null;
      return kind ? [{ index, tag: control.tag || null, type: control.type || '', role: control.role || null,
        valueKind: kind, value: shaped.value, label: String(control.label || '').slice(0, 80),
        name: secretLike(control.name) ? '[redacted]' : String(control.name || '').slice(0, 80) }] : [];
    }) }));
} finally {
  await session?.browser.close();
}

const outputPath = path.join(root, 'reports', `g48-style-inspection-${config.blockId}-${Date.now()}.json`);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputPath: path.relative(root, outputPath), blockId: report.blockId,
  settingId: report.targetSettingId, dialogCount: report.settingsDialogs?.length,
  colorInputCount: report.colorPanel?.inputs?.length, colorReadStatus: report.colorPanel?.readResult,
  styleControlCount: report.settingsDialogs?.reduce((sum, item) => sum + item.styleControls.length, 0),
  changed: report.mutations }, null, 2));
