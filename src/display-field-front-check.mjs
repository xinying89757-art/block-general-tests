const DISPLAY_FIELD_CHECK_ID = 'pld-display-field-batch-effect';

export async function retryDisplayFieldSnapshot(read, { attempts = 3, delayMs = 250,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let lastCards = [];
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const cards = await read();
      if (Array.isArray(cards) && cards.length) return { status: 'ready', cards, attempts: attempt + 1 };
      lastCards = Array.isArray(cards) ? cards : [];
    } catch (error) { lastError = String(error?.message || error); }
    if (attempt + 1 < attempts) await wait(delayMs);
  }
  return { status: 'unresolved', cards: lastCards, attempts, reason: 'effect-unresolved-on-canvas',
    lastError: lastError ? lastError.slice(0, 240) : null };
}

function displayFieldRows(report) {
  return (report?.checks || []).filter((row) => row?.setting === 'display-field'
    || row?.settingKey === 'display-field');
}

/** Resolve only explicit writes made by the product-list-display capability. */
export function resolveDisplayFieldFrontExpectations(report) {
  return displayFieldRows(report).map((row) => {
    const detailEvidence = row.batchResult?.evidence?.effectCheck?.evidence
      || row.rerunAloneResult?.evidence?.effectCheck?.evidence || row.evidence?.effectCheck?.evidence || {};
    const rerunEvidence = row.rerunAloneResult?.evidence || {};
    const savedControls = [...(report?.block?.currentValues || []), ...(report?.currentValues || [])];
    const related = savedControls.filter((item) => item.settingId === row.id
      && item.type === 'checkbox' && typeof item.label === 'string' && item.label.trim());
    const labels = [detailEvidence.fieldLabel, rerunEvidence.control, row.fieldLabel,
      ...related.map((item) => item.label)].filter((value) => typeof value === 'string' && value.trim());
    const uniqueLabels = [...new Set(labels.map((value) => value.trim()))];
    const expectedVisible = typeof row.expected === 'boolean' ? row.expected
      : typeof row.actual === 'boolean' ? row.actual
        : typeof rerunEvidence.afterSave === 'boolean' ? rerunEvidence.afterSave : null;
    return { id: DISPLAY_FIELD_CHECK_ID, setting: 'display-field', fieldLabel: uniqueLabels.length === 1 ? uniqueLabels[0] : null,
      expectedVisible, sourceCheckId: row.id,
      resolutionReason: uniqueLabels.length !== 1 ? 'display-field-label-unresolved'
        : expectedVisible === null ? 'display-field-written-state-unresolved' : null };
  });
}

/** Pure verdict logic shared by the front runner and offline tests. */
export function assessDisplayFieldCards({ cards, fieldLabel, expectedVisible } = {}) {
  if (!fieldLabel || typeof expectedVisible !== 'boolean') return { status: 'human-review',
    reason: { code: 'display-field-expectation-unresolved' }, matchedCards: null, cardCount: cards?.length || 0 };
  if (!Array.isArray(cards) || cards.length === 0) return { status: 'human-review',
    reason: { code: 'display-field-cards-unresolved' }, matchedCards: null, cardCount: 0 };
  const present = cards.map((card) => Boolean(card?.visible && card?.labels?.includes(fieldLabel)));
  const matchedCards = present.filter(Boolean).length;
  const pass = expectedVisible ? matchedCards === cards.length : matchedCards === 0;
  return { status: pass ? 'pass' : 'fail', reason: { code: pass ? 'display-field-front-match' : 'display-field-front-mismatch' },
    matchedCards, cardCount: cards.length, expectedVisible, fieldLabel };
}

/** Read repeated product-card-shaped containers inside the already resolved instance root. */
export async function readDisplayFieldCards(page, { rootSelector, fieldLabel } = {}) {
  return page.evaluate(({ rootSelector, fieldLabel }) => {
    const roots = document.querySelectorAll(rootSelector);
    if (roots.length !== 1) return { rootCount: roots.length, cards: [] };
    const root = roots[0];
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const ownText = (node) => [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const hasLabel = (card) => [...card.querySelectorAll('*')].some((node) => {
      if (!visible(node)) return false;
      const text = ownText(node).replace(/\s+/g, ' ').trim();
      return text === fieldLabel || text.startsWith(`${fieldLabel}:`) || text.startsWith(`${fieldLabel}：`);
    });
    const hasCardContent = (node) => Boolean(node.querySelector('a[href],img,picture,[role="img"]'))
      && Boolean((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim());
    const signature = (node) => `${node.tagName}|${[...node.classList].filter((name) => !/blockCon\d+/i.test(name)).sort().join('.')}`;
    const groups = [];
    for (const parent of [root, ...root.querySelectorAll('*')]) {
      const bySignature = new Map();
      for (const child of parent.children) {
        if (!visible(child) || !hasCardContent(child)) continue;
        const key = signature(child);
        bySignature.set(key, [...(bySignature.get(key) || []), child]);
      }
      for (const nodes of bySignature.values()) if (nodes.length >= 2) groups.push(nodes);
    }
    groups.sort((left, right) => right.length - left.length);
    const cards = groups[0] || [];
    return { rootCount: 1, cards: cards.map((card) => ({ visible: true, labels: hasLabel(card) ? [fieldLabel] : [] })) };
  }, { rootSelector, fieldLabel });
}

export async function runDisplayFieldFrontChecks({ page, rootSelector, settingsReport, onCheck = () => {} } = {}) {
  const expectations = resolveDisplayFieldFrontExpectations(settingsReport);
  const output = [];
  for (const expectation of expectations) {
    let result;
    if (expectation.resolutionReason) {
      result = { status: 'human-review', reason: { code: expectation.resolutionReason }, matchedCards: null, cardCount: null };
    } else {
      try {
        const evidence = await readDisplayFieldCards(page, { rootSelector, fieldLabel: expectation.fieldLabel });
        result = evidence.rootCount !== 1
          ? { status: 'human-review', reason: { code: 'display-field-instance-root-unresolved' }, matchedCards: null, cardCount: evidence.cards.length }
          : assessDisplayFieldCards({ cards: evidence.cards, fieldLabel: expectation.fieldLabel,
            expectedVisible: expectation.expectedVisible });
      } catch (error) {
        result = { status: 'human-review', reason: { code: 'display-field-front-read-unavailable' },
          matchedCards: null, cardCount: null, error: String(error?.message || error).slice(0, 240) };
      }
    }
    const check = { id: expectation.id, name: '展示字段前台可见性', status: result.status,
      setting: 'display-field', expected: expectation.expectedVisible,
      actual: result.matchedCards, detail: result.status === 'pass' ? '前台产品卡展示字段与本次保存值一致。'
        : result.status === 'fail' ? '前台产品卡展示字段与本次保存值不一致。' : '前台产品卡或字段标签无法唯一读取，需人工判断。',
      reason: { stage: 'front', code: result.reason.code },
      evidence: { fieldLabel: expectation.fieldLabel, expectedVisible: expectation.expectedVisible,
        matchedCards: result.matchedCards, cardCount: result.cardCount, sourceCheckId: expectation.sourceCheckId,
        ...(result.error ? { error: result.error } : {}) } };
    output.push(check);
    onCheck(check);
  }
  return output;
}
