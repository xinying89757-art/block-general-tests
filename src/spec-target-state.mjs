// A checklist item may activate exactly one mapped target. There is no instance
// scan, inferred disclosure, or fallback click. Callers retain their own oracle.
export const SPEC_STATES = Object.freeze(['hover', 'focus', 'selected', 'expanded', 'active']);

export function inferSpecState(text) {
  const patterns = [['hover', /悬停|鼠标经过|\bhover\b/i], ['focus', /聚焦|焦点|\bfocus\b/i],
    ['selected', /选中|\bselected\b/i], ['active', /当前|激活|\bactive\b/i], ['expanded', /展开|\bexpanded\b/i]];
  const matches = patterns.filter(([, pattern]) => pattern.test(String(text)));
  // Ambiguous source wording stays unmapped; do not choose an interaction.
  return matches.length === 1 ? { kind: matches[0][0], target: 'scope' } : undefined;
}

export function validateSpecState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'state must be an object';
  if (!SPEC_STATES.includes(state.kind)) return 'state.kind must be hover, focus, selected, expanded or active';
  if (state.target !== 'scope' && (typeof state.target !== 'string' || !state.target.trim())) return 'state.target must be scope or a non-empty instance-relative selector';
  if (state.timeoutMs !== undefined && (!Number.isInteger(state.timeoutMs) || state.timeoutMs < 100 || state.timeoutMs > 30000)) return 'state.timeoutMs must be an integer in [100, 30000]';
  if (state.restoreTarget !== undefined && (typeof state.restoreTarget !== 'string' || !state.restoreTarget.trim())) return 'state.restoreTarget must be a non-empty instance-relative selector';
  if (Object.keys(state).some((key) => !['kind', 'target', 'timeoutMs', 'restoreTarget'].includes(key))) return 'state contains an unknown property';
  return null;
}

function stateError(code) { const error = new Error(code); error.code = code; return error; }
async function bounded(operation, timeoutMs, onTimeout = () => {}) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => { onTimeout(); reject(stateError('spec-state-timeout')); }, timeoutMs);
  })]); } finally { clearTimeout(timer); }
}

export function specScopeMapping(requirement, profile) {
  const params = requirement.params || {};
  const ids = params.styleCheckIds || [params.styleCheckId].filter(Boolean);
  const items = (profile?.capabilities || []).flatMap((capability) => capability.styleSpec?.items || [])
    .filter((item) => ids.some((id) => String(id).replace(/^bss-/, '') === item.id));
  return { selectors: [...new Set([params.selector, ...(params.selectorCandidates || []), ...items.flatMap((item) =>
    [...Object.values(item.learnedSelectors || {}).flatMap((entries) => (Array.isArray(entries) ? entries : []).map((entry) => entry?.selector)),
      item.selector, ...(item.selectorCandidates || [])])].filter(Boolean))],
    properties: [...new Set(items.flatMap((item) => Object.keys(item.props || {})))] };
}

async function uniqueVisible(root, selectors) {
  for (const selector of selectors) {
    const found = root.locator(selector);
    const count = await found.count();
    // Scope candidates are ordered alternatives; never choose among multiple
    // matches and never search outside the instance.
    if (count > 1) throw stateError('spec-state-target-ambiguous');
    if (count === 1 && await found.isVisible()) return found;
  }
  throw stateError('spec-state-target-unresolved');
}

function semantics(node, kind) {
  if (kind === 'expanded') return node.hasAttribute('aria-expanded') ? node.getAttribute('aria-expanded') === 'true'
    : node.matches('details,summary') ? Boolean((node.matches('details') ? node : node.parentElement).open) : null;
  if (kind === 'selected') return node.matches('input[type=checkbox],input[type=radio]') ? node.checked
    : node.hasAttribute('aria-selected') ? node.getAttribute('aria-selected') === 'true'
      : node.hasAttribute('aria-pressed') ? node.getAttribute('aria-pressed') === 'true' : null;
  return node.hasAttribute('aria-current') ? !['false', ''].includes(node.getAttribute('aria-current')) : null;
}

