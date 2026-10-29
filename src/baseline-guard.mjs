import { applyBaseline } from './baseline.mjs';
import { launchSession } from './browser.mjs';
import { openEditor, ensureTargetPage } from './editor.mjs';
import { baselineRestoreTarget, widgetSession } from './capabilities/shared.mjs';
import { readButtonPopover } from './capabilities/button-link.mjs';
import { assertOccurrencesUnambiguous, withOccurrences, normalizeControlIdentity } from './baseline-identity.mjs';

const isAutotest = (value) => typeof value === 'string' && /^AUTOTEST-/i.test(value);
const sameControl = (a, b) => {
  const left = normalizeControlIdentity(a), right = normalizeControlIdentity(b);
  return left.type === right.type && (a.identity ? left.identity === right.identity : left.label === right.label)
  && (a.value === undefined || a.value === b.value)
  && (a.occurrence === undefined || a.occurrence === b.occurrence);
};

export { baselineRestoreTarget };

export function baselineValueFor(baseline, type, label) {
  for (const step of baseline || []) {
    const item = (step.want || []).find((want) => step.type === type && want.label === label);
    if (item) return item.to;
  }
  return undefined;
}

function assertBaselineClean(baseline) {
  for (const step of baseline || []) for (const want of step.want || []) {
    if (isAutotest(want.to)) throw new Error(`画像基线错误：${step.type} / ${want.label} 的值含 AUTOTEST- 前缀`);
  }
}

function entries(steps) {
  return (steps || []).flatMap((step) => (step.want || []).map((want) => ({ step, want })));
}

export function diffAgainstBaseline(baseline, current) {
  assertBaselineClean(baseline);
  assertOccurrencesUnambiguous(baseline);
  const expectedEntries = entries(baseline);
  const currentEntries = entries(current);
  for (const { step, want } of expectedEntries) {
    if (want.occurrence !== undefined) continue;
    const candidates = entries(current).filter(({ step: currentStep, want: currentWant }) =>
      currentStep.type === step.type && (currentStep.wrapIndex ?? 0) === (step.wrapIndex ?? 0)
      && sameControl(want, currentWant)
      && (want.value === undefined || currentWant.value === want.value));
    if (candidates.length > 1) {
      throw new Error(`旧基线身份不唯一：${want.label} (${want.type}) 当前匹配到 ${candidates.length} 个控件；请补 occurrence。`);
    }
  }
  const seen = new Set();
  const diffs = [];
  for (const { step, want } of currentEntries) {
    const index = expectedEntries.findIndex(({ step: expectedStep, want: expectedWant }, candidateIndex) =>
      expectedStep.type === step.type && (expectedStep.wrapIndex ?? 0) === (step.wrapIndex ?? 0)
      && sameControl(expectedWant, want) && !seen.has(candidateIndex));
    const baselineEntry = index < 0 ? null : expectedEntries[index];
    if (want.type === 'text' && want.label === '链接网址' && isGarbledUrl(want.to)) {
      if (baselineEntry) seen.add(index);
      diffs.push({ stepTitle: step.title ?? null, type: step.type, label: want.label,
        ...(want.occurrence === undefined ? {} : { occurrence: want.occurrence }),
        expected: baselineEntry?.want.to ?? null, actual: want.to, reason: 'garbled-url' });
      continue;
    }
    if (isAutotest(want.to)) {
      diffs.push({ stepTitle: step.title ?? null, type: step.type, label: want.label,
        ...(want.occurrence === undefined ? {} : { occurrence: want.occurrence }),
        expected: baselineEntry?.want.to ?? null, actual: want.to, reason: 'autotest-prefix' });
    } else if (baselineEntry) {
      seen.add(index);
      if (baselineEntry.want.to !== want.to) diffs.push({ stepTitle: step.title ?? null,
        type: step.type, label: want.label, ...(want.occurrence === undefined ? {} : { occurrence: want.occurrence }),
        expected: baselineEntry.want.to, actual: want.to, reason: 'value-mismatch' });
    }
  }
  for (const [index, { step, want }] of expectedEntries.entries()) {
    if (!seen.has(index) && !currentEntries.some(({ step: currentStep, want: currentWant }) =>
      currentStep.type === step.type && (currentStep.wrapIndex ?? 0) === (step.wrapIndex ?? 0)
      && sameControl(want, currentWant))) {
      diffs.push({ stepTitle: step.title ?? null, type: step.type, label: want.label,
        ...(want.occurrence === undefined ? {} : { occurrence: want.occurrence }),
        expected: want.to, actual: null, reason: 'missing-control' });
    }
  }
  return diffs;
}

export function isGarbledUrl(value) {
  return typeof value === 'string' && (/\s/.test(value) || /[\u3000-\u303f\uff00-\uffef]/.test(value));
}

function serialize(control) {
  if (!control.label || (control.readOnly && !['checkbox', 'radio'].includes(control.type))) return null;
  if (control.type === 'radio' && !control.checked) return null;
  if (control.type === 'checkbox' || control.type === 'radio') return {
    label: control.label, type: control.type, ...(control.value ? { value: control.value } : {}), to: control.checked,
  };
  return { label: control.label, type: control.type, to: control.value };
}

export async function readCurrentState({ page, canvas, config, baseline }) {
  const current = [];
  for (const definition of baseline || []) {
    if (definition.skipped) { current.push(structuredClone(definition)); continue; }
    if (definition.kind === 'button-popover') {
      const button = await readButtonPopover({ page, canvas, config });
      current.push({ ...structuredClone(definition), want: button.want });
      continue;
    }
    const session = widgetSession({ page, canvas, config, type: definition.type,
      title: definition.title, wrapIndex: definition.wrapIndex });
    try {
      await session.open();
      const controls = await session.read();
      const want = withOccurrences(controls, serialize);
      current.push({ ...structuredClone(definition), want });
    } finally { await session.cancel(); }
  }
  return current;
}

export async function guardBaseline({ page, canvas, config, baseline, launch = launchSession }) {
  assertBaselineClean(baseline);
  const current = await readCurrentState({ page, canvas, config, baseline });
  const diffs = diffAgainstBaseline(baseline, current);
  if (!diffs.length) return { residue: false };
  const restored = await applyBaseline({ page, canvas, config, baseline });
  if (!restored.allVerified) throw new Error(`基线残留恢复失败：${JSON.stringify(restored.steps)}`);
  let fresh;
  try {
    fresh = await launch(config);
    fresh.page = (await openEditor(fresh.page, config)).page;
    const target = await ensureTargetPage(fresh.page, config);
    const freshCurrent = await readCurrentState({ page: fresh.page, canvas: target.frame, config, baseline });
    const freshDiffs = diffAgainstBaseline(baseline, freshCurrent);
    if (freshDiffs.length) throw new Error(`新会话复验仍有基线差异：${JSON.stringify(freshDiffs)}`);
    return { residue: true, diffs, restored, verifiedFresh: true, freshDiffs };
  } finally { await fresh?.browser?.close(); }
}
