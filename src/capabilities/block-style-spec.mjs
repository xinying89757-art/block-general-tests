// Block style spec: design-file conformance + breakage checks.
//
// The capability is generic: every expected value lives in the profile
// (capability.styleSpec), never in this file. Each block has its own design
// file and its own values; a new block only needs a styleSpec entry, produced
// by scripts/figma-style-extract.mjs and confirmed once by a human (mapping
// Figma node -> DOM selector, which items are hard asserts vs record).
//
// Viewports: pc compares against the design frame; pad/mobile have no design
// frame for 另一样本区块 (styleSpec.designFrames lists only "pc"), so those run
// breakage checks only (horizontal overflow, sticking out, overlap, text
// clipping, image distortion) plus screenshots for human review.
// Two assertion kinds: computed values (fontSize/color/...) and geometry
// (e.g. text centered in its box — lineHeight/textAlign are NOT compared
// when flex does the centering, per the 另一样本区块 button/pagination lesson).
import { checkReportText } from './shared.mjs';
import { markUniqueFrontInstance } from '../front-instance-root.mjs';
import { chooseSelectorCandidate } from '../style-effect-learning.mjs';
import { extractWrittenColorValues, runDesignSpecFrontChecks, runWrittenColorFrontChecks } from '../design-spec-checklist.mjs';

const SUITE = 'capability:block-style-spec';
export const freshSettings = Object.freeze({ status: 'check-only', runPostPublish: runFreshStyleChecks });
let styleExpectations = {};
const isNullColorPlaceholder = (item) => item?.autoLearned && item.props && Object.keys(item.props).some((property) => /color|fill|stroke/i.test(property))
  && Object.values(item.props).length && Object.values(item.props).every((value) => value === null || value === undefined);

