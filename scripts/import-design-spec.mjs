#!/usr/bin/env node
// Generic importer: maps extracted Figma JSON into a profile checklist while
// preserving source text/values and excluding the original URL field.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function slug(value) {
  return String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}
function textList(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function sourceNode(value) {
  const match = String(value || '').match(/(\d+:\d+)/);
  return match?.[1] || null;
}
function requirementsFromSpec(spec) {
  const requirements = [];
  for (const [colorIndex, color] of (spec.colors || []).entries()) {
    const base = `color-${colorIndex + 1}-${slug(color.name)}`;
    requirements.push({ id: `${base}-default`, checkType: 'color-default', sourceText: String(color.name),
      expected: { name: color.name, value: color.default }, checkStage: 'front',
      params: { sourceNodeId: sourceNode(color.sourceNodeId), semanticRegion: 'block-color-scheme' } });
    for (const [scopeIndex, scope] of textList(color.scopeText).entries()) {
      requirements.push({ id: `${base}-scope-${scopeIndex + 1}`, checkType: 'color-scope', sourceText: String(scope),
        expected: { name: color.name, value: color.default }, checkStage: 'front',
        params: { sourceNodeId: sourceNode(color.sourceNodeId), semanticRegion: 'block-color-scheme' } });
    }
  }
  for (const [index, type] of (spec.typography || []).entries()) {
    const expected = {};
    if (type.fontSize && type.fontSize !== '见备注') expected.fontSize = type.fontSize;
    if (type.fontWeight) expected.fontWeight = type.fontWeight;
    // Line-height is excluded by policy: preserve it in raw source data only,
    // never emit it as a checklist expectation.
    if (type.color != null) expected.color = type.color;
    requirements.push({ id: `typography-${index + 1}-${slug(type.element)}-${type.viewport || 'default'}`,
      checkType: 'typography', sourceText: String(type.element), expected, checkStage: 'front',
      params: { viewport: type.viewport || null, sourceNodeId: sourceNode(type.sourceNodeId),
        sourceNodeText: type.sourceNodeId || null } });
  }
  let otherIndex = 0;
  for (const [key, raw] of Object.entries(spec.otherSpecs || {})) {
    const statements = Array.isArray(raw) ? raw : [raw];
    for (const rawStatement of statements) {
    const text = typeof rawStatement === 'string' ? rawStatement : JSON.stringify(rawStatement);
    const lower = `${key} ${text}`;
    const addOther = (suffix, checkType, expected, checkStage = 'front') => {
      requirements.push({ id: `other-${++otherIndex}-${slug(key)}${suffix ? `-${suffix}` : ''}`, checkType,
        sourceText: text, expected, checkStage, params: { sourceKey: key } });
    };
    if (/模块宽度|区块宽度/.test(lower)) {
      const value = text.match(/\d+\s*px/i)?.[0]?.replace(/\s+/g, '') || null;
      if (value) addOther('', 'module-width', { expandable: /行展开|可行展开/.test(text), default: value }, 'editor');
      else addOther('', 'manual', { verbatim: text });
    } else if (/高度|自适应/.test(lower)) addOther('', 'height-fit', { verbatim: text });
    else if (/图片|比例/.test(lower)) {
      const ratio = text.match(/\b\d+\s*:\s*\d+\b/)?.[0]?.replace(/\s+/g, '') || null;
      if (ratio) addOther('', 'image-ratio', { ratio, centered: /居中/.test(text) });
      else addOther('', 'manual', { verbatim: text });
    } else if (/最多展示|超出\d+行|不超过\d+行|省略/.test(lower)) {
      const lines = [...text.matchAll(/(?:最多展示|不超过|超出)(\d+)行/g)];
      if (lines.length) lines.forEach((line, index) => addOther(`rule-${index + 1}`, 'text-truncation',
        { maxLines: Number(line[1]), overflow: 'ellipsis', sourceOrder: index + 1 }));
      else addOther('', 'text-truncation', { verbatim: text });
    } else if (/超过\d+个.*纵向滚动|纵向滚动.*超过\d+个/.test(lower)) {
      const threshold = text.match(/(?:超过|超出)(\d+)个/)?.[1];
      addOther('vertical', 'overflow-threshold', { threshold: threshold ? Number(threshold) : null, direction: 'vertical' });
      if (/每个.*搜索框/.test(text)) addOther('search', 'search-box-per-field', { requiredPerField: true });
    } else if (/超过\d+个字段.*横向滚动|超出\d+个字段.*横向滚动/.test(lower)) {
      const threshold = text.match(/(?:超过|超出)(\d+)个字段/)?.[1];
      addOther('horizontal', 'overflow-threshold', { threshold: threshold ? Number(threshold) : null, direction: 'horizontal' });
    } else if (/每个.*搜索框|搜索框.*每个/.test(lower)) addOther('', 'search-box-per-field', { requiredPerField: true, verbatim: text });
    else if (/默认展示\d+级|\d+级默认收起/.test(lower)) {
      addOther('', 'default-expand', { level: Number(text.match(/默认展示(\d+)级/)?.[1] || 1), collapsedLevel: Number(text.match(/(\d+)级默认收起/)?.[1] || 0) });
    } else if (/已选标签|所选项|叉号/.test(lower)) addOther('', 'selected-tag-behaviour', { verbatim: text });
    else if (/手机端|移动端/.test(lower)) addOther('', 'mobile-layout', { verbatim: text });
    else addOther('', 'manual', { verbatim: text });
    }
  }
  return requirements;
}

export function importExtractedDesignSpec(profile, spec) {
  const rawFile = String(spec.file || '').trim().split(/\s+/)[0];
  const figmaUrl = rawFile.match(/^https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([^/?#]+)/i);
  const fileKey = figmaUrl ? figmaUrl[1] : rawFile;
  const nodeId = sourceNode((spec.colors || []).find((item) => item.sourceNodeId)?.sourceNodeId)
    || sourceNode((spec.typography || []).find((item) => item.sourceNodeId)?.sourceNodeId);
  if (!/^[A-Za-z0-9_-]+$/.test(fileKey) || !nodeId) throw new Error('Extracted design spec requires a Figma file key and source node id.');
  profile.designSpec = { source: { fileKey, nodeId }, requirements: requirementsFromSpec(spec), overrides: [] };
  return profile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((all, item, index, list) => {
    if (item.startsWith('--')) all.push([item.slice(2), list[index + 1]]);
    return all;
  }, []));
  if (!args.profile || !args.spec) {
    console.error('Usage: node scripts/import-design-spec.mjs --profile profiles/<id>.json --spec <extracted.json>');
    process.exit(2);
  }
  const profilePath = path.resolve(args.profile), specPath = path.resolve(args.spec);
  const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
  const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
  await fs.writeFile(profilePath, `${JSON.stringify(importExtractedDesignSpec(profile, spec), null, 2)}\n`);
  console.log(`Imported ${profile.designSpec.requirements.length} requirements into ${args.profile}`);
}
