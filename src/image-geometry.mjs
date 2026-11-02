// Ratio expectations remain profile data. Ambiguous old requirements retain
// their existing natural-size oracle; explicit spec wording can select a box.
export const IMAGE_RATIO_SOURCES = Object.freeze(['natural', 'rendered-content', 'rendered-element', 'both']);
export function resolveImageRatioSource(requirement) {
  const declared = requirement.params?.ratioSource;
  if (declared !== undefined) return IMAGE_RATIO_SOURCES.includes(declared)
    ? { source: declared, origin: 'checklist.params.ratioSource' }
    : { source: null, origin: 'checklist.params.ratioSource', code: 'image-ratio-source-unsupported' };
  const text = String(requirement.sourceText || '');
  if (/原图|源图|固有|自然尺寸|素材比例|intrinsic|natural size/i.test(text)) return { source: 'natural', origin: 'spec-explicit-natural-wording' };
  if (/图片框|图像框|容器比例|元素框|边框盒|element box|container ratio/i.test(text)) return { source: 'rendered-element', origin: 'spec-explicit-element-wording' };
  if (/展示比例|显示比例|渲染比例|裁剪|铺满|rendered|visible content/i.test(text)) return { source: 'rendered-content', origin: 'spec-explicit-rendered-wording' };
  return { source: 'natural', origin: 'legacy-natural-default' };
}

// Serialized into a browser. Only reads the chosen instance-relative elements.
export function readPrimaryImageMetrics({ rootSelector, paths }) {
  const roots = document.querySelectorAll(rootSelector);
  if (roots.length !== 1) return [];
  const root = roots[0];
  const position = (text, space) => {
    const words = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
    const value = words[text] || text;
    if (/^-?[\d.]+%$/.test(value)) return space * parseFloat(value) / 100;
    if (/^-?[\d.]+(?:px)?$/.test(value)) return parseFloat(value);
    return null;
  };
  const ratio = (width, height) => width > 0 && height > 0 ? width / height : null;
  return paths.map((path) => {
    let node;
    try { node = path === ':scope' ? root : root.querySelector(path); } catch {}
    if (!node) return { path, code: 'primary-image-element-missing', loaded: false };
    const image = node.matches('picture') ? node.querySelector('img') : node.matches('img') ? node : null;
    const element = image || node, style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const px = (key) => parseFloat(style[key]) || 0;
    const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
    const contentBox = { x: rect.x + (px('borderLeftWidth') + px('paddingLeft')) * scaleX,
      y: rect.y + (px('borderTopWidth') + px('paddingTop')) * scaleY,
      width: Math.max(0, rect.width - (px('borderLeftWidth') + px('borderRightWidth') + px('paddingLeft') + px('paddingRight')) * scaleX),
      height: Math.max(0, rect.height - (px('borderTopWidth') + px('borderBottomWidth') + px('paddingTop') + px('paddingBottom')) * scaleY) };
    contentBox.ratio = ratio(contentBox.width, contentBox.height);
    const elementBox = { width: rect.width, height: rect.height, ratio: ratio(rect.width, rect.height) };
    const lazyAttributes = image ? [...image.attributes].filter((attribute) => /^(?:src|srcset|data-(?:.*-)?(?:src|srcset|original))$/i.test(attribute.name))
      .map((attribute) => ({ name: attribute.name, present: Boolean(attribute.value), length: attribute.value.length })) : [];
    const loaded = image ? image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 : true;
    const natural = image ? { width: image.naturalWidth, height: image.naturalHeight,
      ratio: loaded ? ratio(image.naturalWidth, image.naturalHeight) : null } : null;
    const base = { path, kind: image ? 'image' : 'background-image', loaded, complete: image?.complete ?? null,
      sourceEvidence: { attributes: lazyAttributes, currentSrcPresent: Boolean(image?.currentSrc) },
      natural, elementBox, contentBox, objectFit: image ? style.objectFit : null,
      objectPosition: image ? style.objectPosition : style.backgroundPosition };
    if (!image) return { ...base, rendered: { width: contentBox.width, height: contentBox.height,
      ratio: ratio(contentBox.width, contentBox.height), centered: /center/.test(style.backgroundPosition)
        || /^50(?:\.0+)?%\s+50(?:\.0+)?%$/.test(style.backgroundPosition), source: 'background-content-box' } };
    if (!loaded) return { ...base, rendered: null, code: 'primary-image-not-loaded' };
    const fit = style.objectFit;
    const contain = Math.min(contentBox.width / natural.width, contentBox.height / natural.height);
    const factor = fit === 'cover' ? Math.max(contentBox.width / natural.width, contentBox.height / natural.height)
      : fit === 'contain' ? contain : fit === 'scale-down' ? Math.min(1, contain) : 1;
    const objectWidth = fit === 'fill' ? contentBox.width : natural.width * factor;
    const objectHeight = fit === 'fill' ? contentBox.height : natural.height * factor;
    const tokens = style.objectPosition.trim().split(/\s+/);
    const dx = position(tokens[0] || '50%', contentBox.width - objectWidth);
    const dy = position(tokens[1] || '50%', contentBox.height - objectHeight);
    if (dx === null || dy === null) return { ...base, rendered: null, code: 'image-object-position-unresolved' };
    const visibleWidth = Math.max(0, Math.min(contentBox.width, dx + objectWidth) - Math.max(0, dx));
    const visibleHeight = Math.max(0, Math.min(contentBox.height, dy + objectHeight) - Math.max(0, dy));
    return { ...base, rendered: { width: visibleWidth, height: visibleHeight, ratio: ratio(visibleWidth, visibleHeight),
      objectWidth, objectHeight, offsetX: dx, offsetY: dy,
      centered: Math.abs(dx + objectWidth / 2 - contentBox.width / 2) < .5
        && Math.abs(dy + objectHeight / 2 - contentBox.height / 2) < .5,
      cropped: objectWidth > contentBox.width + .01 || objectHeight > contentBox.height + .01,
      source: 'object-fit-visible-content' } };
  });
}