function result(id, status, detail, evidence, textFields = {}) {
  return {
    id, name: NAMES[id] || (id.startsWith('bss-auto-style-') ? '自动样式值检查' : id), suite: SUITE, status, detail,
    ...checkReportText(NAMES[id] || (id.startsWith('bss-auto-style-') ? '自动样式值检查' : id), status, detail, evidence, id),
    ...(styleExpectations[id] ? { expected: styleExpectations[id] } : {}), ...textFields,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

const NAMES = {
  'bss-button-text': '按钮文字样式',
  'bss-button-bg': '按钮背景样式',
  'bss-nav-parent': '分类导航父级样式',
  'bss-nav-leaf': '分类导航叶子样式',
  'bss-filter-title': '筛选组标题样式',
  'bss-filter-option': '筛选值样式',
  'bss-product-name': '产品名样式',
  'bss-product-name-clamp': '产品名行数限制',
  'bss-details-link': '产品卡 details 链接',
  'bss-pagination-current': '分页当前页样式',
  'bss-pagination-other': '分页非当前页样式',
  'bss-breakage-pc': 'PC 端样式错乱检查',
  'bss-breakage-pad': 'Pad 端样式错乱检查',
  'bss-breakage-mobile': '移动端样式错乱检查',
};

export async function runFreshStyleChecks(args) {
  const { session, capability, config, frontLink, published, settingsReport, instance, profile } = args;
  const front = frontLink || published?.frontLink;
  if (!front || !session?.context?.newPage) {
    const unavailable = unavailableStyleResults(capability, '发布后无法从当前执行环境打开前台页面；需前台机器运行此能力的既有样式断言。');
    const design = await runDesignSpecFrontChecks(profile, { page: null, rootSelector: null, frontChecks: unavailable, settingsReport });
    const written = extractWrittenColorValues(settingsReport).length
      ? await runWrittenColorFrontChecks({ page: null, rootSelector: null, settingsReport }) : [];
    return [...unavailable, ...design.filter(Boolean), ...written];
  }
  let page;
  let markedRoot;
  try {
    page = await session.context.newPage();
    const url = /^https?:\/\//i.test(front) ? front : new URL(front, `https://${config.siteDomain}`).href;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
    markedRoot = await markUniqueFrontInstance(page, { blockId: config.blockId, settingId: instance?.settingId });
    const rootSelector = markedRoot.selector;
    await page.locator(rootSelector).waitFor({ state: 'attached', timeout: config.actionTimeoutMs });
    const styleChecks = await runFrontLayer({ frame: page, previewPage: page,
      config: { ...config, rootSelector, settingId: instance?.settingId, settingsReport },
      capability: { ...capability, designSpec: profile?.designSpec } });
    const designChecks = await runDesignSpecFrontChecks(profile, { page, rootSelector, frontChecks: styleChecks,
      settingsReport, viewport: { label: 'pc', width: 1440, height: 900 } });
    const writtenColorChecks = extractWrittenColorValues(settingsReport).length
      ? await runWrittenColorFrontChecks({ page, rootSelector, settingsReport }) : [];
    return [...styleChecks, ...designChecks.filter(Boolean), ...writtenColorChecks];
  } catch (error) {
    return unavailableStyleResults(capability,
      `发布后前台样式断言当前不可达（${error.message}）；需前台机器运行此能力的既有样式断言。`);
  } finally {
    try { await markedRoot?.clear(); } catch {}
    if (page && !page.isClosed()) await page.close().catch(() => {});
  }
}

function unavailableStyleResults(capability, reason) {
  const records = new Map((capability?.styleSpec?.recordOnly || []).map((item) => [item.id, item]));
  return styleCheckDescriptors(capability).map(({ id, name }) => {
    const itemId = id.replace(/^bss-/, '');
    const record = records.get(itemId);
    return record
      ? result(id, 'record', record.note, { inventoryCapability: record.inventoryCapability || null, visualOracle: 'unreviewed' }, { name: record.name || name })
      : result(id, 'deferred', reason, undefined, { name });
  });
}

const normColor = (c) => {
  const m = (c || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return (c || '').toLowerCase();
  const [r, g, b] = m[1].split(',').map((x) => parseInt(x.trim(), 10));
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const px = (v) => {
  const n = parseFloat(String(v ?? '').replace('px', ''));
  return Number.isFinite(n) ? n : null;
};
// Size measurements are rounded to CSS pixels in the reader. A delta strictly
// below the configured tolerance is accepted; a full 2px delta remains visible
// as a mismatch (e.g. 30px vs 28px with the default tolerance).
const close = (a, b, tol, exclusive = false) => a != null && b != null
  && (exclusive ? Math.abs(a - b) < tol : Math.abs(a - b) <= tol);

const SIZE_PROPERTIES = new Set(['fontSize', 'lineHeight', 'borderRadius', 'letterSpacing', 'width', 'height']);

export function compareProps(expected, actual, tolerances = {}) {
  const diffs = [];
  const { px = 0.6, sizePx = 2 } = typeof tolerances === 'number' ? { px: tolerances, sizePx: tolerances } : tolerances;
  const names = { fontSize: '字号', fontWeight: '字重', lineHeight: '行高', color: '文字颜色',
    backgroundColor: '背景色', borderColor: '边框色', borderRadius: '圆角', textAlign: '对齐方式',
    letterSpacing: '字距', width: '宽', height: '高' };
  for (const [k, want] of Object.entries(expected)) {
    const got = actual[k];
    let ok;
    if (typeof want === 'number') ok = close(got, want, SIZE_PROPERTIES.has(k) ? sizePx : px, SIZE_PROPERTIES.has(k));
    else ok = String(got ?? '').toLowerCase() === String(want).toLowerCase();
    const unit = ['fontSize', 'lineHeight', 'borderRadius', 'letterSpacing', 'width', 'height'].includes(k) ? 'px' : '';
    const shownWant = typeof want === 'number' ? `${want}${unit}` : want;
    const measured = got == null ? '实测未取到' : `实测为 ${typeof got === 'number' ? `${got}${unit}` : got}`;
    if (!ok) diffs.push(`${names[k] || k}设计为 ${shownWant}，${measured}`);
  }
  return diffs;
}

export const PAGINATION_CONTAINER_PATTERN = 'pagination|pager|page[-_ ]?nav|分页';
export function isPaginationContainerMetadata({ tagName = '', role = '', ariaLabel = '', id = '', className = '' } = {}) {
  return new RegExp(PAGINATION_CONTAINER_PATTERN, 'i').test([tagName, role, ariaLabel, id, className].join(' '));
}

// Read the elements one styleSpec item needs, inside the block root.
async function readItem(frame, rootSel, item) {
  return frame.evaluate(({ rootSel, item }) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector(rootSel);
    if (!root) return { error: '预览里没有找到按实例身份圈定的区块根节点', matchedCount: 0 };
    let selectionRoot = root;
    if (item.scope?.containerKind === 'pagination') {
      const candidates = [...root.querySelectorAll('*')].filter((node) =>
        new RegExp(item.paginationContainerPattern, 'i').test([
          node.tagName, node.getAttribute('role'), node.getAttribute('aria-label'), node.id,
          typeof node.className === 'string' ? node.className : '',
        ].filter(Boolean).join(' ')));
      const selector = item.selector || item.selectorCandidates?.[0];
      const containing = candidates.filter((container) => {
        try { return Boolean(selector && container.querySelector(selector)); } catch { return false; }
      });
      const innermost = containing.filter((container) => !containing.some((other) =>
        other !== container && container.contains(other)));
      if (innermost.length !== 1) return { error: innermost.length
        ? '目标区块内分页容器不唯一。' : '目标区块内没有包含画像候选元素的分页容器。',
      matchedCount: 0, paginationContainerCount: innermost.length };
      selectionRoot = innermost[0];
    }
    const scopedSelect = (selector) => selector === ':scope' ? [selectionRoot] : [...selectionRoot.querySelectorAll(selector)];
    if (Array.isArray(item.selectorCandidates)) {
      const candidates = [...new Set([item.selector, ...item.selectorCandidates].filter(Boolean))];
      for (const candidate of candidates) {
        try { if (selectionRoot.querySelectorAll(candidate).length) { item.selector = candidate; break; } } catch {}
      }
    }
    item.selector ||= item.selectorCandidates?.[0] || null;
    const cs = (el) => getComputedStyle(el);
    const num = (el, prop) => { const n = parseFloat(cs(el)[prop]); return Number.isFinite(n) ? n : null; };
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && cs(el).visibility !== 'hidden'; };
    const styleOf = (el) => ({
      fontSize: num(el, 'fontSize'),
      fontWeight: parseInt(cs(el).fontWeight, 10) || null,
      lineHeight: num(el, 'lineHeight'),
      color: cs(el).color,
      backgroundColor: cs(el).backgroundColor,
      borderColor: cs(el).borderColor,
      borderRadius: num(el, 'borderRadius'),
      textAlign: cs(el).textAlign,
      letterSpacing: num(el, 'letterSpacing'),
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height),
    });
    const centered = (el) => {
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let textNode = null;
      while (walker.nextNode()) {
        if (norm(walker.currentNode.textContent)) { textNode = walker.currentNode; break; }
      }
      if (!textNode) return null;
      range.selectNodeContents(textNode);
      const t = range.getBoundingClientRect();
      const o = el.getBoundingClientRect();
      if (!t.width || !t.height) return null;
      return {
        dxLeft: +(t.left - o.left).toFixed(1), dxRight: +(o.right - t.right).toFixed(1),
        dyTop: +(t.top - o.top).toFixed(1), dyBottom: +(o.bottom - t.bottom).toFixed(1),
      };
    };
    const out = { elements: [] };
    const push = (el, label) => {
      const entry = { label, ...styleOf(el) };
      if (item.geometry?.centered) entry.centered = centered(el);
      out.elements.push(entry);
    };
    switch (item.kind) {
      case 'text-content': {
        if (item.text === null || item.text === undefined || String(item.text) === '') {
          out.matchedCount = 0;
          out.error = item.valueResolutionReason || 'expected-text-unresolved';
          break;
        }
        const needle = norm(item.text);
        const matches = [...selectionRoot.querySelectorAll('*')].filter((el) => norm(el.innerText) === needle && vis(el));
        out.matchedCount = matches.length;
        out.elements = matches.slice(0, item.sample ?? 2).map((el) => ({ label: needle, ...styleOf(el) }));
        break;
      }
      case 'text': {
        const matches = [...selectionRoot.querySelectorAll(item.selector)].filter((x) => norm(x.innerText) === item.text);
        out.matchedCount = matches.length;
        const el = matches[0];
        if (el) push(el, item.text);
        break;
      }
      case 'first': {
        const matches = scopedSelect(item.selector);
        out.matchedCount = matches.length;
        const el = matches[0];
        if (el) push(el, item.name || item.kind || 'matched element');
        break;
      }
      case 'sample': {
        const found = scopedSelect(item.selector).filter(vis);
        out.matchedCount = found.length;
        const els = found.slice(0, item.sample ?? 2);
        els.forEach((el) => push(el, norm(el.innerText).slice(0, 24)));
        break;
      }
      case 'nav-parent': {
        let links = scopedSelect(item.selector || '.pf-cate-wrap a').filter(vis);
        let parents;
        if (!links.length) {
          // Generic fallback: derive candidate links from the selected
          // instance's own list hierarchy; never search page-wide or guess a
          // block-specific class. If the hierarchy has no semantic evidence,
          // the existing zero-match result remains a skip/na.
          links = [...selectionRoot.querySelectorAll('a, [role="link"]')].filter(vis);
          out.candidateSource = 'instance-root-semantic-hierarchy';
          out.derivedCandidateCount = links.length;
          if (!links.length) {
            parents = [...selectionRoot.querySelectorAll('li,[role="treeitem"],[aria-level]')].filter((node) => vis(node)
              && (node.querySelector('ul,ol,[role="group"]') || Number(node.getAttribute('aria-level') || 0) === 1));
          }
        }
        parents ||= links.filter((a) => {
          const li = a.closest('li');
          return li && li.parentElement?.closest('li') == null && li.querySelector('ul');
        });
        out.matchedCount = parents.length;
        parents.slice(0, 2).forEach((el) => push(el, norm(el.innerText).slice(0, 24)));
        break;
      }
      case 'nav-leaf': {
        let links = scopedSelect(item.selector || '.pf-cate-wrap a').filter(vis);
        let leaves;
        if (!links.length) {
          links = [...selectionRoot.querySelectorAll('a, [role="link"]')].filter(vis);
          out.candidateSource = 'instance-root-semantic-hierarchy';
          out.derivedCandidateCount = links.length;
          if (!links.length) leaves = [...selectionRoot.querySelectorAll('li,[role="treeitem"],[aria-level]')].filter((node) => {
            if (!vis(node) || node.querySelector('ul,ol,[role="group"]')) return false;
            const level = Number(node.getAttribute('aria-level') || 0);
            return level > 1 || Boolean(node.closest('ul,ol')?.parentElement?.closest('li'));
          });
        }
        leaves ||= links.filter((a) => {
          const li = a.closest('li');
          return li && li.parentElement?.closest('li') && !li.querySelector('ul');
        });
        out.matchedCount = leaves.length;
        leaves.slice(0, 2).forEach((el) => push(el, norm(el.innerText).slice(0, 24)));
        break;
      }
      case 'presence': {
        const selector = item.selector || 'a, button, span';
        const needle = String(item.text || '').trim().toLowerCase();
        const found = scopedSelect(selector).filter((el) => {
          const candidates = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')]
            .map((value) => norm(value).toLowerCase()).filter(Boolean);
          return candidates.includes(needle) && vis(el);
        });
        out.count = found.length;
        out.cardCount = [...root.querySelectorAll('.prodlist-pro-name')].filter(vis).length;
        out.searchedSources = ['visible text', 'aria-label', 'title'];
        break;
      }
      case 'record-only': {
        out.recordOnly = true;
        out.note = item.note || 'No reviewed front-end selector or visual oracle is available.';
        out.inventoryCapability = item.inventoryCapability || null;
        out.matchedCount = 0;
        break;
      }
      default:
        out.error = `未知 styleSpec kind: ${item.kind}`;
    }
    return out;
  }, { rootSel, item: { ...item, paginationContainerPattern: PAGINATION_CONTAINER_PATTERN } });
}

// Breakage checks (no design frame needed): horizontal overflow, elements
// sticking out of the block wrap, overlapping leaf text, clipped text,
// distorted images. Returns findings; empty means clean.
export async function breakage(frame, rootSel, { mobile = false } = {}) {
  return frame.evaluate(({ rootSel, mobile }) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector(rootSel);
    if (!root) return { error: 'no root' };
    const rootBox = root.getBoundingClientRect();
    const pageLevelOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const instanceOverflow = root.scrollWidth > root.clientWidth + 1 || rootBox.left < -1 || rootBox.right > window.innerWidth + 1;
    const res = { viewportWidth: window.innerWidth, docScrollWidth: document.documentElement.scrollWidth,
      rootMatchedCount: document.querySelectorAll(rootSel).length,
      horizontalOverflow: pageLevelOverflow,
      horizontalOverflowScope: pageLevelOverflow ? 'page-wide' : 'none',
      blockOverflow: instanceOverflow,
      overflowAttribution: { pageLevel: pageLevelOverflow, instance: instanceOverflow,
        source: pageLevelOverflow && instanceOverflow ? 'page-and-instance'
          : pageLevelOverflow ? 'page-level-outside-instance' : instanceOverflow ? 'instance-only' : 'none' },
      blockRoot: rootSel };
    const wrapBox = root.getBoundingClientRect();
    const sticking = [];
    const selectorPath = (el) => {
      const parts = [];
      let node = el;
      while (node && node !== root) {
        const tag = node.tagName.toLowerCase();
        const classes = [...node.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join('');
        const siblings = node.parentElement ? [...node.parentElement.children].filter((sibling) => sibling.tagName === node.tagName) : [];
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : '';
        parts.unshift(`${tag}${classes}${nth}`);
        node = node.parentElement;
      }
      return parts.join(' > ') || root.tagName.toLowerCase();
    };
    const visibleForOverlap = (el) => {
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return false;
      for (let current = el; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
          || Number(style.opacity || 1) <= 0) return false;
        if (current === root) break;
      }
      for (let current = el.parentElement; current; current = current.parentElement) {
        const ancestorBox = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        const clipLeft = ancestorBox.left + current.clientLeft;
        const clipTop = ancestorBox.top + current.clientTop;
        const clipRight = clipLeft + current.clientWidth;
        const clipBottom = clipTop + current.clientHeight;
        if (['hidden', 'clip'].includes(style.overflowX)
          && (box.left < clipLeft - 0.5 || box.right > clipRight + 0.5)) return false;
        if (['hidden', 'clip'].includes(style.overflowY)
          && (box.top < clipTop - 0.5 || box.bottom > clipBottom + 0.5)) return false;
        if (current === root) break;
      }
      return true;
    };
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(el);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
      let overlayPosition = false;
      for (let current = el; current && current !== root; current = current.parentElement) {
        const position = getComputedStyle(current).position;
        if (position === 'fixed' || position === 'sticky') { overlayPosition = true; break; }
      }
      if (!visible || (mobile && overlayPosition)) continue;
      if (r.right > wrapBox.right + 1.5 || r.left < wrapBox.left - 1.5) {
        const t = norm(el.innerText).slice(0, 30);
        if (t || el.tagName === 'IMG') sticking.push({ tag: el.tagName, selector: selectorPath(el), text: t, overRight: Math.round(r.right - wrapBox.right), overLeft: Math.round(wrapBox.left - r.left) });
        if (sticking.length >= 10) break;
      }
    }
    res.stickingOut = sticking;
    const leaves = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const hasTextChild = [...node.childNodes].some((n) => n.nodeType === 3 && norm(n.textContent));
      const hasElChildWithText = [...node.children].some((c) => norm(c.innerText));
      if (!hasTextChild || hasElChildWithText) continue;
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(node);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity || 1) === 0
        || (mobile && !visibleForOverlap(node))) continue;
      const withinRoot = r.left >= wrapBox.left - 1 && r.right <= wrapBox.right + 1
        && r.top >= wrapBox.top - 1 && r.bottom <= wrapBox.bottom + 1;
      let overlayPosition = false;
      for (let current = node; current && current !== root; current = current.parentElement) {
        const position = getComputedStyle(current).position;
        if (position === 'fixed' || position === 'sticky') { overlayPosition = true; break; }
      }
      leaves.push({ text: norm(node.innerText).slice(0, 24), box: r, element: node, withinRoot, overlayPosition });
    }
    const overlaps = [];
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i].box, b = leaves[j].box;
        const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const inter = ix * iy;
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        if (smaller > 0 && inter / smaller > 0.3) {
          const withinInstance = leaves[i].withinRoot && leaves[j].withinRoot;
          const pageOrOverlay = leaves[i].overlayPosition || leaves[j].overlayPosition;
          if (mobile && (!withinInstance || pageOrOverlay)) continue;
          overlaps.push({ a: leaves[i].text, b: leaves[j].text,
            aSelector: selectorPath(leaves[i].element), bSelector: selectorPath(leaves[j].element),
            ratio: +(inter / smaller).toFixed(2), withinInstance, pageOrOverlay,
            aPosition: getComputedStyle(leaves[i].element).position,
            bPosition: getComputedStyle(leaves[j].element).position });
          if (overlaps.length >= 10) break;
        }
      }
      if (overlaps.length >= 10) break;
    }
    res.overlaps = overlaps;
    const clipped = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.scrollWidth > el.clientWidth + 1) {
        const s = getComputedStyle(el);
        if (s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || 1) > 0
          && (!mobile || !['fixed', 'sticky'].includes(s.position))
          && (s.overflowX === 'hidden' || s.overflowX === 'clip' || s.textOverflow === 'ellipsis')) {
          clipped.push({ tag: el.tagName, selector: selectorPath(el), text: norm(el.innerText).slice(0, 30) });
          if (clipped.length >= 10) break;
        }
      }
    }
    res.textClipped = clipped;
    const imgs = [];
    for (const img of root.querySelectorAll('img')) {
      if (!img.naturalWidth || !img.complete) continue;
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const fit = getComputedStyle(img).objectFit;
      const disp = r.width / r.height, nat = img.naturalWidth / img.naturalHeight;
      if (fit !== 'cover' && Math.abs(disp - nat) / nat > 0.05) {
        imgs.push({ src: (img.currentSrc || img.src).slice(-40), disp: +disp.toFixed(2), nat: +nat.toFixed(2), fit });
        if (imgs.length >= 10) break;
      }
    }
    res.imgDistorted = imgs;
    return res;
  }, { rootSel, mobile });
}