export async function readSpecTargetState({ page, rootSelector, requirement, profile, properties }) {
  const state = requirement.state;
  const invalid = validateSpecState(state);
  if (invalid) throw stateError('spec-state-invalid');
  const timeoutMs = state.timeoutMs || 4000;
  const evidence = { kind: state.kind, restored: false, timeoutMs };
  const setup = await bounded(async () => {
    const root = page.locator(rootSelector);
    if (await root.count() !== 1) throw stateError('spec-state-instance-not-unique');
    const mapping = specScopeMapping(requirement, profile);
    const scope = await uniqueVisible(root, mapping.selectors);
    const target = state.target === 'scope' ? scope : await uniqueVisible(root, [state.target]);
    // Capture only prior focus/hover handles, not text/content or setting data.
    const priorFocus = await page.evaluateHandle(() => document.activeElement);
    const priorHover = await page.evaluateHandle(() => [...document.querySelectorAll(':hover')].at(-1) || null);
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    return { root, scope, target, priorFocus, priorHover, scroll };
  }, timeoutMs);
  const { root, scope, target, priorFocus, priorHover, scroll } = setup;
  return (async () => {
    const restorePointer = async () => {
      // Restore the original hovered element when available; otherwise use a
      // viewport corner outside this target (never a discovered control).
      const box = await target.boundingBox?.();
      const viewport = page.viewportSize?.() || { width: 1, height: 1 };
      const corners = [[0, 0], [viewport.width - 1, viewport.height - 1], [0, viewport.height - 1], [viewport.width - 1, 0]];
      const point = corners.find(([x, y]) => !box || x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height);
      if (!point) throw stateError('spec-state-pointer-restoration-unavailable');
      await page.mouse.move(...point);
      if (await priorHover.evaluate((node) => Boolean(node?.isConnected && node !== document.body && node !== document.documentElement))) {
        await priorHover.asElement()?.hover({ timeout: timeoutMs });
      }
    };
    let restore = async () => {};
    let movedPointer = false;
    let observation, actionError, restoreError;
    let expired = false;
    const checkDeadline = () => { if (expired) throw stateError('spec-state-timeout'); };
    try {
      await bounded(async () => {
        await target.scrollIntoViewIfNeeded({ timeout: timeoutMs });
        checkDeadline();
        if (state.kind === 'hover') {
          movedPointer = true;
          await target.hover({ timeout: timeoutMs });
        } else if (state.kind === 'focus') {
          restore = async () => { await target.evaluate((node) => node.blur()); await priorFocus.evaluate((node) => node?.isConnected && node.focus()); };
          await target.focus({ timeout: timeoutMs });
          if (!await target.evaluate((node) => node === document.activeElement)) throw stateError('spec-state-not-observed');
        } else {
          const before = await target.evaluate(semantics, state.kind);
          if (state.kind === 'active' && before === null) {
            if (await target.evaluate((node) => Boolean(node.closest('a[href],form') || node.form))) throw stateError('spec-state-unsafe-activation');
            restore = () => page.mouse.up();
            movedPointer = true;
            await target.hover({ timeout: timeoutMs });
            checkDeadline();
            await page.mouse.down();
          } else if (before === null) throw stateError('spec-state-semantics-unavailable');
          else if (!before) {
            const safe = await target.evaluate((node) => !node.closest('a[href],area[href],form')
              && !node.form && !(node.matches('button') && node.type !== 'button' && node.closest('form')));
            if (!safe) throw stateError('spec-state-unsafe-activation');
            const restoreTarget = state.restoreTarget ? await uniqueVisible(root, [state.restoreTarget]) : target;
            if (await restoreTarget.evaluate((node) => Boolean(node.closest('a[href],form') || node.form))) throw stateError('spec-state-unsafe-restoration');
            restore = async () => {
              if (await target.evaluate(semantics, state.kind) !== before) await restoreTarget.click({ timeout: timeoutMs, noWaitAfter: true });
              await target.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {}))));
              if (await target.evaluate(semantics, state.kind) !== before) throw stateError('spec-state-restore-failed');
            };
            checkDeadline();
            movedPointer = true;
            await target.click({ timeout: timeoutMs, noWaitAfter: true });
            if (!await target.evaluate(semantics, state.kind)) throw stateError('spec-state-not-observed');
          }
        }
        // Only the declared scope is observed. Let its own CSS transition finish;
        // a stuck animation is bounded by the enclosing deadline.
        observation = await scope.evaluate(async (node, properties) => {
          await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
          const style = getComputedStyle(node);
          return Object.fromEntries(properties.map((property) => [property, style[property] || style.getPropertyValue(property)]));
        }, properties);
      }, timeoutMs, () => { expired = true; });
    } catch (error) { actionError = error; }
    finally {
      try {
        await bounded(async () => {
          await restore();
          if (movedPointer) await restorePointer();
          await page.evaluate(() => { document.activeElement?.blur?.(); });
          await priorFocus.evaluate((node) => node?.isConnected && node.focus());
        }, timeoutMs);
        await bounded(() => page.evaluate(({ x, y }) => scrollTo(x, y), scroll), timeoutMs);
        evidence.restored = true;
      } catch (error) { restoreError = error; }
      await bounded(() => priorFocus.dispose(), timeoutMs).catch(() => {});
      await bounded(() => priorHover.dispose(), timeoutMs).catch(() => {});
    }
    if (restoreError) throw stateError('spec-state-restore-failed');
    if (actionError) throw actionError;
    return { observation, evidence };
  })().catch((error) => {
    // Errors contain no target selectors, page contents, or credentials.
    const safe = stateError(error.code || (error.name === 'TimeoutError' ? 'spec-state-timeout' : 'spec-state-action-failed'));
    safe.evidence = evidence;
    throw safe;
  });
}
