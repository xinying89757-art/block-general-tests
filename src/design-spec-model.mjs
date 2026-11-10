import { collectHumanReview } from './human-review.mjs';
import { validateSpecState } from './spec-target-state.mjs';
import { resolveImageRatioSource } from './image-geometry.mjs';
export const DESIGN_CHECK_TYPES = Object.freeze([
  'color-default', 'color-scope', 'typography', 'module-width', 'height-fit',
  'text-truncation', 'image-ratio', 'overflow-threshold', 'nav-hierarchy-levels', 'search-box-per-field',
  'default-expand', 'selected-tag-behaviour', 'mobile-layout',
  'filter-oracle', 'filter-interaction', 'filter-layout', 'manual',
]);

// The fixed catalog is shared by the dry-run planner and report assembly.
// Profile-specific selectors/thresholds remain checklist data.
export const DESIGN_CHECK_SUPPORT = Object.freeze({
  'color-default': { front: 'implemented', needs: ['expected.value'] },
  'color-scope': { front: 'implemented', needs: ['params.styleCheckId(s) or learned scope'] },
  typography: { front: 'implemented', needs: ['expected typography properties', 'profile-scoped mapping'] },
  'module-width': { editor: 'implemented', needs: ['expected.expandable', 'expected.default'] },
  'height-fit': { front: 'unsupported', needs: ['human review'] },
  'text-truncation': { front: 'implemented', needs: ['expected.maxLines', 'params.selectorCandidates (optional)'] },
  'image-ratio': { front: 'implemented', needs: ['expected.ratio', 'content image inside item/card'] },
  'overflow-threshold': { front: 'implemented', needs: ['expected.threshold/direction', 'params.containerSelector/itemSelector'] },
  'nav-hierarchy-levels': { front: 'implemented', needs: ['expected.levels or expected.maxLevel', 'params.itemSelector (optional)'] },
  'search-box-per-field': { front: 'unsupported', needs: ['human review'] },
  'default-expand': { front: 'implemented', needs: ['expected.level', 'hierarchy controls'] },
  'selected-tag-behaviour': { front: 'unsupported', needs: ['human review'] },
  'mobile-layout': { front: 'implemented', needs: ['structured expected values', 'mobile viewport'] },
  'filter-oracle': { front: 'implemented', needs: ['expected.resultSet or cases, including empty sets'] },
  'filter-interaction': { front: 'implemented', needs: ['expected interaction'] },
  'filter-layout': { front: 'implemented', editor: 'implemented', needs: ['expected.columns or layout flags'] },
  manual: { front: 'unsupported', needs: ['human review'] },
});

export function designCheckSupport(type, stage) {
  const support = DESIGN_CHECK_SUPPORT[type]?.[stage];
  return support === 'implemented' ? 'run' : 'unsupported';
}

export function designRequirementPlan(requirement) {
  const stages = requirement.checkStage === 'both' ? ['editor', 'front'] : [requirement.checkStage];
  const stagePlans = stages.map((stage) => {
    if (designCheckSupport(requirement.checkType, stage) === 'unsupported') return { stage, status: 'unsupported' };
    const expected = requirement.expected || {}, params = requirement.params || {};
    let missing = [];
    if (requirement.checkType === 'module-width' && expected.expandable && !expected.default) missing = ['expected.default'];
    if (requirement.checkType === 'text-truncation' && !(Number(expected.maxLines) >= 1)) missing = ['expected.maxLines'];
    if (requirement.checkType === 'image-ratio' && !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(String(expected.ratio || ''))) missing = ['expected.ratio'];
    if (requirement.checkType === 'default-expand' && !(Number.isInteger(Number(expected.level)) && Number(expected.level) > 0)) missing = ['expected.level'];
    if (requirement.checkType === 'overflow-threshold') missing = [
      ...(!(Number.isInteger(Number(expected.threshold)) && Number(expected.threshold) >= 0) ? ['expected.threshold'] : []),
      ...(!['horizontal', 'vertical'].includes(expected.direction) ? ['expected.direction'] : []),
      ...(!params.containerSelector ? ['params.containerSelector'] : []), ...(!params.itemSelector ? ['params.itemSelector'] : []),
    ];
    if (requirement.checkType === 'nav-hierarchy-levels'
      && !((Array.isArray(expected.levels) && expected.levels.length) || (Number.isInteger(Number(expected.maxLevel)) && Number(expected.maxLevel) > 0))) {
      missing = ['expected.levels or expected.maxLevel'];
    }
    return missing.length ? { stage, status: 'incomplete', missing } : { stage, status: 'run' };
  });
  return { id: requirement.id, checkType: requirement.checkType, stages: stagePlans };
}