export function isMobileInstanceOverlap(overlap) {
  // Legacy/modelled report rows without attribution are retained; live DOM
  // evidence always carries these flags and is filtered before serialization.
  return overlap?.withinInstance !== false && overlap?.pageOrOverlay !== true;
}

export function breakageFindings(b, { mobile = false } = {}) {
  const f = [];
  // Document overflow is reported as page-level information, not attributed to
  // this block. Mobile block failures require evidence inside the instance.
  if (b.blockOverflow) f.push('目标区块实例内部横向溢出');
  if (b.stickingOut?.length) f.push(`超框 ${b.stickingOut.length} 处：${b.stickingOut.map((x) => x.text || x.tag).join('、')}`);
  const overlaps = (b.overlaps || []).filter((overlap) => !mobile || isMobileInstanceOverlap(overlap));
  if (overlaps.length) f.push(`重叠 ${overlaps.length} 处：${overlaps.map((x) => `「${x.a}」压「${x.b}」`).join('、')}`);
  if (mobile && b.textClipped?.length) f.push(`实例内有 ${b.textClipped.length} 处可见文字被裁切：${b.textClipped.map((x) => x.text || x.selector || x.tag).join('、')}`);
  if (!mobile) {
    if (b.textClipped?.length) f.push(`文字被截 ${b.textClipped.length} 处：${b.textClipped.map((x) => x.text).join('、')}`);
    if (b.imgDistorted?.length) f.push(`图片失真 ${b.imgDistorted.length} 处`);
  }
  return f;
}

