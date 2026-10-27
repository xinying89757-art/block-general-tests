// Figma -> style spec extractor (one half of the "each block has its own
// design" answer). Given a Figma fileKey + nodeId, it calls the Figma
// connector's get_design_context, parses the generated React+Tailwind code
// and prints every text run with its styles (fontSize/fontWeight/
// lineHeight/color/textAlign/letterSpacing/background/border/radius) plus
// the container styles of the wrapping nodes.
//
// Usage:
//   node scripts/figma-style-extract.mjs <fileKey> <nodeId> [out.json]
// The output is a DRAFT: a human confirms the mapping from Figma node to
// DOM selector (layer names here are usually the DOM class names, so the
// mapping is mostly direct) and which items are hard asserts vs record,
// then the confirmed items go into profiles/<BLOCK_ID>.json as the
// block-style-spec capability's `styleSpec`. Re-run when the design changes
// and diff the output before updating the profile.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);
const [fileKey, nodeId, outPath] = process.argv.slice(2);
if (!fileKey || !nodeId) {
  console.error("用法: node scripts/figma-style-extract.mjs <fileKey> <nodeId> [out.json]");
  process.exit(1);
}

function twToStyle(cls) {
  const s = {};
  let m = cls.match(/text-\[(\d+(?:\.\d+)?)px\]/);
  if (m) s.fontSize = parseFloat(m[1]);
  m = cls.match(/font-\['([^'\]]+):(\w+)'\]/);
  if (m) {
    s.fontFamily = m[1].replaceAll("_", " ");
    const w = { Regular: 400, Bold: 700, Semibold: 600, Medium: 500, Light: 300 }[m[2]];
    if (w) s.fontWeight = w;
  }
  if (cls.includes("font-normal")) s.fontWeight = 400;
  m = cls.match(/leading-\[(\d+(?:\.\d+)?)px\]/);
  if (m) s.lineHeight = parseFloat(m[1]);
  if (cls.includes("leading-[normal]")) s.lineHeight = "normal";
  m = cls.match(/text-(#(?:[0-9a-fA-F]{3,8}))\b/);
  if (m) s.color = m[1].toLowerCase();
  if (cls.includes("text-white")) s.color = "#ffffff";
  if (cls.includes("text-center")) s.textAlign = "center";
  if (cls.includes("text-left")) s.textAlign = "left";
  m = cls.match(/tracking-\[(-?\d+(?:\.\d+)?)px\]/);
  if (m) s.letterSpacing = parseFloat(m[1]);
  if (cls.includes("whitespace-nowrap")) s.whiteSpace = "nowrap";
  m = cls.match(/bg-(#(?:[0-9a-fA-F]{3,8}))\b/);
  if (m) s.backgroundColor = m[1].toLowerCase();
  m = cls.match(/border-(#(?:[0-9a-fA-F]{3,8}))\b/);
  if (m) s.borderColor = m[1].toLowerCase();
  m = cls.match(/rounded-\[(\d+(?:\.\d+)?)px\]/);
  if (m) s.borderRadius = parseFloat(m[1]);
  return s;
}

const { stdout } = await execFileAsync("/opt/hatch/bin/figma", ["call-tool", "--name", "get_design_context", "--arguments-json", JSON.stringify({ fileKey, nodeId })], { maxBuffer: 64 * 1024 * 1024 });
const res = JSON.parse(stdout);
const code = res.result.content[0].text;

const tok = /<(\w+)((?:\s+[^>]*?)?)\s*(\/?)>|<\/(\w+)>|([^<]+)/g;
const stack = [];
const texts = [];
const containers = [];
let m;
while ((m = tok.exec(code))) {
  if (m[5] !== undefined) {
    const t = m[5].trim();
    if (t && !t.startsWith("{") && stack.length) {
      const top = stack[stack.length - 1];
      const anc = [...stack].reverse().find((f) => f.nodeId);
      texts.push({ text: t, style: twToStyle(top.cls), nodeId: anc?.nodeId ?? null, nodeName: anc?.name ?? "" });
    }
  } else if (m[4]) {
    stack.pop();
  } else {
    const attrs = m[2] || "";
    const nid = attrs.match(/data-node-id="([^"]+)"/);
    const nm = attrs.match(/data-name="([^"]*)"/);
    const cl = attrs.match(/className="([^"]*)"/);
    const frame = { tag: m[1], nodeId: nid?.[1] ?? null, name: nm?.[1] ?? "", cls: cl?.[1] ?? "" };
    if (frame.nodeId) containers.push(frame);
    stack.push(frame);
    if (m[3] === "/") stack.pop();
  }
}

const out = { fileKey, nodeId, texts, containers: containers.map((c) => ({ nodeId: c.nodeId, name: c.name, style: twToStyle(c.cls) })).filter((c) => Object.keys(c.style).length) };
if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ fileKey, nodeId, textRuns: texts.length, styledContainers: out.containers.length, out: outPath || "(stdout only)" }, null, 2));
if (!outPath) console.log(JSON.stringify(out, null, 2));
