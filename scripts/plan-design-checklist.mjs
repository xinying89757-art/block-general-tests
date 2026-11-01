#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DESIGN_CHECK_SUPPORT, designRequirementPlan } from '../src/design-spec-checklist.mjs';

const blockId = process.argv[2] || process.argv.find((arg) => /^--block=/.test(arg))?.split('=')[1];
if (!blockId || !/^\d+$/.test(String(blockId))) {
  console.error('用法：node scripts/plan-design-checklist.mjs <block-id>');
  process.exit(2);
}
const file = path.resolve(`profiles/${blockId}.json`);
if (!fs.existsSync(file)) { console.error(`未找到画像：${file}`); process.exit(2); }
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const spec = profile.designSpec;
if (!spec) { console.error(`画像 ${blockId} 没有 designSpec。`); process.exit(2); }
const lines = [`设计清单 dry-run：block=${blockId}`, `requirements=${spec.requirements.length}`];
for (const item of spec.requirements) {
  const plan = designRequirementPlan(item);
  for (const stagePlan of plan.stages) {
    if (stagePlan.status === 'run') lines.push(`RUN ${item.id} type=${item.checkType} stage=${stagePlan.stage} needs=${(DESIGN_CHECK_SUPPORT[item.checkType]?.needs || []).join('; ')}`);
    else if (stagePlan.status === 'incomplete') lines.push(`INCOMPLETE ${item.id} type=${item.checkType} stage=${stagePlan.stage} missing=${stagePlan.missing.join(',')} humanReview=${JSON.stringify(item.sourceText)}`);
    else lines.push(`UNSUPPORTED ${item.id} type=${item.checkType} stage=${stagePlan.stage} humanReview=${JSON.stringify(item.sourceText)}`);
  }
}
for (const item of spec.unsupportedRequirements || []) lines.push(`UNSUPPORTED ${item.id} type=unsupported stage=human-review humanReview=${JSON.stringify(item.sourceText)} reason=${item.reason}`);
console.log(lines.join('\n'));