export function mobileChecklistMode(requirements = []) {
  return requirements.some((requirement) => requirement.params?.viewport === 'mobile'
    || requirement.checkType === 'mobile-layout') ? 'design-spec' : 'instance-integrity';
}

function pageOverflowFinding(b) {
  return b.horizontalOverflow
    ? `页面级横向溢出（文档宽 ${b.docScrollWidth} > 视口宽 ${b.viewportWidth}）；此项仅记录，不单独判为区块失败。` : null;
}

async function runFrontLayerRaw({ frame, previewPage, config, capability, onProgress, onCheck }) {
  const spec = capability?.styleSpec;
  styleExpectations = {};
  const propNames = { fontSize: '字号', fontWeight: '字重', lineHeight: '行高', color: '文字颜色',
    backgroundColor: '背景色', borderColor: '边框色', borderRadius: '圆角', textAlign: '对齐方式',
    letterSpacing: '字距', width: '宽', height: '高' };
  for (const item of spec?.items || []) {
    if (isNullColorPlaceholder(item)) continue;
    const id = `bss-${item.id}`;
    if (item.kind === 'presence') styleExpectations[id] = `每张产品卡下都应有“${item.text}”链接。`;
    else if (item.geometry?.centered) {
      const centeredProps = Object.entries(item.props || {}).filter(([key]) => key !== 'lineHeight' && key !== 'textAlign')
        .map(([key, value]) => `${propNames[key] || key}应为 ${value}${key === 'fontSize' ? 'px' : ''}`);
      styleExpectations[id] = `按钮文字应在按钮框内水平和垂直居中${centeredProps.length ? `，${centeredProps.join('、')}` : ''}。`;
    } else if (item.props && Object.keys(item.props).length) {
      const values = Object.entries(item.props).map(([key, value]) => {
        const unit = ['fontSize', 'lineHeight', 'borderRadius', 'letterSpacing', 'width', 'height'].includes(key)
          && typeof value === 'number' ? 'px' : '';
        return `${propNames[key] || key}应为 ${value}${unit}`;
      });
      const dimensionPair = item.props.width !== undefined && item.props.height !== undefined
        ? [`宽高应为 ${item.props.width}×${item.props.height}px`, ...values.filter((v) => !v.startsWith('宽应为 ') && !v.startsWith('高应为 '))]
        : values;
      styleExpectations[id] = `${item.text ? `“${item.text}”` : (NAMES[id] || '元素').replace(/(?:背景)?样式$/, '')}${dimensionPair.join('、')}。`;
    }
    if (item.kind === 'text-content') styleExpectations[id] = item.runValueSource
      ? `区块内应显示运行报告中唯一读取到的设置值${item.text ? `“${item.text}”` : ''}。`
      : `区块内应显示精确文本“${item.text}”。`;
    if (item.clamp) styleExpectations['bss-product-name-clamp'] = `产品名称最多显示 ${item.clamp} 行，超出部分应隐藏。`;
  }
  const skipAll = (reason) => Object.keys(NAMES).map((id) => result(id, 'skip', reason));
  if (!spec?.items?.length && !spec?.recordOnly?.length) return skipAll('未提供设计样式要求，未做样式比对。');
  const tolerances = { px: spec.tolerances?.px ?? 0.6, sizePx: spec.tolerances?.sizePx ?? 2 };
  const viewports = spec.viewports || { pc: 1440, pad: 768, mobile: 375 };
  const checks = [];
  const pushCheck = checks.push.bind(checks);
  checks.push = (...rows) => {
    for (const row of rows) { onCheck?.(row); onProgress?.(`style-check-complete id=${row.id} status=${row.status}`); }
    return pushCheck(...rows);
  };
  const rootSel = config.rootSelector;
  if (!rootSel) return skipAll('无法按区块编号与 settingId 唯一圈定实例根节点。');
  const shots = [];
  const shot = async (name) => {
    if (!previewPage) return;
    try {
      await frame.evaluate((rootSel) => {
        const root = document.querySelector(rootSel);
        if (root) window.scrollTo(0, Math.max(0, root.getBoundingClientRect().top + window.scrollY - 120));
      }, rootSel);
      await frame.waitForTimeout(1000);
      await previewPage.screenshot({ path: `screenshots/style-${config.blockId}-${name}.png` });
      shots.push(name);
    } catch {}
  };
  try {
    // PC: compare against the design frame.
    if (previewPage) {
      await previewPage.setViewportSize({ width: viewports.pc, height: 900 });
      await frame.waitForTimeout(2500);
    }
    for (const item of spec.items || []) {
      if (isNullColorPlaceholder(item)) continue;
      const checkId = `bss-${item.id}`;
      onProgress?.(`style-check-start id=${checkId}`);
      if (item.notApplicableReason) {
        checks.push(result(checkId, 'na', '未应用该样式检查。', { machineReason: {
          code: 'profile-selector-not-resolvable', details: String(item.notApplicableReason).slice(0, 240) } }));
        continue;
      }
      if (item.learnedSelectorRequired && item.selectorLearningUnavailable) {
        checks.push(result(checkId, 'na', '未应用该样式检查。', { machineReason: {
          code: 'no-style-effect-learned', fallbackCandidateCount: item.selectorCandidates?.length || 0 } }));
        continue;
      }
      if (Array.isArray(item.selectorCandidates) && item.selectorCandidates.length && !item.learnedSelectorResolved) {
        const candidates = [...new Set([item.selector, ...item.selectorCandidates].filter(Boolean))];
        let counts = [];
        try { counts = await frame.locator(rootSel).evaluate((root, selectors) => selectors.map((selector) => {
          try { return selector === ':scope' ? 1 : root.querySelectorAll(selector).length; } catch { return 0; }
        }), candidates); } catch {}
        const selected = chooseSelectorCandidate(candidates, counts);
        if (selected.status !== 'resolved') {
          checks.push(result(checkId, 'na', '未应用该样式检查。', { machineReason: {
            code: selected.reason, attemptedCandidateCount: selected.attemptedCount } }));
          continue;
        }
        item.selector = candidates[selected.index];
      }
      const applicability = resolveItemApplicability(item, config.settingsReport);
      if (!applicability.applicable) {
        checks.push(result(checkId, 'na', applicability.reason || '画像开关值表明此项不适用。',
          { applicabilitySource: applicability.source || null }));
        continue;
      }
      const notSetProperties = Object.entries(item.resolvedExpectedSources || {})
        .filter(([, source]) => source === 'not set this run').map(([property]) => property);
      if (notSetProperties.length) {
        checks.push(result(checkId, 'na', 'not set this run', {
          notSetProperties, expectedValueSource: 'run report contains no successful write for this setting',
        }, { name: item.name || NAMES[checkId] }));
        continue;
      }
      // Leaf nav links live in collapsed submenus by default; expand the
      // first parent before reading them (the arrow toggles the submenu,
      // it does not navigate).
      if (item.kind === 'nav-leaf') {
        await frame.evaluate((rootSel) => {
          const root = document.querySelector(rootSel);
          const arrow = root?.querySelector('.pf-cate-wrap .slight-submenu-button');
          arrow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }, rootSel);
        await frame.waitForTimeout(1200);
      }
      if (item.kind === 'presence') {
        const read = await readItem(frame, rootSel, item);
        if (read.error) { checks.push(result(checkId, 'skip', read.error, { matchedCount: read.matchedCount ?? 0 })); continue; }
        checks.push(result(checkId, read.count > 0 ? 'pass' : 'fail',
          read.count > 0 ? `${read.cardCount} 张产品卡中找到 ${read.count} 个“${item.text}”链接。`
            : `${read.cardCount} 张产品卡里一张都没找到“${item.text}”链接。`,
          { found: read.count, cards: read.cardCount, searchedSources: read.searchedSources }));
        continue;
      }
      if (item.kind === 'text-content') {
        const oracle = textContentOracle(item);
        if (oracle.status !== 'resolved') {
          checks.push(result(checkId, 'na', oracle.reason || 'expected-text-unresolved',
            { matchedCount: 0, machineReason: 'expected-text-unresolved' },
            { name: item.name || NAMES[checkId] }));
          continue;
        }
        const read = await readItem(frame, rootSel, item);
        const found = read.matchedCount > 0;
        checks.push(result(checkId, found ? 'pass' : 'fail', found
          ? `区块内找到预期文本“${item.text}”。` : `区块内没有找到预期文本“${item.text}”。`,
        { matchedCount: read.matchedCount, expectedText: item.text, locator: 'within the uniquely identified block instance' },
        { name: item.name || NAMES[checkId] }));
        continue;
      }
      const read = await readItem(frame, rootSel, item);
      if (read.error) { checks.push(result(checkId, 'skip', read.error, { matchedCount: read.matchedCount ?? 0 })); continue; }
      if (!read.elements.length) {
        const navigation = ['nav-parent', 'nav-leaf'].includes(item.kind);
        checks.push(result(checkId, navigation ? 'na' : 'skip', '在区块实例范围内没有找到符合画像候选特征的元素。',
          { matchedCount: read.matchedCount ?? 0, candidateSource: read.candidateSource || 'profile-candidates',
            machineReason: navigation ? 'no-semantic-link-hierarchy-in-instance' : 'no-profile-candidate-match' }));
        continue;
      }
      const diffs = [];
      const evidence = { matchedCount: read.matchedCount ?? read.elements.length,
        elements: read.elements.map((el) => ({ ...el, color: el.color ? normColor(el.color) : el.color, backgroundColor: el.backgroundColor ? normColor(el.backgroundColor) : el.backgroundColor })) };
      for (const el of read.elements) {
        const actual = { ...el };
        if (actual.color) actual.color = normColor(actual.color);
        if (actual.backgroundColor) actual.backgroundColor = normColor(actual.backgroundColor);
        if (actual.borderColor) actual.borderColor = normColor(actual.borderColor);
        diffs.push(...compareProps(item.props || {}, actual, tolerances).map((d) => `「${el.label}」${d}`));
        if (item.geometry?.centered) {
          const c = el.centered;
          if (!c) diffs.push(`「${el.label}」无法量到文字位置，居中未验证`);
          else if (Math.abs(c.dxLeft - c.dxRight) > 2 || Math.abs(c.dyTop - c.dyBottom) > 2) {
            diffs.push(`「${el.label}」文字不在框正中（左右 ${c.dxLeft}/${c.dxRight}，上下 ${c.dyTop}/${c.dyBottom}）`);
          }
        }
        if (item.recordProps) {
          evidence.recorded = evidence.recorded || {};
          for (const k of Object.keys(item.recordProps)) evidence.recorded[k] = el[k];
        }
      }
      checks.push(result(checkId, diffs.length ? 'fail' : 'pass',
        diffs.length ? diffs.join('；') : `与设计稿一致（${read.elements.length} 个元素）。`, evidence));
      // Product-name line clamp: design annotation 居中 最多2行隐藏.
      if (item.id === 'product-name' && item.clamp) {
        const clampDiffs = [];
        const clampRead = await frame.evaluate((rootSel) => {
          const root = document.querySelector(rootSel);
          const matches = [...root.querySelectorAll('.prodlist-pro-name')].filter((el) => el.getClientRects().length);
          return { matchedCount: matches.length, clamps: matches.slice(0, 2)
            .map((el) => ({ text: (el.innerText || '').trim().slice(0, 20), clamp: getComputedStyle(el).webkitLineClamp, overflow: getComputedStyle(el).overflow, display: getComputedStyle(el).display })) };
        }, rootSel);
        const clamps = clampRead.clamps;
        for (const c of clamps) {
          if (String(c.clamp) !== String(item.clamp)) clampDiffs.push(`「${c.text}」line-clamp: ${c.clamp}（设计 ${item.clamp} 行）`);
        }
        checks.push(result('bss-product-name-clamp', clampDiffs.length ? 'fail' : 'pass',
          clampDiffs.length ? clampDiffs.join('；') : `产品名最多 ${item.clamp} 行，超出隐藏（设计稿文字说明：居中 最多2行隐藏）。`,
          { matchedCount: clampRead.matchedCount, clamps }));
      }
    }
    for (const item of spec.recordOnly || []) {
      onProgress?.(`style-check-start id=bss-${item.id}`);
      checks.push(result(`bss-${item.id}`, 'record', item.note || 'No reviewed front-end selector or visual oracle is available.',
        { inventoryCapability: item.inventoryCapability || null, visualOracle: 'unreviewed' }, { name: item.name || item.id }));
    }
    const pcFailed = checks.some((c) => c.status === 'fail');
    const pcBreak = await breakage(frame, rootSel);
    const pcFindings = breakageFindings(pcBreak);
    const pcPageInfo = pageOverflowFinding(pcBreak);
    checks.push(result('bss-breakage-pc', pcFindings.length ? 'fail' : 'pass',
      pcFindings.length ? pcFindings.join('；') : [
        'PC 端目标实例无超框、重叠、截断与图片失真。', pcPageInfo,
      ].filter(Boolean).join(' '), { ...pcBreak, pageLevelFinding: pcPageInfo }));
    if (pcFailed || pcFindings.length) await shot('pc');
    // The fixed checklist catalogue is shared; mobile-specific expectations
    // stay in each profile. When present, evaluate those requirements at the
    // mobile viewport in addition to the instance-integrity check.
    for (const vp of ['pad', 'mobile']) {
      onProgress?.(`breakage-check-start viewport=${vp}`);
      if (!previewPage) { checks.push(result(`bss-breakage-${vp}`, 'skip', '未提供 previewPage，无法切换视口。')); continue; }
      await previewPage.setViewportSize({ width: viewports[vp], height: vp === 'pad' ? 1024 : 667 });
      await frame.waitForTimeout(2500);
      const mobileMode = mobileChecklistMode(capability?.designSpec?.requirements || []);
      if (vp === 'mobile' && mobileMode === 'design-spec') {
        const mobileStyleChecks = [];
        for (const item of spec?.items || []) {
          if (isNullColorPlaceholder(item)) continue;
          const read = await readItem(frame, rootSel, item);
          const actual = read.elements || [];
          const diffs = actual.flatMap((element) => compareProps(item.props || {}, element, tolerances));
          mobileStyleChecks.push(result(`bss-${item.id}`, read.error || !actual.length ? 'na' : diffs.length ? 'fail' : 'pass',
            read.error || (diffs.length ? diffs.join('；') : `移动视口下与清单一致（${actual.length} 个元素）。`),
            { ...read, viewport: 'mobile' }));
        }
        const responsiveChecklistChecks = await runDesignSpecFrontChecks({ designSpec: capability.designSpec }, {
          page: frame, rootSelector: rootSel, frontChecks: mobileStyleChecks, viewport: { label: 'mobile', width: viewports.mobile, height: 667 },
        });
        checks.push(...responsiveChecklistChecks.filter(Boolean));
      }
      const b = await breakage(frame, rootSel, { mobile: vp === 'mobile' });
      const findings = breakageFindings(b, { mobile: vp === 'mobile' });
      const pageInfo = pageOverflowFinding(b);
      checks.push(result(`bss-breakage-${vp}`, findings.length ? 'fail' : 'pass',
        findings.length ? findings.join('；') : [
        vp === 'mobile' && mobileChecklistMode(capability?.designSpec?.requirements || []) === 'design-spec'
          ? '移动端按清单逐项比较，并检查实例内部结构完整性。'
          : `清单无${vp === 'pad' ? 'Pad' : '移动'}端样式要求；只检查目标实例内部溢出、超框、重叠和裁切。`, pageInfo,
        ].filter(Boolean).join(' '), { ...b, pageLevelFinding: pageInfo }));
      if (findings.length) await shot(vp);
    }
  } finally {
    if (previewPage) {
      try { await previewPage.setViewportSize({ width: viewports.pc, height: 900 }); } catch {}
    }
  }
  return checks.map((check) => {
    if (check.status === 'pass') return check;
    const viewport = check.id.endsWith('-pad') ? 'pad' : check.id.endsWith('-mobile') ? 'mobile' : 'pc';
    if (!shots.includes(viewport)) return check;
    return { ...check, screenshot: `screenshots/style-${config.blockId}-${viewport}.png` };
  });
}