export function listUnsupportedDesignRequirements(profile) {
  const requirements = profile?.designSpec?.requirements || [];
  const overrides = profile?.designSpec?.overrides || [];
  const fromRequirements = requirements.flatMap((requirement) => {
    if (overrides.some((entry) => entry.requirementId === requirement.id && entry.status === 'waived')) return [];
    const stages = requirement.checkStage === 'both' ? ['editor', 'front'] : [requirement.checkStage];
    const unsupportedStages = stages.filter((stage) => designCheckSupport(requirement.checkType, stage) === 'unsupported');
    return unsupportedStages.length ? [{ id: requirement.id, checkType: requirement.checkType,
      sourceText: requirement.sourceText, stages: unsupportedStages,
      reason: 'No automated checker is registered for this requirement type/stage.' }] : [];
  });
  const explicit = (profile?.designSpec?.unsupportedRequirements || []).map((item) => ({
    id: item.id, checkType: 'unsupported', sourceText: item.sourceText, stages: ['human-review'], reason: item.reason,
  }));
  const seen = new Set();
  return [...fromRequirements, ...explicit].filter((item) => {
    const key = `${item.id}:${item.sourceText}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function buildDesignHumanReview(profile, checks = []) {
  const listed = listUnsupportedDesignRequirements(profile);
  const byId = new Map((profile?.designSpec?.requirements || []).map((item) => [item.id, item]));
  for (const check of checks || []) {
    if (!check || !['na', 'human-review'].includes(check.status) || check.reason?.humanReviewRequired !== true) continue;
    const requirementId = String(check.id || '').replace(/^design-/, '');
    const requirement = byId.get(requirementId);
    if (!requirement) continue;
    listed.push({ id: requirement.id, checkType: requirement.checkType, sourceText: requirement.sourceText,
      stages: [check.reason?.stage || requirement.checkStage], reason: String(check.reason?.code || 'checker-returned-na') });
  }
  listed.push(...collectHumanReview(checks).filter((item) => !byId.has(String(item.id).replace(/^design-/, ''))));
  const unique = new Map(listed.map((item) => [`${item.id}:${item.sourceText}`, item]));
  return [...unique.values()].map((item) => ({ ...item, sourceText: String(item.sourceText || '') }));
}


const TYPE_SET = new Set(DESIGN_CHECK_TYPES);
const NODE_ID = /^[0-9]+:[0-9]+$/;
const FILE_KEY = /^[A-Za-z0-9_-]+$/;


// Map designSpec requirements to live check outcomes so unexecuted / unsupported
// design items remain visible in coverage accounting (human-review counts must
// not look empty merely because a checker never ran).
export function accountDesignRequirementCoverage(profile, checks = []) {
  const byId = new Map((checks || []).map((check) => [String(check.id || '').replace(/^design-/, ''), check]));
  const requirements = profile?.designSpec?.requirements || [];
  const unsupported = listUnsupportedDesignRequirements(profile);
  const unsupportedIds = new Set(unsupported.map((item) => item.id));
  const rows = requirements.map((requirement) => {
    const check = byId.get(requirement.id);
    const plan = designRequirementPlan(requirement);
    const unsupportedStages = (plan.stages || []).filter((stage) => stage.status === 'unsupported').map((stage) => stage.stage);
    if (check) {
      return { id: requirement.id, checkType: requirement.checkType, sourceText: requirement.sourceText,
        status: check.status, evidence: 'check', stages: plan.stages };
    }
    if (unsupportedStages.length || unsupportedIds.has(requirement.id)) {
      return { id: requirement.id, checkType: requirement.checkType, sourceText: requirement.sourceText,
        status: 'human-review', evidence: 'unsupported-or-manual', stages: plan.stages,
        reason: 'No automated checker ran; listed for human review.' };
    }
    return { id: requirement.id, checkType: requirement.checkType, sourceText: requirement.sourceText,
      status: 'unexecuted', evidence: 'missing-check', stages: plan.stages,
      reason: 'Design requirement present in profile but no matching check outcome was produced.' };
  });
  for (const item of unsupported) {
    if (rows.some((row) => row.id === item.id)) continue;
    rows.push({ id: item.id, checkType: item.checkType, sourceText: item.sourceText,
      status: 'human-review', evidence: 'unsupportedRequirements', stages: item.stages,
      reason: item.reason });
  }
  return rows;
}

export function validateDesignSpec(spec, profileId = '(unknown)') {
  const errors = [];
  const add = (path, message) => errors.push({ profileId, path: `designSpec${path}`, message });
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return [{ profileId, path: 'designSpec', message: 'must be an object' }];
  if (!spec.source || typeof spec.source !== 'object' || Array.isArray(spec.source)) add('.source', 'must be an object');
  else {
    if (typeof spec.source.fileKey !== 'string' || !FILE_KEY.test(spec.source.fileKey)) add('.source.fileKey', 'must be a Figma file key, not a URL');
    if (typeof spec.source.nodeId !== 'string' || !NODE_ID.test(spec.source.nodeId)) add('.source.nodeId', 'must use numeric page:node form');
    if (Object.keys(spec.source).some((key) => !['fileKey', 'nodeId'].includes(key))) add('.source', 'may contain only fileKey and nodeId');
  }
  if (!Array.isArray(spec.requirements)) add('.requirements', 'must be an array');
  else {
    const ids = new Set();
    spec.requirements.forEach((item, index) => {
      const path = `.requirements[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add(path, 'must be an object'); return; }
      for (const key of ['id', 'checkType', 'sourceText', 'expected', 'checkStage', 'params']) {
        if (!Object.hasOwn(item, key)) add(`${path}.${key}`, 'is required');
      }
      if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) add(`${path}.id`, 'must be a lowercase identifier');
      else if (ids.has(item.id)) add(`${path}.id`, 'must be unique');
      else ids.add(item.id);
      if (!TYPE_SET.has(item.checkType)) add(`${path}.checkType`, `must be one of: ${DESIGN_CHECK_TYPES.join(', ')}`);
      if (typeof item.sourceText !== 'string' || !item.sourceText.trim()) add(`${path}.sourceText`, 'must be non-empty verbatim source text');
      if (!['editor', 'front', 'both'].includes(item.checkStage)) add(`${path}.checkStage`, 'must be editor, front, or both');
      if (!item.params || typeof item.params !== 'object' || Array.isArray(item.params)) add(`${path}.params`, 'must be an object');
      if (item.checkType === 'image-ratio' && !resolveImageRatioSource(item).source) add(`${path}.params.ratioSource`, 'must be natural, rendered-content, rendered-element or both');
      if (item.expected && typeof item.expected === 'object' && (Object.hasOwn(item.expected, 'lineHeight') || Object.hasOwn(item.expected, 'line-height'))) {
        add(`${path}.expected.lineHeight`, 'line-height is informational only and cannot be a checklist assertion');
      }
      if (item.state !== undefined) {
        const invalid = validateSpecState(item.state);
        if (invalid) add(`${path}.state`, invalid);
        if (!['color-scope', 'typography'].includes(item.checkType) || item.checkStage !== 'front') add(`${path}.state`, 'state is supported only on front color-scope or typography items');
      }
      if (Object.keys(item).some((key) => !['id', 'checkType', 'sourceText', 'expected', 'checkStage', 'params', 'state'].includes(key))) add(path, 'contains an unknown property');
    });
  }
  const checkOverrides = (key, allowedStatus) => {
    if (spec[key] === undefined && key !== 'overrides') return;
    if (!Array.isArray(spec[key])) { add(`.${key}`, 'must be an array'); return; }
    const requirementIds = new Set((spec.requirements || []).map((item) => item?.id));
    spec[key].forEach((item, index) => {
      const path = `.${key}[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add(path, 'must be an object'); return; }
      if (!requirementIds.has(item.requirementId)) add(`${path}.requirementId`, 'must reference an existing requirement');
      if (allowedStatus && !['waived', 'human-review'].includes(item.status)) add(`${path}.status`, 'must be waived or human-review');
      if (key === 'overrides') {
        if (typeof item.reason !== 'string' || !item.reason.trim()) add(`${path}.reason`, 'must be non-empty');
        if (item.whenReasonCodes !== undefined && (item.status !== 'human-review' || !Array.isArray(item.whenReasonCodes)
          || !item.whenReasonCodes.length || item.whenReasonCodes.some((code) => typeof code !== 'string' || !code.trim()))) add(`${path}.whenReasonCodes`, 'requires human-review and a non-empty array of non-empty machine reason strings');
        if (Object.keys(item).some((prop) => !['requirementId', 'status', 'reason', 'whenReasonCodes'].includes(prop))) add(path, 'contains an unknown property');
      } else {
        for (const prop of ['sourceText', 'resolvedScope', 'reason']) if (typeof item[prop] !== 'string' || !item[prop].trim()) add(`${path}.${prop}`, 'must be non-empty');
        if (Object.keys(item).some((prop) => !['requirementId', 'sourceText', 'resolvedScope', 'reason'].includes(prop))) add(path, 'contains an unknown property');
      }
    });
  };
  checkOverrides('overrides', 'waived');
  checkOverrides('scopeOverrides');
  if (spec.unsupportedRequirements !== undefined) {
    if (!Array.isArray(spec.unsupportedRequirements)) add('.unsupportedRequirements', 'must be an array');
    else spec.unsupportedRequirements.forEach((item, index) => {
      const path = `.unsupportedRequirements[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) { add(path, 'must be an object'); return; }
      if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) add(`${path}.id`, 'must be a lowercase identifier');
      if (typeof item.sourceText !== 'string' || !item.sourceText.trim()) add(`${path}.sourceText`, 'must preserve non-empty original spec text');
      if (typeof item.reason !== 'string' || !item.reason.trim()) add(`${path}.reason`, 'must be non-empty');
      if (Object.keys(item).some((key) => !['id', 'sourceText', 'reason'].includes(key))) add(path, 'contains an unknown property');
    });
  }
  if (Object.keys(spec).some((key) => !['source', 'requirements', 'overrides', 'scopeOverrides', 'unsupportedRequirements'].includes(key))) add('', 'contains an unknown property');
  return errors;
}

export function validateDesignProfiles(profiles) {
  return profiles.flatMap(({ id, profile }) => profile.designSpec ? validateDesignSpec(profile.designSpec, id) : []);
}

