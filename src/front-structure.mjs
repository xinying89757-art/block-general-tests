// Serialized into the browser. Return only instance-relative structural paths
// and geometry/state metadata; profiles continue to own expected values.
export function readInstanceStructure({ rootSelector, contentContainerSelector, imageMode = 'all', imageSelectors = [], hierarchySelectors = [], debugLimit = 80 } = {}) {
  const roots = document.querySelectorAll(rootSelector);
  if (roots.length !== 1) return { rootFound: false, rootCount: roots.length, hierarchy: [], images: [], options: [] };
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
  // Gradients decorate navigation/buttons; they are not content images.
  const hasBackgroundImage = (node) => /url\(/i.test(getComputedStyle(node).backgroundImage);
  const numericLevel = (node) => {
    for (const key of ['aria-level', 'data-level', 'data-depth', 'level', 'depth']) {
      const value = node.getAttribute(key);
      if (/^\d+$/.test(value || '')) return Number(value) + (key.includes('depth') ? 1 : 0);
    }
    const match = String(node.getAttribute('class') || '').match(/(?:^|\s)(?:level|depth)[_-]?(\d+)(?:\s|$)/i);
    return match ? Number(match[1]) + (/depth/i.test(match[0]) ? 1 : 0) : null;
  };
  const pagination = (node) => {
    for (let parent = node; parent && parent !== root; parent = parent.parentElement) {
      if (/pagination|pager|page.?nav|分页/i.test(parent.getAttribute('aria-label') || '')) return true;
      if (parent.matches('ul,ol,nav,[role=navigation]')) {
        const labels = [...parent.children].map((child) => child.textContent.trim()).filter(Boolean);
        const links = [...parent.querySelectorAll('a[href]')];
        if (labels.length > 1 && labels.filter((text) => /^\d+$/.test(text)).length >= labels.length / 2) return true;
        if (links.length > 1 && links.every((link) => /[?&](?:page|p)=\d+/.test(link.getAttribute('href')))) return true;
      }
    }
    return false;
  };
  const hierarchyExcluded = (node) => pagination(node) || Boolean(node.closest('form,[role=listbox]'))
    || Boolean(node.querySelector('img,picture,input,select,textarea'));
  const group = (node) => {
    if (node.matches('ul,ol,[role="tree"],[role="group"],[role="list"],[role="listbox"]')) return true;
    if (node.tagName !== 'DIV' || node.querySelector('img,picture')) return false;
    const entries = [...node.children].filter((child) => child.tagName === 'DIV' && hasLabel(child));
    return entries.length > 0 && (entries.length > 1 || (node.parentElement !== root && hasLabel(node.parentElement)));
  };
  const groups = all.filter(group);
  const items = new Set(all.filter((node) => !hierarchyExcluded(node) && (node.matches('li,[role="treeitem"],[aria-level],details') || numericLevel(node) > 0)));
  for (const container of groups) {
    for (const child of container.children) if (child.matches('li,div,[role="treeitem"]') && hasLabel(child) && !hierarchyExcluded(child)) items.add(child);
    const parent = container.parentElement;
    if (parent && parent !== root && parent.tagName === 'DIV' && hasLabel(parent) && !hierarchyExcluded(parent)) items.add(parent);
  }
  // Some trees flatten sibling items and express depth through padding/margin
  // or a numeric level/depth attribute. Require actual depth variation; a row
  // of filter groups or pagination links must not become a tree.
  const explicitLevels = new Map();
  for (const container of all) {
    const entries = [...container.children].filter((node) => !hierarchyExcluded(node) && hasLabel(node)
      && node.matches('li,div,[role=treeitem]'));
    if (entries.length < 2) continue;
    const declared = entries.map(numericLevel);
    const indents = entries.map((node) => {
      const style = getComputedStyle(label(node));
      return (parseFloat(style.paddingInlineStart) || 0) + (parseFloat(style.marginInlineStart) || 0)
        + (label(node) === node ? 0 : (parseFloat(getComputedStyle(node).paddingInlineStart) || 0)
          + (parseFloat(getComputedStyle(node).marginInlineStart) || 0));
    });
    const offsets = [...new Set(indents)].sort((a, b) => a - b);
    const rects = entries.map((node) => node.getBoundingClientRect());
    const vertical = rects.every((rect, index) => !index || rect.y >= rects[index - 1].bottom - 1);
    const declaredTree = declared.every((value) => Number.isInteger(value) && value >= 0) && new Set(declared).size > 1;
    const declaredBase = Math.min(...declared) === 0 ? 1 : 0;
    const shape = (node) => [node.tagName, ...[...node.classList].filter((name) => !/^(?:level|depth)[_-]?\d+$/i.test(name)).sort()].join(' ');
    const repeatedShape = entries.every((node) => shape(node) === shape(entries[0]));
    const indentedTree = repeatedShape && vertical && offsets.length > 1 && entries.every((node) => !node.querySelector('ul,ol'));
    if (declaredTree || indentedTree) entries.forEach((node, index) => {
      items.add(node); explicitLevels.set(node, declaredTree ? declared[index] + declaredBase : offsets.indexOf(indents[index]) + 1);
    });
  }
  const parentItem = (node) => {
    if (explicitLevels.has(node)) {
      for (let peer = node.previousElementSibling; peer; peer = peer.previousElementSibling) {
        if (explicitLevels.has(peer) && explicitLevels.get(peer) < explicitLevels.get(node)) return peer;
      }
    }
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) if (items.has(parent)) return parent;
    return null;
  };
  const level = (node) => {
    if (explicitLevels.has(node)) return explicitLevels.get(node);
    const declared = numericLevel(node);
    if (declared > 0) return declared;
    let depth = 1;
    for (let parent = parentItem(node); parent; parent = parentItem(parent)) depth += 1;
    return depth;
  };
  const selectedHierarchy = hierarchySelectors.flatMap((selector) => { try { return [...root.querySelectorAll(selector)]; } catch { return []; } });
  const hierarchyNodes = [...items].filter((node) => (parentItem(node) || [...items].some((other) => parentItem(other) === node)
    || node.matches('[aria-level],[role="treeitem"],details') || explicitLevels.has(node))
    && (!hierarchySelectors.length || selectedHierarchy.some((selected) => selected === node || selected === label(node))));
  for (const node of all) debug('hierarchy', node, hierarchyExcluded(node) ? pagination(node) ? 'pagination-not-hierarchy' : 'media-or-filter-control-not-hierarchy' : !items.has(node) ? 'no-hierarchy-item-shape'
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
  const meaningfulMedia = (node) => node.matches('img,picture') || hasBackgroundImage(node)
    && !node.matches('ul,ol,li') && !node.querySelector('img,picture') && !ownText(node);
  const mediaNodes = all.filter(meaningfulMedia);
  const cardText = (node) => [...node.querySelectorAll('a,span,p,h1,h2,h3,h4,h5,h6')]
    .some((text) => ownText(text) && !mediaNodes.some((image) => image === text || image.contains(text)));
  const cardMedia = (node) => mediaNodes.some((image) => image === node || node.contains(image));
  const contentContainer = (node) => {
    if (contentContainerSelector) { try { const found = node.closest(contentContainerSelector); if (found !== root && root.contains(found)) return found; } catch {} }
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (pagination(parent) || hierarchy.some((item) => item.path === path(parent))) return null;
      const peers = [...(parent.parentElement?.children || [])].filter((peer) => peer.tagName === parent.tagName
        && cardMedia(peer) && cardText(peer));
      if (peers.length > 1 && cardMedia(parent) && cardText(parent)) return parent;
      if (parent.matches('article,[role=listitem]') || parent.tagName === 'LI' && cardText(parent) && !parent.querySelector('ul,ol')) return parent;
    }
    return null;
  };
  const selectedImages = imageSelectors.flatMap((selector) => { try { return [...root.querySelectorAll(selector)]; } catch { return []; } });
  const images = all.flatMap((node) => {
    if (!node.matches('img,picture') && getComputedStyle(node).backgroundImage === 'none') { debug('image', node, 'not-an-image-shape', false, false); return []; }
    if (!meaningfulMedia(node)) { debug('image', node, hasBackgroundImage(node) ? 'link-or-container-background-decoration' : 'gradient-not-content-image'); return []; }
    if (node.matches('img') && node.parentElement?.matches('picture')) { debug('image', node, 'picture-source-counted-once'); return []; }
    if (node.getAttribute('aria-hidden') === 'true' || node.getAttribute('role') === 'presentation') { debug('image', node, 'decorative-image-semantics'); return []; }
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
    if (imageMode !== 'background' && (!content || !visible(node))) { debug('image', node, !content ? 'no-content-container' : 'image-not-visible', false, true, dimensions); return []; }
    if (imageMode === 'background' && (!background || !content || !visible(node))) { debug('image', node, !background ? 'not-background-image' : !content ? 'no-content-container' : 'image-not-visible', false, true, dimensions); return []; }
    const dimension = (axis) => {
      const natural = image?.[axis === 'width' ? 'naturalWidth' : 'naturalHeight'];
      if (natural > 0) return { value: natural, source: 'natural' };
      const attribute = image?.getAttribute(axis);
      if (/^\d+(?:\.\d+)?(?:px)?$/.test(attribute || '') && parseFloat(attribute) > 0) return { value: parseFloat(attribute), source: 'attribute' };
      return { value: rect[axis], source: 'rendered' };
    };
    const measuredWidth = dimension('width'), measuredHeight = dimension('height');
    const width = measuredWidth.value, height = measuredHeight.value;
    if (!(width > 0 && height > 0)) { debug('image', node, 'image-dimensions-unavailable'); return []; }

    if (background && /(?:^|\s)-[\d.]+px/.test(style.backgroundPosition)) {
      debug('image', node, 'sprite-background-offset'); return [];
    }
    const descriptiveAlt = Boolean(image?.getAttribute('alt')?.trim());
    const largerCardMedia = content && mediaNodes.some((other) => other !== node && !node.contains(other) && content.contains(other)
      && other.getBoundingClientRect().width * other.getBoundingClientRect().height > Math.max(1, rect.width * rect.height) * 4);
    if (!descriptiveAlt && width <= 32 && height <= 32 && largerCardMedia) {
      debug('image', node, 'ancillary-card-icon'); return [];
    }
    debug('image', node, 'content-container-recognized', true, true, dimensions);
    const position = background ? style.backgroundPosition : style.objectPosition;
    const centered = /\bcenter\b/.test(position) || /^50(?:\.0+)?%\s+50(?:\.0+)?%$/.test(position);
    return [{ path: path(node), kind: background ? 'background-image' : node.matches('picture') ? 'picture' : 'img',
      content: Boolean(content), contentContainerPath: content ? path(content) : null, visible: visible(node),
      width, height, dimensionSource: { width: measuredWidth.source, height: measuredHeight.source }, ratio: width / height, centered,
      sourceKind: background ? 'background-image' : node.matches('picture') ? 'picture' : 'img',
      positionSource: background ? 'background-position' : 'object-position',
      objectPosition: style.objectPosition, backgroundPosition: style.backgroundPosition, hasLazySource: Boolean(source) }];
  });
  const nativeOption = (node) => node.matches('[role=option],option,input[type=checkbox],input[type=radio]');
  const textual = (node) => Boolean(node.textContent.trim()) && !node.querySelector('img,picture,input,select,textarea');
  const binding = (node) => typeof node.onclick === 'function' || node.hasAttribute('onclick')
    || [...node.attributes].some((attribute) => /^(?:data-(?:bind|action|value|option|label)|v-on:click|@click|ng-click)$/i.test(attribute.name));
  const nonNavigating = (node) => !node.matches('a[href]') || /^(?:#.*|javascript:.*)?$/i.test(node.getAttribute('href') || '') || binding(node);
  const actionableText = (node) => textual(node) && nonNavigating(node)
    && (binding(node) || node.tagName === 'LABEL' || node.matches('a,button,[role=option]') && getComputedStyle(node).cursor === 'pointer');
  const optionShape = (node) => {
    if (nativeOption(node)) return true;
    if (pagination(node) || hierarchy.some((entry) => entry.path === path(node) || entry.labelPath === path(node))) return false;
    if (node.matches('input,button,svg,path,ul,ol,form')) return false;
    if (!actionableText(node)) return false;
    if (node.querySelector('a,label,[role=option]')) return false;
    const peers = [...(node.parentElement?.children || [])].filter(actionableText);
    return binding(node) || node.matches('label') && (node.hasAttribute('for') || node.querySelector('input'))
      || peers.length > 1 && Boolean(node.closest('form,[role=listbox],[role=group]'));
  };
  const options = [];
  for (const node of all) {
    const isOption = optionShape(node);
    const target = nativeOption(node) ? node.labels?.[0] && root.contains(node.labels[0]) ? node.labels[0]
      : node.closest('label') || (node.matches('input') ? node.nextElementSibling || node.parentElement : label(node)) : label(node);
    const inRoot = target && root.contains(target);
    const accepted = Boolean(isOption && inRoot && visible(target));
    debug('filter-option', node, !isOption ? pagination(node) ? 'pagination-not-option' : 'no-native-or-aria-option-semantics' : !inRoot
      ? 'option-label-outside-instance' : !visible(target) ? 'option-label-not-visible' : 'option-label-recognized',
      accepted, Boolean(isOption));
    if (accepted) options.push({ path: path(target), visible: true, kind: node.tagName.toLowerCase() });
  }
  const levels = hierarchy.filter((item) => item.visible).map((item) => item.level);
  const collapsedLevels = hierarchy.filter((item) => item.collapsed).map((item) => item.level);
  for (const bucket of Object.values(finderDebug.finders)) {
    bucket.omittedCount = bucket.consideredCount - bucket.decisions.length;
    bucket.decisions.forEach((row) => { delete row.relevant; });
  }
  return { rootFound: true, rootCount: 1, hierarchy, images,
    finderDebug, absenceReasons: { hierarchy: hierarchy.length ? null : 'no-hierarchy-depth-evidence-in-instance',
      images: images.length ? null : 'no-content-images-in-instance', options: options.length ? null : 'no-option-labels-in-instance' },
    options: [...new Map(options.map((item) => [item.path, item])).values()],
    levels, allLevels: [...new Set(hierarchy.map((item) => item.level))].sort((a, b) => a - b),
    maxVisibleLevel: levels.length ? Math.max(...levels) : null, collapsedLevels, collapsedLevelCount: collapsedLevels.length };
}