const styleViewport = (checkId, spec) => {
  const label = /breakage-pad$/.test(checkId) ? 'pad'
    : /breakage-mobile$/.test(checkId) ? 'mobile' : 'pc';
  const width = spec?.viewports?.[label] ?? ({ pc: 1440, pad: 768, mobile: 375 }[label]);
  return { label, width: typeof width === 'number' ? width : null,
    height: label === 'pc' ? 900 : label === 'pad' ? 1024 : 667 };
};

const normalizedStyle = (key, value) => ['color', 'backgroundColor', 'borderColor'].includes(key) && value
  ? normColor(String(value)) : value ?? null;

function styleItemForCheck(checkId, items) {
  if (checkId === 'bss-product-name-clamp') return items.find((item) => item.id === 'product-name' && item.clamp);
  return items.find((item) => `bss-${item.id}` === checkId);
}

export function textContentOracle(item) {
  if (item?.kind !== 'text-content') return { status: 'not-applicable' };
  if (item.text === null || item.text === undefined || String(item.text) === '') {
    return { status: 'na', reason: item.valueResolutionReason || 'expected-text-unresolved' };
  }
  return { status: 'resolved', expected: String(item.text), source: item.resolvedExpectedSources?.text || 'profile' };
}

function diagnosticValues(check, item) {
  const evidence = check.evidence || {};
  if (check.status === 'na' && (evidence.notSetProperties || evidence.applicabilitySource)) {
    return { expected: { notSetThisRun: evidence.notSetProperties || [] }, actual: { compared: false } };
  }
  if (check.id.startsWith('bss-breakage-')) {
    return {
      expected: { instanceOverflow: false, stickingOut: 0, overlaps: 0, textClipped: 0, imgDistorted: 0 },
      actual: { horizontalOverflow: Boolean(evidence.horizontalOverflow),
        stickingOut: evidence.stickingOut?.length ?? null, overlaps: evidence.overlaps?.length ?? null,
        textClipped: evidence.textClipped?.length ?? null, imgDistorted: evidence.imgDistorted?.length ?? null,
        documentWidth: evidence.docScrollWidth ?? null, viewportWidth: evidence.viewportWidth ?? null,
        overflowScope: evidence.horizontalOverflowScope || 'unknown', blockOverflow: Boolean(evidence.blockOverflow),
        pageLevelFinding: evidence.pageLevelFinding || null,
        overflowAttribution: evidence.overflowAttribution || { pageLevel: Boolean(evidence.horizontalOverflow),
          instance: Boolean(evidence.blockOverflow), source: evidence.blockOverflow && evidence.horizontalOverflow
            ? 'page-and-instance' : evidence.blockOverflow ? 'instance-only'
              : evidence.horizontalOverflow ? 'page-level-outside-instance' : 'none' },
        blockRoot: evidence.blockRoot || null,
        offendingElementSelectors: (evidence.stickingOut || []).map((entry) => entry.selector).filter(Boolean),
        overlapElementSelectors: (evidence.overlaps || []).map((entry) => [entry.aSelector, entry.bSelector]
          .filter(Boolean).join(' ↔ ')).filter(Boolean),
        clippedElementSelectors: (evidence.textClipped || []).map((entry) => entry.selector).filter(Boolean) },
    };
  }
  if (item?.kind === 'presence') return {
    expected: { minimumMatches: 1 }, actual: { found: evidence.found ?? null, cards: evidence.cards ?? null,
      searchedSources: evidence.searchedSources || ['visible text', 'aria-label', 'title'] },
  };
  if (item?.kind === 'text-content') return {
    expected: { exactText: item.text }, actual: { matchedCount: evidence.matchedCount ?? null },
  };
  if (check.id === 'bss-product-name-clamp') return {
    expected: { lineClamp: item?.clamp ?? null },
    actual: (evidence.clamps || []).map(({ clamp, overflow, display }) => ({ clamp, overflow, display })),
  };
  const props = Object.keys(item?.props || {});
  const expected = Object.fromEntries(props.map((key) => [key, normalizedStyle(key, item.props[key])]));
  if (item?.geometry?.centered) expected.centered = true;
  const actual = (evidence.elements || []).map((element) => ({
    ...Object.fromEntries(props.map((key) => [key, normalizedStyle(key, element[key])])),
    ...(item?.geometry?.centered ? { centered: element.centered || null } : {}),
  }));
  return { expected, actual };
}

