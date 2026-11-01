// Serialized into the browser. Return only instance-relative structural paths
// and geometry/state metadata; profiles continue to own expected values.
export function readInstanceStructure({ rootSelector, contentContainerSelector, imageMode = 'all', imageSelectors = [], hierarchySelectors = [], debugLimit = 80 } = {}) {
  const roots = document.querySelectorAll(rootSelector);
  if (roots.length !== 1) return { rootFound: false, rootCount: roots.length, hierarchy: [], images: [], options: [], disclosures: [] };
  const root = roots[0];
  const all = [...root.querySelectorAll('*')];
  const path = (node) => {
    if (node === root) return ':scope';
    const parts = [];
    for (let current = node; current && current !== root; current = current.parentElement) {
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${[...current.parentElement.children].indexOf(current) + 1})`);
    }
    return `:scope > ${parts.join(' > ')}`;
  };
  const finderDebug = { imageMode, limitPerFinder: Math.min(200, Math.max(0, Number(debugLimit) || 0)), finders: {} };
  const debug = (finder, node, reason, accepted = false, relevant = true, details = {}) => {
    const bucket = finderDebug.finders[finder] ||= { consideredCount: 0, acceptedCount: 0, rejectedCount: 0, reasonCounts: {}, decisions: [] };
    bucket.consideredCount += 1; bucket[accepted ? 'acceptedCount' : 'rejectedCount'] += 1;
    bucket.reasonCounts[reason] = (bucket.reasonCounts[reason] || 0) + 1;
    const row = { path: path(node), tag: node.tagName.toLowerCase(), className: String(node.getAttribute('class') || '').slice(0, 180),
      decision: accepted ? 'accepted' : 'rejected', reason, ...details, relevant };
    if (bucket.decisions.length < finderDebug.limitPerFinder) bucket.decisions.push(row);
    else if (relevant) { const slot = bucket.decisions.findIndex((item) => !item.relevant); if (slot >= 0) bucket.decisions.splice(slot, 1, row); }
  };
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    for (let current = node; current && root.contains(current); current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || /hidden|collapse/.test(style.visibility) || Number(style.opacity || 1) === 0) return false;
      if (current === root) break;
    }
    return true;
  };
  const ownText = (node) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
  const label = (node) => [...node.children].find((child) => child.matches('a,span,button,label,[role="link"]') && ownText(child)) || node;
  const hasLabel = (node) => ownText(node) || label(node) !== node;
  const backgroundNodes = all.filter((node) => getComputedStyle(node).backgroundImage !== 'none');
  const media = (node) => Boolean(node.querySelector('img,picture') || backgroundNodes.some((background) => node === background || node.contains(background)));
  const group = (node) => {
    if (node.matches('ul,ol,[role="tree"],[role="group"],[role="list"],[role="listbox"]')) return true;
    if (node.tagName !== 'DIV' || node.querySelector('img,picture')) return false;
    const entries = [...node.children].filter((child) => child.tagName === 'DIV' && hasLabel(child));
    return entries.length > 0 && (entries.length > 1 || (node.parentElement !== root && hasLabel(node.parentElement)));
  };
  const groups = all.filter(group);
  const items = new Set(all.filter((node) => node.matches('li,[role="treeitem"],[aria-level],details')));
  for (const container of groups) {
    for (const child of container.children) if (child.matches('li,div,[role="treeitem"]') && hasLabel(child)) items.add(child);
    const parent = container.parentElement;
    if (parent && parent !== root && parent.tagName === 'DIV' && hasLabel(parent)) items.add(parent);
  }
  const parentItem = (node) => {
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) if (items.has(parent)) return parent;
    return null;
  };
  const level = (node) => {
    const declared = Number(node.getAttribute('aria-level'));
    if (declared > 0) return declared;
    let depth = 1;
    for (let parent = parentItem(node); parent; parent = parentItem(parent)) depth += 1;
    return depth;
  };
  const selectedHierarchy = hierarchySelectors.flatMap((selector) => { try { return [...root.querySelectorAll(selector)]; } catch { return []; } });
  const hierarchyNodes = [...items].filter((node) => (parentItem(node) || [...items].some((other) => parentItem(other) === node)
    || node.matches('[aria-level],[role="treeitem"],details'))
    && (!hierarchySelectors.length || selectedHierarchy.some((selected) => selected === node || selected === label(node))));
  for (const node of all) debug('hierarchy', node, !items.has(node) ? 'no-hierarchy-item-shape'
    : !parentItem(node) && ![...items].some((other) => parentItem(other) === node) && !node.matches('[aria-level],[role="treeitem"],details')
      ? 'no-parent-or-child-level' : !hierarchyNodes.includes(node) ? 'profile-hierarchy-selector-miss' : 'hierarchy-item-recognized',
    hierarchyNodes.includes(node), items.has(node));
  const hierarchy = hierarchyNodes.map((node) => {
    const children = [...items].filter((other) => parentItem(other) === node);
    const toggle = node.matches('[aria-expanded]') ? node : [...node.children].find((child) => child.hasAttribute('aria-expanded'));
    return { path: path(node), labelPath: path(label(node)), level: level(node), parentPath: parentItem(node) ? path(parentItem(node)) : null,
      hasChildren: children.length > 0, visible: visible(node),
      expanded: toggle?.getAttribute('aria-expanded') ?? (node.tagName === 'DETAILS' ? String(node.open) : null),
      collapsed: !visible(node) || toggle?.getAttribute('aria-expanded') === 'false' || (node.tagName === 'DETAILS' && !node.open) };
  });
  for (const node of all) for (const kind of ['nav-parent', 'nav-leaf']) {
    const entry = hierarchy.find((item) => item.path === path(node));
    const eligible = entry && (kind === 'nav-parent' ? entry.level === 1 && entry.hasChildren : entry.level > 1 && !entry.hasChildren);
    debug(kind, node, !entry ? 'not-a-hierarchy-item' : !eligible ? kind === 'nav-parent'
      ? 'not-top-level-parent' : 'not-nested-leaf' : !entry.visible ? 'hierarchy-item-not-visible' : 'navigation-item-recognized',
    Boolean(eligible && entry.visible), Boolean(entry));
  }
  const contentContainer = (node) => {
    if (contentContainerSelector) { try { const found = node.closest(contentContainerSelector); if (found !== root && root.contains(found)) return found; } catch {} }
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.matches('li,article,[role="listitem"]')) return parent;
      const peers = [...(parent.parentElement?.children || [])].filter((peer) => peer.tagName === parent.tagName && media(peer)
        && Boolean(peer.textContent.trim() || peer.querySelector('a[href]')));
      if (peers.length > 1 && media(parent) && (parent.textContent.trim() || parent.querySelector('a[href]'))) return parent;
      if (/(?:^|[\s_-])(?:card|item|product)(?:[\s_-]|$)/i.test(parent.className || '')) return parent;
    }
    return null;
  };
  const selectedImages = imageSelectors.flatMap((selector) => { try { return [...root.querySelectorAll(selector)]; } catch { return []; } });
  const images = all.flatMap((node) => {
    if (!node.matches('img,picture') && getComputedStyle(node).backgroundImage === 'none') { debug('image', node, 'not-an-image-shape', false, false); return []; }
    if (imageSelectors.length && !selectedImages.some((selected) => selected === node || selected.matches('picture') && selected.contains(node))) {
      debug('image', node, 'profile-image-selector-miss'); return [];
    }
    const image = node.matches('picture') ? node.querySelector('img') : node.matches('img') ? node : null;
    const source = image && (image.currentSrc || image.getAttribute('src') || image.getAttribute('srcset')
      || [...image.attributes].find((attribute) => /^data-(?:.*-)?(?:src|srcset|original)$/i.test(attribute.name))?.value);
    const background = !image && getComputedStyle(node).backgroundImage !== 'none';
    if (!source && !background) { debug('image', node, 'image-source-unavailable'); return []; }
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(image || node);
    const content = contentContainer(node);
    const dimensions = { width: rect.width, height: rect.height, contentContainerPath: content ? path(content) : null };
    if (imageMode === 'content' && (!content || !visible(node))) { debug('image', node, !content ? 'no-content-container' : 'image-not-visible', false, true, dimensions); return []; }
    if (imageMode === 'background' && (!background || !visible(node))) { debug('image', node, !background ? 'not-background-image' : 'image-not-visible', false, true, dimensions); return []; }
    debug('image', node, content ? 'content-container-recognized' : 'image-recognized-without-content-container', true, true, dimensions);
    const width = image?.naturalWidth || rect.width, height = image?.naturalHeight || rect.height;
    const position = background ? style.backgroundPosition : style.objectPosition;
    const centered = /\bcenter\b/.test(position) || /^50(?:\.0+)?%\s+50(?:\.0+)?%$/.test(position);
    return [{ path: path(node), kind: background ? 'background-image' : node.matches('picture') ? 'picture' : 'img',
      content: Boolean(content), contentContainerPath: content ? path(content) : null, visible: visible(node),
      width, height, ratio: width / height, centered,
      sourceKind: background ? 'background-image' : node.matches('picture') ? 'picture' : 'img',
      positionSource: background ? 'background-position' : 'object-position',
      objectPosition: style.objectPosition, backgroundPosition: style.backgroundPosition, hasLazySource: Boolean(source) }];
  });
  const options = all.filter((node) => node.matches('[role="option"],option,input[type="checkbox"],input[type="radio"]')
    || (node.tagName === 'LI' && !hierarchy.some((item) => item.path === path(node))
      && node.parentElement?.matches('[role="listbox"],select') )).map((node) => {
    const target = node.labels?.[0] && root.contains(node.labels[0]) ? node.labels[0]
      : node.closest('label') || (node.matches('input') ? node.nextElementSibling || node.parentElement : label(node));
    return { path: path(target), visible: visible(target), kind: node.tagName.toLowerCase() };
  });
  for (const node of all) {
    const isOption = node.matches('[role="option"],option,input[type="checkbox"],input[type="radio"]')
      || node.tagName === 'LI' && !hierarchy.some((item) => item.path === path(node)) && node.parentElement?.matches('[role="listbox"],select');
    const target = node.labels?.[0] && root.contains(node.labels[0]) ? node.labels[0]
      : node.closest('label') || (node.matches('input') ? node.nextElementSibling || node.parentElement : label(node));
    debug('filter-option', node, !isOption ? 'no-native-or-aria-option-semantics' : !target || !root.contains(target)
      ? 'option-label-outside-instance' : !visible(target) ? 'option-label-not-visible' : 'option-label-recognized',
    Boolean(isOption && target && root.contains(target) && visible(target)), Boolean(isOption));
  }
  const disclosures = new Map();
  const navigates = (node) => { const link = node.closest('a[href],area[href]');
    return Boolean(link && !/^\s*(?:javascript:\s*void\s*\(\s*0\s*\)\s*;?)?\s*$/i.test(link.getAttribute('href') || '')); };
  for (const original of all) {
    let target = original;
    if (target.matches('svg,path,use,g,polygon,polyline,circle,line')) target = target.closest('span,li,button,a,[role="button"]');
    if (!target || !visible(target) || navigates(target) || target.closest('form') || target.form) {
      debug('interaction', original, !target ? 'click-owner-unresolved' : !visible(target) ? 'click-owner-not-visible'
        : navigates(target) ? 'navigation-link' : 'form-control', false, /^(button|span|svg|path|a|li)$/i.test(original.tagName)); continue;
    }
    const descriptor = [target.id, target.getAttribute('class'), target.getAttribute('aria-label'),
      (target.textContent || '').trim().slice(0, 60)].join(' ');
    if (/reset|clear|submit|重置|清空|清除/i.test(descriptor) || /^(submit|reset|image)$/i.test(target.getAttribute('type') || '')) { debug('interaction', original, 'reset-clear-or-submit-control'); continue; }
    const explicit = target.hasAttribute('aria-expanded') || target.hasAttribute('aria-controls');
    const handler = typeof target.onclick === 'function' || target.hasAttribute('onclick');
    const handlerTargetsPanel = handler && /next|sibling|parent|children|toggle|slide|expand|collapse|aria|classList|display|height/i.test(
      target.getAttribute('onclick') || String(target.onclick));
    const pointer = getComputedStyle(target).cursor === 'pointer';
    const tab = target.getAttribute('role') === 'tab';
    if (!explicit && !handler && !pointer && !target.matches('button,summary') && !tab) { debug('interaction', original, 'no-action-affordance', false, false); continue; }
    const owner = target.closest('li,[role="treeitem"]') || target.parentElement;
    const controlled = (target.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id));
    const possible = [...controlled, ...target.children, ...(owner?.children || []), target.nextElementSibling, owner?.nextElementSibling];
    const panels = [...new Set(possible)].filter((node) => node && node !== target && node !== root && root.contains(node)
      && !node.contains(target) && (group(node) || node.matches('[role="tabpanel"],[role="menu"]')
        || /panel|dropdown|collapse|submenu/i.test(node.getAttribute('class') || '')));
    const collapsed = (node) => { const style = getComputedStyle(node); return !visible(node) || node.hidden
      || node.getAttribute('aria-hidden') === 'true' || node.getBoundingClientRect().height < 1
      || /collapsed|closed/i.test(node.getAttribute('class') || '') || style.display === 'none'; };
    const icon = Boolean(target.querySelector('svg,i,[aria-hidden="true"]')) || /^[+−–▶▷▸▹▾▼⌄⌃]$/.test(target.textContent.trim());
    const evidence = [explicit && 'aria-disclosure', tab && panels.length > 0 && 'tab-panel',
      panels.some(collapsed) && 'collapsed-panel', icon && panels.some(group) && 'icon-next-to-list',
      pointer && handlerTargetsPanel && panels.length > 0 && 'pointer-handler-with-panel'].filter(Boolean);
    if (!evidence.length) { debug('interaction', original, 'no-controlled-or-collapsed-panel', false, true, { panelCount: panels.length, pointer, handler, explicit }); continue; }
    // A list item containing a dedicated arrow is not an extra click target.
    // Its span/SVG descendants resolve to the arrow itself below.
    if (target.tagName === 'LI' && !handler && !explicit) { debug('interaction', original, 'container-has-dedicated-arrow'); continue; }
    debug('interaction', original, disclosures.has(path(target)) ? 'duplicate-click-owner' : 'disclosure-recognized', !disclosures.has(path(target)), true,
      { clickTargetPath: path(target), evidence, panelCount: panels.length });
    const rect = target.getBoundingClientRect();
    disclosures.set(path(target), { path: path(target), evidence, panelPaths: panels.map(path),
      tag: target.tagName.toLowerCase(), className: String(target.getAttribute('class') || '').slice(0, 180),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  }
  const levels = hierarchy.filter((item) => item.visible).map((item) => item.level);
  const collapsedLevels = hierarchy.filter((item) => item.collapsed).map((item) => item.level);
  for (const bucket of Object.values(finderDebug.finders)) {
    bucket.omittedCount = bucket.consideredCount - bucket.decisions.length;
    bucket.decisions.forEach((row) => { delete row.relevant; });
  }
  return { rootFound: true, rootCount: 1, hierarchy, images, disclosures: [...disclosures.values()],
    finderDebug,
    options: [...new Map(options.map((item) => [item.path, item])).values()],
    levels, allLevels: [...new Set(hierarchy.map((item) => item.level))].sort((a, b) => a - b),
    maxVisibleLevel: levels.length ? Math.max(...levels) : null, collapsedLevels, collapsedLevelCount: collapsedLevels.length };
}
