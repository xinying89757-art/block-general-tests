// Report page: render a block-test report JSON as a readable, shareable
// HTML page. Usage: node scripts/report-html.mjs <report.json> [out.html]
// Defaults: out.html = reports/<runId>.html. No dependencies; inline CSS/JS.
// Images are referenced by relative path (reports/ ->../screenshots/),
// so share the whole project folder, or copy the HTML next to the images.
//
// The page leads with the conclusion: status, counts, and what is NEW vs the
// previous run of the same block (fail IDs that were not failing before).
// A 缺陷单草稿 section turns each fail into copy-pasteable text.
import { readFile, writeFile, readdir} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath} from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const esc = (s) => String(s?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const statusLabel = { pass: "通过", fail: "失败", skip: "跳过", record: "记录"};

function defectDraft(check) {
const lines = [`${check.name || ""}`.trim()];
lines.push(`结果：失败`);
if (check.detail) lines.push(`详情：${check.detail}`);
if (check.evidence) lines.push(`证据：${JSON.stringify(check.evidence)}`);
return lines.join("\n");
}

async function previousReport(report) {
const dir = path.join(projectRoot, "reports");
let files = [];
try { files = (await readdir(dir)).filter((f) => f.startsWith(`report-${report.config.blockId}-`) && f.endsWith(".json"));}
catch { return null;}
files.sort();
const prevName = files.filter((f) => f!== path.basename(report._source)).pop();
if (!prevName) return null;
try { return JSON.parse(await readFile(path.join(dir, prevName), "utf8"));} catch { return null;}
}

function screenshotCandidates(report) {
const out = [];
const push = (label, rel) => { if (rel) out.push({ label, rel});};
const shots = report.screenshots || {};
if (shots.editor) push("编辑器截图", path.relative(path.join(projectRoot, "reports"), path.resolve(projectRoot, shots.editor)).replace(/\\/g, "/"));
if (shots.preview) push("预览截图", path.relative(path.join(projectRoot, "reports"), path.resolve(projectRoot, shots.preview)).replace(/\\/g, "/"));
const blockId = report.config?.blockId;
if (blockId) {
for (const vp of ["pc", "pad", "mobile"]) {
push(`样式截图（${vp}）`, `../screenshots/style-${blockId}-${vp}.png`);
}
}
return out;
}

export async function renderReport(reportPath, outPath) {
const report = JSON.parse(await readFile(reportPath, "utf8"));
report._source = path.basename(reportPath);
const prev = await previousReport(report);
const prevFails = new Set((prev?.checks || []).filter((c) => c.status === "fail").map((c) => c.id));
const fails = report.checks.filter((c) => c.status === "fail");
const newFails = fails.filter((c) =>!prevFails.has(c.id));
const recurringFails = fails.filter((c) => prevFails.has(c.id));
const { pass, fail, skip, record} = report.summary;
const shots = screenshotCandidates(report);
const rows = report.checks.map((c) => {
const isNew = c.status === "fail" &&!prevFails.has(c.id);
return `<tr data-status="${c.status}">
<td><code>${esc(c.id)}</code>${isNew? ' <span class="tag-new">新增</span>': ""}</td>
<td>${esc(c.name || "")}</td>
<td><span class="st st-${c.status}">${statusLabel[c.status] || c.status}</span></td>
<td>${esc(c.detail || "")}</td>
<td>${c.evidence? `<details><summary>证据</summary><pre>${esc(JSON.stringify(c.evidence, null, 2))}</pre></details>`: ""}</td>
</tr>`;
}).join("\n");
const conclusion = report.failure
? `运行在 ${esc(report.failure.stage)} 阶段中断：${esc(report.failure.message)}`
: fail === 0
? "全部通过，没有失败项。"
: newFails.length === 0
? `共 ${fail} 个失败，全部是上次就有的已知问题，没有新增。`
: `共 ${fail} 个失败，其中新增 ${newFails.length} 个${recurringFails.length? `、已知问题 ${recurringFails.length} 个`: ""}。`;
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>区块 ${esc(report.config.blockId)} 测试报告 ${esc(report.runId)}</title>
<style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:960px;margin:0 auto;padding:24px 16px;color:#222;line-height:1.6}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px}
.meta{color:#666;font-size:13px}.counts{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}
.count{border:1px solid #ddd;border-radius:8px;padding:8px 14px}.count b{font-size:20px;display:block}
.count.pass b{color:#1a7f37}.count.fail b{color:#cf222e}
.st{border-radius:4px;padding:1px 8px;font-size:12px}.st-pass{background:#ddf4ff;color:#0969da}
.st-fail{background:#ffebe9;color:#cf222e}.st-skip{background:#f6f8fa;color:#57606a}.st-record{background:#fff8c5;color:#7d4e00}
.tag-new{background:#cf222e;color:#fff;border-radius:4px;padding:0 6px;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e5e5e5;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f6f8fa}tr[data-status="fail"]{background:#fff8f8}
.filters{margin:12px 0}.filters button{margin-right:6px;padding:4px 12px;border:1px solid #ccc;background:#fff;border-radius:16px;cursor:pointer}
.filters button.on{background:#0969da;color:#fff;border-color:#0969da}
pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;padding:8px;border-radius:6px;font-size:12px}
.draft{background:#f6f8fa;border:1px solid #ddd;border-radius:8px;padding:12px;white-space:pre-wrap;font-size:13px}
img.shot{max-width:100%;border:1px solid #ddd;border-radius:8px;margin:8px 0}
</style></head><body>
<h1>区块 ${esc(report.config.blockId)} 测试报告</h1>
<p class="meta">运行 ${esc(report.runId)} · ${esc(report.startedAt || "")} → ${esc(report.finishedAt || "")} ·
页面 ${esc(report.config.targetPage || "")}（${esc(report.config.targetPageKind === "custom"? "自定义页面": "系统页面")}）·
状态：<b>${esc(report.status)}</b></p>
<div class="counts">
<div class="count pass"><b>${pass}</b>通过</div>
<div class="count fail"><b>${fail}</b>失败</div>
<div class="count"><b>${skip}</b>跳过</div>
<div class="count"><b>${record}</b>记录</div>
</div>
<h2>结论</h2><p>${conclusion}</p>
${report.failure? `<p>中断阶段：${esc(report.failure.stage)}；${esc(report.failure.message)}</p>`: ""}
${fails.length? `<h2>缺陷单草稿（${fails.length} 条，复制可用）</h2>
${fails.map((c) => `<div class="draft">${esc(defectDraft(c))}</div>`).join("\n")}`: ""}
<h2>全部检查（${report.checks.length} 项）</h2>
<div class="filters">
<button data-f="all" class="on">全部</button><button data-f="fail">失败</button>
<button data-f="pass">通过</button><button data-f="skip">跳过</button><button data-f="record">记录</button>
</div>
<table><thead><tr><th>检查</th><th>名称</th><th>结果</th><th>详情</th><th>证据</th></tr></thead>
<tbody>${rows}</tbody></table>
${shots.length? `<h2>截图</h2>${shots.map((s) => `<p>${esc(s.label)}<br><img class="shot" src="${esc(s.rel)}" alt="${esc(s.label)}" onerror="this.parentElement.style.display='none'"></p>`).join("\n")}`: ""}
<script>
document.querySelectorAll(".filters button").forEach((b) => b.addEventListener("click", () => {
document.querySelectorAll(".filters button").forEach((x) => x.classList.remove("on"));
b.classList.add("on");
const f = b.dataset.f;
document.querySelectorAll("tbody tr").forEach((tr) => { tr.style.display = f === "all" || tr.dataset.status === f? "": "none";});
}));
</script></body></html>
`;
const out = outPath || path.join(projectRoot, "reports", `${report.runId}.html`);
await writeFile(out, html, "utf8");
return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const [reportPath, outPath] = process.argv.slice(2);
if (!reportPath) { console.error("用法：node scripts/report-html.mjs <report.json> [out.html]"); process.exitCode = 2;}
else {
renderReport(reportPath, outPath).then((out) => console.log(`报告页面：${out}`)).catch((e) => { console.error(e.message); process.exitCode = 1;});
}
}
