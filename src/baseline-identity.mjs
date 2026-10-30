const identityKey = ({ label, type, value, identity }) => JSON.stringify([identity || label, type, value]);

export function normalizeControlIdentity(item) {
  // The editor's select-all checkbox label concatenates every field name.
  // Keep its semantic role and DOM order, so changing the available field
  // list cannot turn it into a false missing-control residue.
  if (item?.type === 'checkbox' && /^全选(?:\s|$)/.test(item.label || '')) {
    return { ...item, label: '全选', identity: 'select-all' };
  }
  return item;
}

export function withOccurrences(controls, serialize) {
  const serialized = controls.map((control) => {
    const item = serialize(control);
    return item ? normalizeControlIdentity(item) : null;
  });
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
  wanted = normalizeControlIdentity(wanted);
  return controls.filter((candidate) => {
    const item = normalizeControlIdentity(candidate);
    return (wanted.identity ? item.identity === wanted.identity : item.label === wanted.label)
      && item.type === wanted.type
      && (wanted.value === undefined || item.value === wanted.value);
  });
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