export function resolveFrontStyleCapability(capability, settingsReport = null) {
  const spec = capability?.styleSpec;
  if (!spec) return capability;
  const values = settingsReport?.block?.currentValues || settingsReport?.currentValues || [];
  const items = (spec.items || []).map((item) => ({ ...item, props: { ...(item.props || {}) }, resolvedExpectedSources: {} }));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const resolvedExpectedSources = {};
  const learnedByCheck = new Map();
  for (const event of settingsReport?.styleScopeLearning || []) {
    if (event.status !== 'learned') continue;
    for (const [checkId, properties] of Object.entries(event.expectedValues || {})) {
      learnedByCheck.set(checkId, { ...(learnedByCheck.get(checkId) || {}), ...properties });
    }
  }
  for (const item of items) {
    const learned = item.learnedSelectors || {};
    for (const [property, entries] of Object.entries(learned)) {
      const latest = (entries || []).at(-1);
      if (latest && Object.hasOwn(latest, 'expectedValue')) {
        learnedByCheck.set(`bss-${item.id}`, { ...(learnedByCheck.get(`bss-${item.id}`) || {}), [property]: latest.expectedValue });
      }
    }
  }
  for (const item of items) {
    const runCheckId = `bss-${item.id}`;
    const currentLearning = (settingsReport?.styleScopeLearning || []).some((event) => event.status === 'learned'
      && Object.hasOwn(event.expectedValues || {}, runCheckId));
    const learned = (item.learnedSelectorRequired && settingsReport && !currentLearning)
      ? [] : Object.values(item.learnedSelectors || {}).flat();
    if (learned.length) {
      const paths = [...new Set(learned.map((entry) => entry.selector).filter(Boolean))];
      item.selectorCandidates = paths;
      item.selector = paths.join(', ');
      item.learnedSelectorResolved = true;
      item.selectorLearningUnavailable = false;
    } else if (item.learnedSelectorRequired) {
      // Keep the profile's ordered candidates for machine diagnostics/fallback
      // inventory, but do not assert without an effect scope learned this run.
      item.selector = item.selectorCandidates?.[0] || item.selector || null;
      item.learnedSelectorResolved = false;
      item.selectorLearningUnavailable = true;
    } else if (!item.selector && item.selectorCandidates?.length) item.selector = item.selectorCandidates[0];
    const runExpected = learnedByCheck.get(`bss-${item.id}`);
    if (runExpected) {
      for (const [property, value] of Object.entries(runExpected)) {
        item.props[property] = ['color', 'backgroundColor', 'borderColor'].includes(property)
          ? normColor(String(value)) : value;
        const sourceKey = `${item.id}.${property}`;
        item.resolvedExpectedSources[property] = 'run-written-editor-style-effect';
        resolvedExpectedSources[sourceKey] = 'run-written-editor-style-effect';
      }
    }
  }
  for (const item of items) {
    if (item.kind !== 'text-content' || !item.runValueSource) continue;
    const binding = item.runValueSource;
    const candidates = values.filter((entry) =>
      (binding.control?.region === undefined || entry.region === binding.control.region)
      && (binding.control?.label === undefined || entry.label === binding.control.label)
      && (binding.control?.type === undefined || entry.type === binding.control.type));
    const usable = candidates.length === 1 && candidates[0].value !== null
      && candidates[0].value !== undefined && String(candidates[0].value) !== '';
    const written = settingWasWritten(settingsReport, binding);
    if (usable && written) {
      item.text = String(candidates[0].value);
      item.resolvedExpectedSources.text = `run-report:block.currentValues[region=${binding.control?.region ?? '*'},label=${binding.control?.label ?? '*'}]`;
      item.valueResolutionReason = null;
    } else {
      const checkIds = binding.settingCheckIds || [];
      const checks = settingsReport?.checks || [];
      const lastWritten = [...checks].reverse().find((check) => checkIds.includes(check.id)
        && ['pass', 'fail'].includes(check.status) && check.value !== null && check.value !== undefined
        && String(check.value) !== '');
      const runMarker = autotestMarkerFromReport(settingsReport);
      if (lastWritten) {
        item.text = String(lastWritten.value);
        item.resolvedExpectedSources.text = `run-report:checks[${lastWritten.id}].value`;
        item.valueResolutionReason = null;
      } else if (runMarker) {
        item.text = runMarker.value;
        item.resolvedExpectedSources.text = runMarker.source;
        item.valueResolutionReason = null;
      } else {
        item.text = null;
        item.valueResolutionReason = !settingsReport ? 'run-report-not-provided'
          : candidates.length !== 1 ? 'run-control-value-not-unique' : 'setting-value-not-written-this-run';
        item.resolvedExpectedSources.text = item.valueResolutionReason;
        resolvedExpectedSources[`${item.id}.text`] = item.valueResolutionReason;
      }
    }
  }
  for (const [key, binding] of Object.entries(spec.expectedValueSources || {})) {
    const [itemId, property] = key.split('.', 2);
    const item = itemById.get(itemId);
    if (!item || !property) continue;
    const learnedRunValue = learnedByCheck.get(`bss-${itemId}`)?.[property];
    if (learnedRunValue !== undefined) continue;
    const candidates = binding.control ? values.filter((entry) =>
      (binding.control.region === undefined || entry.region === binding.control.region)
      && (binding.control.label === undefined || entry.label === binding.control.label)
      && (binding.control.type === undefined || entry.type === binding.control.type)) : [];
    const match = candidates.length === 1 ? candidates[0] : null;
    const usable = match && match.value !== null && match.value !== undefined && match.value !== '';
    const written = settingWasWritten(settingsReport, binding);
    const value = usable && written ? match.value : settingsReport ? undefined : binding.profileDefault;
    if (value === undefined) {
      item.resolvedExpectedSources[property] = 'not set this run';
      delete item.props[property];
      resolvedExpectedSources[key] = 'not set this run';
      continue;
    }
    item.props[property] = ['color', 'backgroundColor', 'borderColor'].includes(property)
      ? normColor(String(value)) : value;
    const source = usable && written
      ? `run-report:block.currentValues[region=${binding.control.region ?? '*'},label=${binding.control.label ?? '*'}]`
      : `profile-default:${key}`;
    item.resolvedExpectedSources[property] = source;
    resolvedExpectedSources[key] = source;
  }
  return { ...capability, styleSpec: { ...spec, items, resolvedExpectedSources } };
}

