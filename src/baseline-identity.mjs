const identityKey = ({ label, type, value }) => JSON.stringify([label, type, value]);

export function withOccurrences(controls, serialize) {
  const serialized = controls.map((control) => serialize(control));
  const counts = new Map();
  for (const item of serialized) {
    if (!item) continue;
    const key = identityKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const seen = new Map();
  return serialized.map((item) => {
    if (!item) return null;
    const key = identityKey(item);
    const occurrence = seen.get(key) || 0;
    seen.set(key, occurrence + 1);
    return counts.get(key) > 1 ? { ...item, occurrence } : item;
  }).filter(Boolean);
}

export function matchingControls(controls, wanted) {
  return controls.filter((item) => item.label === wanted.label && item.type === wanted.type
    && (wanted.value === undefined || item.value === wanted.value));
}

export function matchControl(controls, wanted, { strictLegacy = true } = {}) {
  const candidates = matchingControls(controls, wanted);
  if (wanted.occurrence !== undefined) return candidates[wanted.occurrence] || null;
  if (strictLegacy && candidates.length > 1) {
    throw new Error(`旧基线身份不唯一：${wanted.label} (${wanted.type}${wanted.value === undefined ? '' : `=${wanted.value}`}) 匹配到 ${candidates.length} 个控件；请补 occurrence。`);
  }
  return candidates[0] || null;
}

export function assertOccurrencesUnambiguous(steps) {
  for (const step of steps || []) {
    const groups = new Map();
    for (const want of step.want || []) {
      const key = identityKey(want);
      groups.set(key, [...(groups.get(key) || []), want]);
    }
    for (const group of groups.values()) {
      if (group.length > 1 && group.some((item) => item.occurrence === undefined)) {
        throw new Error(`旧基线身份重复但未记录 occurrence：${group[0].label} (${group[0].type})。`);
      }
      if (group.some((item) => item.occurrence !== undefined)) {
        const values = group.map((item) => item.occurrence).sort((a, b) => a - b);
        if (values.some((value, index) => !Number.isInteger(value) || value !== index)) {
          throw new Error(`基线 occurrence 必须是从 0 开始且不重复的连续序号：${group[0].label} (${group[0].type})。`);
        }
      }
    }
  }
}
