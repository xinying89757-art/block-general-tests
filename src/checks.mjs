const DEFINITIONS = [
  ['block-present', '区块容器存在'],
  ['img-alt', '图片具有 alt 属性'],
  ['link-href', '链接具有 href 属性'],
  ['cursor-pointer', '可点击元素的指针样式'],
  ['css-font-follow', '区块 CSS 跟随全局字体'],
  ['css-word-break', '区块 CSS 换行声明'],
  ['carousel-arrows', '轮播箭头显隐'],
];

async function readBlockCss(frame, block) {
  const encodeAppId = await block.getAttribute('data-encodeappid');
  if (!encodeAppId) return { text: null, reason: '区块无 data-encodeappid，无法关联专属 CSS。' };
  const links = await frame.locator('link[rel~="stylesheet"]').evaluateAll(
    (nodes) => nodes.map((node) => node.href),
  );
  const matched = links.filter((link) => link.includes(encodeAppId));
  if (!matched.length) return { text: null, reason: '未找到与 data-encodeappid 匹配的样式表。' };

  const urls = new Set();
  for (const link of matched) {
    const url = new URL(link);
    const parts = url.pathname.split('/');
    const concatIndex = parts.indexOf('concat');
    if (concatIndex >= 0 && url.pathname.includes(',')) {
      // Leadong concat/<version>/<file1>,<file2>: fetch only this block's
      // files, otherwise another block's font rule would cause a false failure.
      const files = parts.slice(concatIndex + 2).join('/').split(',')
        .filter((file) => file.includes(encodeAppId));
      if (!files.length) return { text: null, reason: '合并样式表中未能提取区块专属 CSS。' };
      const base = `${url.origin}${parts.slice(0, concatIndex).join('/')}/`;
      for (const file of files) {
        const single = new URL(file.replace(/^\//, ''), base);
        single.search = url.search;
        urls.add(single.href);
      }
    } else {
      urls.add(link);
    }
  }

  const contents = [];
  const partialFailures = [];
  const failureReasons = [];
  for (const url of urls) {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
    let content;
    let lastFailure;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      try {
        // Use the session's request context: CSS CDNs may disallow browser fetch
        // through CORS, while proxy, cookies and TLS policy still follow config.
        response = await frame.page().request.get(url, { timeout: 15_000 });
        if (!response.ok()) {
          lastFailure = `HTTP ${response.status()}`;
        } else {
          const type = response.headers()['content-type'] || '';
          const text = await response.text();
          if (/html/i.test(type) || /^\s*</.test(text)) lastFailure = '响应为 HTML';
          else content = text;
        }
      } catch (error) {
        lastFailure = `${error.name}: ${error.message}`;
      } finally {
        await response?.dispose();
      }
      if (content !== undefined) break;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (content !== undefined) contents.push(content);
    else {
      partialFailures.push(filename);
      failureReasons.push(`${filename}（${lastFailure}）`);
    }
  }
  if (!contents.length) {
    return { text: null, reason: `所有区块 CSS 均获取失败：${failureReasons.join('；')}。` };
  }
  return {
    text: contents.join('\n').replace(/\/\*[\s\S]*?\*\//g, ''),
    count: contents.length,
    partialFailures,
  };
}

/** Accepts the actual preview content Frame (not the preview shell Page). */
export async function runFrontChecks(frame, blockId) {
  const checks = [];
  const result = (id, status, detail, evidence) => ({
    id, name: DEFINITIONS.find(([key]) => key === id)[1], status, detail,
    ...(evidence ? { evidence } : {}),
  });
  const blocks = frame.locator(`.siteblocks-setting-wrap[data-appid=${JSON.stringify(String(blockId))}]`);
  try {
    await blocks.first().waitFor({ state: 'attached', timeout: 30_000 });
  } catch (error) {
    checks.push(result('block-present', 'fail', error.name === 'TimeoutError'
      ? `预览内容 frame 中未找到区块 ${blockId}。` : `读取区块失败：${error.message}`));
    return checks.concat(DEFINITIONS.slice(1).map(([id]) => result(id, 'skip', '区块存在检查失败，跳过后续检查。')));
  }
  const count = await blocks.count();
  const block = blocks.first();
  checks.push(result('block-present', 'pass', `找到 ${count} 个目标容器；检查第一个实例。`));

  const check = async (id, callback) => {
    try {
      const { status, detail, evidence } = await callback();
      checks.push(result(id, status, detail, evidence));
    } catch (error) {
      checks.push(result(id, 'fail', `检查执行异常：${error.message}`));
    }
  };

  for (const [id, selector, attribute] of [['img-alt', 'img', 'alt'], ['link-href', 'a', 'href']]) {
    await check(id, async () => {
      const data = await block.locator(selector).evaluateAll((nodes, attr) => ({
        total: nodes.length,
        missing: nodes.flatMap((node, index) => node.hasAttribute(attr) ? [] : [index + 1]),
      }), attribute);
      if (!data.total) return { status: 'skip', detail: `区块内无 ${selector} 元素。` };
      return {
        status: data.missing.length ? 'fail' : 'pass',
        detail: `共 ${data.total} 个 ${selector}；缺少 ${attribute} 属性：${data.missing.join(', ') || '无'}。`,
      };
    });
  }

  await check('cursor-pointer', async () => {
    const samples = await block.locator('[href]').evaluateAll((nodes) => nodes
      .filter((node) => {
        const href = (node.getAttribute('href') || '').replace(/\s+/g, '').toLowerCase();
        if (!href || /^javascript:(?:;|void\(0\);?)$/.test(href)) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility === 'visible'
          && style.pointerEvents !== 'none' && node.getClientRects().length > 0;
      })
      .slice(0, 20)
      .map((node, index) => ({ sample: index + 1, tag: node.tagName, cursor: getComputedStyle(node).cursor })));
    if (!samples.length) return { status: 'skip', detail: '没有可见且带有效 href 的可点击样本。' };
    const failures = samples.filter((sample) => sample.cursor !== 'pointer');
    return {
      status: failures.length ? 'fail' : 'pass',
      detail: `抽样 ${samples.length} 个元素（最多 20 个）；非 pointer：${JSON.stringify(failures)}。`,
    };
  });

  // A fetch failure is explicitly skippable; DOM/script failures remain failures.
  let css;
  let cssError;
  try { css = await readBlockCss(frame, block); } catch (error) { cssError = error; }
  const cssChecks = [
    {
      id: 'css-font-follow', declaration: 'font-family',
      pattern: /(?:^|[;{])\s*font-family\s*:\s*([^;}\n]+)/gi,
      values: true,
    },
    {
      id: 'css-word-break', declaration: 'word-break: break-word',
      pattern: /(?:^|[;{])\s*word-break\s*:\s*break-word\s*(?:!important\s*)?(?=[;}\n]|$)/gi,
      values: false,
    },
  ];
  for (const { id, pattern, declaration, values } of cssChecks) {
    await check(id, async () => {
      const emptyEvidence = { filesRead: 0, declaration, occurrences: 0 };
      if (cssError) return {
        status: 'skip', detail: `读取区块 CSS 时发生异常，无法取证：${cssError.message}`,
        evidence: emptyEvidence,
      };
      if (css.text === null) return {
        status: 'skip', detail: `无法读取区块 CSS，跳过取证：${css.reason}`,
        evidence: emptyEvidence,
      };
      const matches = [...css.text.matchAll(pattern)];
      const occurrenceCount = matches.length;
      const found = occurrenceCount > 0;
      const evidence = {
        filesRead: css.count,
        declaration,
        occurrences: occurrenceCount,
        ...(values ? { values: [...new Set(matches.map((match) => match[1].trim()))].slice(0, 5) } : {}),
        ...(css.partialFailures?.length ? { partialFailures: css.partialFailures } : {}),
      };
      const partialNote = css.partialFailures?.length
        ? `未纳入 ${css.partialFailures.length} 份未成功读取的 CSS：${css.partialFailures.join('、')}。` : '';
      return {
        status: 'record',
        detail: `已读取 ${css.count} 份区块 CSS；${found ? '发现' : '未发现'}目标声明 ${declaration}，命中 ${occurrenceCount} 次。${values && found
          ? `声明值：${evidence.values.join('；')}。` : ''}${partialNote}`,
        evidence,
      };
    });
  }

  await check('carousel-arrows', async () => {
    const carousels = await block.evaluate((container) => {
      const roots = [...new Set(container.querySelectorAll('.slick-slider, .slick-initialized'))];
      return roots.map((root, index) => {
        const instance = root.slick;
        const dataOptions = root.getAttribute('data-slick');
        const options = instance?.options || (dataOptions ? JSON.parse(dataOptions) : {});
        const owns = (node) => node.closest('.slick-slider, .slick-initialized') === root;
        const slides = [...root.querySelectorAll('.slick-slide:not(.slick-cloned)')].filter(owns);
        const slideCount = Number(instance?.slideCount ?? slides.length);
        const slidesToShow = Number(options.slidesToShow ?? 1);
        const arrows = [...root.querySelectorAll('.slick-arrow')].filter(owns).map((arrow) => {
          let hidden = false;
          for (let node = arrow; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
              || Number(style.opacity) === 0 || node.hidden) hidden = true;
          }
          return { hidden: hidden || !arrow.getClientRects().length };
        });
        const initialized = root.classList.contains('slick-initialized');
        const valid = initialized && slideCount > 0 && Number.isFinite(slidesToShow) && slidesToShow > 0;
        const shouldHide = slideCount <= slidesToShow || options.arrows === false;
        // With insufficient slides, Slick may omit the arrow DOM entirely.
        const matches = shouldHide ? arrows.every((arrow) => arrow.hidden)
          : arrows.length >= 2 && arrows.every((arrow) => !arrow.hidden);
        return { carousel: index + 1, initialized, slideCount, slidesToShow, shouldHide, arrows, pass: valid && matches };
      });
    });
    if (!carousels.length) return { status: 'skip', detail: '区块内无 Slick 轮播。' };
    return {
      status: carousels.every((carousel) => carousel.pass) ? 'pass' : 'fail',
      detail: JSON.stringify(carousels),
    };
  });
  return checks;
}