function autotestMarkerFromReport(report) {
  if (!report || typeof report !== 'object') return null;
  const explicit = [report.autotestMarker, report.marker, report.fixtureMarker,
    report.fixture?.marker, report.block?.autotestMarker, report.block?.marker]
    .filter((value) => typeof value === 'string' && /^AUTOTEST-/i.test(value.trim()));
  const currentValues = [...(report.block?.currentValues || []), ...(report.currentValues || [])]
    .filter((entry) => entry?.marker === true || entry?.fixtureMarker === true)
    .map((entry) => entry.value).filter((value) => typeof value === 'string' && /^AUTOTEST-/i.test(value.trim()));
  const values = [...new Set([...explicit, ...currentValues].map((value) => value.trim()))];
  return values.length === 1 ? { value: values[0], source: 'run-report:autotest-marker' } : null;
}

function settingWasWritten(report, binding) {
  if (!report) return true;
  const required = binding?.settingCheckIds || [];
  if (!required.length) return false;
  const checks = new Map((report.checks || []).map((check) => [check.id, check]));
  return required.every((id) => ['pass', 'fail'].includes(checks.get(id)?.status));
}

function valueAtPath(object, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => value?.[key], object);
}

export function resolveItemApplicability(item, report) {
  const rule = item.applicability;
  if (!rule) return item.requireApplicableToggle
    ? { applicable: false, reason: 'profile did not declare an applicability toggle; not set this run' }
    : { applicable: true };
  if (!report) return { applicable: false, reason: '未提供运行报告，无法读取画像声明的适用性开关。', source: rule.checkId };
  const check = (report.checks || []).find((entry) => entry.id === rule.checkId);
  if (!check || !['pass', 'fail', 'record'].includes(check.status)) {
    return { applicable: false, reason: 'not set this run', source: rule.checkId };
  }
  const actual = valueAtPath(check, rule.valuePath || 'actual');
  return actual === rule.equals
    ? { applicable: true, source: rule.checkId }
    : { applicable: false, reason: '画像开关值表明此项不适用。', source: rule.checkId };
}

/** Add structured, value-safe diagnostics without changing a check verdict. */
export function addStyleFailureReasons(checks, { capability, blockId, rootSelector, viewports } = {}) {
  const spec = capability?.styleSpec || {};
  const items = spec.items || [];
  return checks.map((check) => {
    if (check.status === 'pass') return check;
    const item = styleItemForCheck(check.id, items);
    const isBreakage = check.id.startsWith('bss-breakage-');
    const locator = isBreakage ? 'block subtree layout invariants'
      : rootSelector ? 'unique block instance root / profile selector candidates' : 'unique block instance root';
    const evidence = check.evidence || {};
    const matchedElementCount = Number.isInteger(evidence.matchedCount) ? evidence.matchedCount
      : Number.isInteger(evidence.found) ? evidence.found
        : Number.isInteger(evidence.rootMatchedCount) ? evidence.rootMatchedCount
          : Array.isArray(evidence.elements) ? evidence.elements.length
            : Array.isArray(evidence.clamps) ? evidence.clamps.length : null;
    const stage = check.errorDiagnostic?.stage || (check.status === 'fail' ? 'compare'
      : matchedElementCount === 0 ? 'locate' : 'read');
    const { expected, actual } = diagnosticValues(check, item);
    const configuredViewport = styleViewport(check.id, { ...spec, ...(viewports ? { viewports } : {}) });
    if (Number.isInteger(evidence.viewportWidth)) configuredViewport.width = evidence.viewportWidth;
    const suppliedCode = machineReasonCode(check.reason?.code) !== 'reason-code-unavailable'
      ? machineReasonCode(check.reason.code) : machineReasonCode(evidence.machineReason);
    const reasonCode = suppliedCode !== 'reason-code-unavailable' ? suppliedCode
      : check.errorDiagnostic ? `front-${String(check.errorDiagnostic.stage || 'read')}-error`
        : matchedElementCount === 0 || (Array.isArray(actual) && actual.length === 0) ? 'no-matched-elements'
          : check.status === 'fail' ? 'style-assertion-mismatch' : `style-${stage}-not-applicable`;
    return { ...check, name: check.name || item?.name || NAMES[check.id] || check.id, reason: {
      stage, locator, matchedElementCount,
      property: isBreakage ? ['horizontalOverflow', 'stickingOut', 'overlaps', 'textClipped', 'imgDistorted']
        : item?.kind === 'presence' ? ['presence'] : item?.clamp ? ['lineClamp']
          : [...Object.keys(item?.props || {}), ...(item?.geometry?.centered ? ['centered'] : [])],
      expected, actual, viewport: configuredViewport,
      ...(item?.resolvedExpectedSources && Object.keys(item.resolvedExpectedSources).length
        ? { expectedSource: item.resolvedExpectedSources } : {}),
      ...(check.screenshot ? { screenshot: check.screenshot } : {}),
      ...(check.errorDiagnostic ? { error: {
        class: String(check.errorDiagnostic.class || 'Error'),
        message: String(check.errorDiagnostic.message || '').slice(0, 240),
      } } : {}),
      ...(check.status === 'na' || check.status === 'skip' || check.status === 'deferred'
        ? { applicability: String(check.detail || check.status).slice(0, 240) } : {}),
      code: reasonCode,
      ...(evidence.candidateSource ? { candidateSource: String(evidence.candidateSource) } : {}),
    } };
  });
}

function machineReasonCode(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.code === 'string' && value.code.trim()) return value.code.trim();
    if (typeof value.reason === 'string' && value.reason.trim()) return value.reason.trim();
  }
  return 'reason-code-unavailable';
}

export function styleCheckDescriptors(capability) {
  const items = (capability?.styleSpec?.items || []).filter((item) => !isNullColorPlaceholder(item));
  const recordOnly = capability?.styleSpec?.recordOnly || [];
  if (!items.length && !recordOnly.length) return Object.keys(NAMES).map((id) => ({ id, name: NAMES[id], itemId: null }));
  const descriptors = items.map((item) => ({ id: `bss-${item.id}`, name: item.name || NAMES[`bss-${item.id}`] || item.id,
    itemId: item.id }));
  descriptors.push(...recordOnly.map((item) => ({ id: `bss-${item.id}`, name: item.name || item.id, itemId: item.id })));
  if (items.some((item) => item.id === 'product-name' && item.clamp)) {
    descriptors.push({ id: 'bss-product-name-clamp', name: NAMES['bss-product-name-clamp'], itemId: 'product-name' });
  }
  for (const vp of ['pc', 'pad', 'mobile']) descriptors.push({
    id: `bss-breakage-${vp}`, name: NAMES[`bss-breakage-${vp}`], itemId: null,
  });
  return descriptors;
}

export async function runFrontLayer(args) {
  const checks = await runFrontLayerRaw(args);
  for (const check of checks) args.onProgress?.(`style-check-result id=${check.id} status=${check.status}`);
  return addStyleFailureReasons(checks, { capability: args.capability, blockId: args.config?.blockId,
    rootSelector: args.config?.rootSelector,
    viewports: args.capability?.styleSpec?.viewports });
}
