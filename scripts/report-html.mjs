import { applyHumanReviewVerdict } from '../src/human-review.mjs';
// Render a block-test report as a readable, shareable HTML page.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusLabel = { pass: '通过', fail: '失败', skip: '跳过', na: '无此设置项', 'human-review': '人工判断', record: '记录', deferred: '延后运行', blocked: '被阻止', 'env-paused': '环境暂停', 'env-timeout': '环境超时' };
const readable = (value) => {
  const result = String(value ?? '');
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) return `已记录 ${parsed.length} 项结构化结果，详情保留在 JSON 报告中。`;
    if (parsed && typeof parsed === 'object') return '已记录结构化结果，详情保留在 JSON 报告中。';
  } catch { /* ordinary report text */ }
  return result;
};
const text = (value, fallback = '') => readable(value || fallback || '');

function relativeScreenshot(file) {
  if (!file) return '';
  return path.relative(path.join(projectRoot, 'reports'), path.resolve(projectRoot, file)).replace(/\\/g, '/');
}

function evidenceLines(check) {
  if (Array.isArray(check.evidenceText)) return check.evidenceText.map(String).filter(Boolean);
  if (check.detail) return [readable(check.detail)];
  return [];
}

function defectDraft(check) {
  return [
    `检查项：${text(check.name, check.id)}`,
    `预期：${text(check.expected, '检查项达到预期结果。')}`,
    `实际：${text(check.actual, check.detail || '检查失败。')}`,
    `文字证据：${evidenceLines(check).join('；') || '无文字证据。'}`,
  ].join('\n');
}

async function previousReport(report) {
  const dir = path.join(projectRoot, 'reports');
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.startsWith(`report-${report.config.blockId}-`) && f.endsWith('.json')); }
  catch { return null; }
  files.sort();
  const previous = files.filter((f) => f !== path.basename(report._source)).pop();
  if (!previous) return null;
  try { return JSON.parse(await readFile(path.join(dir, previous), 'utf8')); } catch { return null; }
}

function screenshotCandidates(report) {
  const out = [];
  const push = (label, file) => { if (file) out.push({ label, rel: relativeScreenshot(file) }); };
  push('编辑器截图', report.screenshots?.editor);
  push('预览截图', report.screenshots?.preview);
  for (const vp of ['pc', 'pad', 'mobile']) push(`样式截图（${vp}）`, `screenshots/style-${report.config?.blockId}-${vp}.png`);
  return out;
}

export async function renderReport(reportPath, outPath) {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report._source = path.basename(reportPath);
  report.config ||= { blockId: report.blockId, targetPage: report.page?.name || report.page?.id, targetPageKind: report.page?.kind };
  report.checks = (report.checks || []).map((check) => applyHumanReviewVerdict(check));
  report.summary ||= {};
  const prev = await previousReport(report);
  const prevFails = new Set((prev?.checks || []).filter((check) => check.status === 'fail').map((check) => check.id));
  const fails = report.checks.filter((check) => check.status === 'fail');
  const newFails = fails.filter((check) => !prevFails.has(check.id));
  const recurringFails = fails.filter((check) => prevFails.has(check.id));
  const counts = Object.fromEntries(['pass', 'fail', 'skip', 'na', 'human-review', 'record', 'deferred', 'blocked', 'env-paused', 'env-timeout'].map((status) => [status,
    (['na', 'human-review'].includes(status) ? undefined : report.summary[status]) ?? report.checks.filter((check) => check.status === status).length]));
  const exceptional = report.checks.filter((check) => ['fail', 'skip', 'na', 'human-review', 'deferred', 'blocked', 'env-paused', 'env-timeout'].includes(check.status));
  const shots = screenshotCandidates(report);
  const cards = exceptional.map((check, index) => {
    const anchor = `check-${String(check.id || index).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const shot = check.screenshot ? relativeScreenshot(check.screenshot) : '';
    return `<article class="card" id="${esc(anchor)}"><div class="card-head"><strong>${esc(text(check.name, check.id))}</strong> <span class="st st-${esc(check.status)}">${esc(statusLabel[check.status] || check.status)}</span></div>
<p>${esc(text(check.description, check.detail || check.name || check.id))}</p><dl><dt>预期</dt><dd>${esc(text(check.expected, '未提供预期说明。'))}</dd><dt>实际</dt><dd>${esc(text(check.actual, check.detail || '未提供实际结果。'))}</dd><dt>文字证据</dt><dd>${evidenceLines(check).map(esc).join('<br>') || '无文字证据。'}</dd></dl>
${shot ? `<a href="${esc(shot)}">查看截图</a><br><img class="shot" src="${esc(shot)}" alt="${esc(text(check.name, check.id))}截图">` : ''}</article>`;
  }).join('\n');
  const rows = report.checks.map((check, index) => {
    const anchor = `check-${String(check.id || index).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const isNew = check.status === 'fail' && !prevFails.has(check.id);
    const shotLink = check.screenshot ? `<a href="#${esc(anchor)}">截图</a>` : '';
    return `<tr data-status="${esc(check.status)}"><td><code>${esc(check.id)}</code>${isNew ? ' <span class="tag-new">新增</span>' : ''}<br><strong>${esc(text(check.name, check.id))}</strong><br><span class="muted">${esc(text(check.description, check.detail || check.name || check.id))}</span></td>
<td><span class="st st-${esc(check.status)}">${esc(statusLabel[check.status] || check.status)}</span></td><td>${esc(text(check.expected, '未提供预期说明。'))}</td><td>${esc(text(check.actual, check.detail || '未提供实际结果。'))}</td><td>${evidenceLines(check).map(esc).join('<br>') || '—'}<br>${shotLink}</td></tr>`;
  }).join('\n');
  const conclusion = report.failure
    ? `运行在 ${esc(report.failure.stage)} 阶段中断：${esc(report.failure.message)}`
    : counts.fail === 0 ? `没有失败项；通过 ${counts.pass}，延后运行 ${counts.deferred} 项。`
      : newFails.length === 0 ? `共 ${counts.fail} 个失败，全部是上次就有的已知问题，没有新增。`
        : `共 ${counts.fail} 个失败，其中新增 ${newFails.length} 个${recurringFails.length ? `、已知问题 ${recurringFails.length} 个` : ''}。`;
  const previewMeta = report.previewLink && /^https?:\/\//i.test(report.previewLink)
    ? ` · <a href="${esc(report.previewLink)}" target="_blank" rel="noopener">预览链接</a>（有效期 7 天，约至 ${esc(report.previewLinkExpiresAt || '未知')}）` : '';
  const guard = report.baselineGuard;
  const guardHtml = !guard ? '' : guard.reason === 'no baseline in profile'
    ? '<h2>开跑前残留检测</h2><p>no baseline in profile</p>'
    : !guard.residue ? '<h2>开跑前残留检测</h2><p>无残留。</p>'
      : `<h2>开跑前残留检测</h2><p>发现 ${guard.diffs?.length || 0} 项残留；恢复${guard.restored?.allVerified ? '通过' : '未通过'}；新会话复验${guard.verifiedFresh ? '通过（无差异）' : '未通过'}。</p><ul>${(guard.diffs || []).map((d) => `<li>${esc(d.type)} / ${esc(d.label)}：预期 ${esc(JSON.stringify(d.expected))}，实际 ${esc(JSON.stringify(d.actual))}（${esc(d.reason)}）</li>`).join('')}</ul>`;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>区块 ${esc(report.config?.blockId)} 测试报告 ${esc(report.runId)}</title><style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:1180px;margin:0 auto;padding:24px 16px;color:#222;line-height:1.6}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px}.meta,.muted{color:#666;font-size:13px}.counts{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}.count{border:1px solid #ddd;border-radius:8px;padding:8px 14px}.count b{font-size:20px;display:block}.count.pass b{color:#1a7f37}.count.fail b{color:#cf222e}.st{border-radius:4px;padding:1px 8px;font-size:12px;white-space:nowrap}.st-pass{background:#ddf4ff;color:#0969da}.st-fail{background:#ffebe9;color:#cf222e}.st-skip{background:#f6f8fa;color:#57606a}.st-na{background:#fbefff;color:#8250df}.st-record{background:#fff8c5;color:#7d4e00}.st-deferred{background:#fff4d1;color:#7d4e00}.tag-new{background:#cf222e;color:#fff;border-radius:4px;padding:0 6px;font-size:12px}.filters{margin:12px 0}.filters button{margin:0 6px 6px 0;padding:4px 12px;border:1px solid #ccc;background:#fff;border-radius:16px;cursor:pointer}.filters button.on{background:#0969da;color:#fff;border-color:#0969da}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e5e5e5;padding:8px;text-align:left;vertical-align:top}th{background:#f6f8fa}tr[data-status="fail"]{background:#fff8f8}.cards{display:grid;gap:12px}.card{border:1px solid #ddd;border-radius:8px;padding:12px}.card-head{display:flex;gap:8px;align-items:center}.card p{margin:6px 0}.card dl{display:grid;grid-template-columns:70px 1fr;gap:4px 8px;margin:8px 0}.card dt{font-weight:600}.card dd{margin:0}.shot{max-width:100%;border:1px solid #ddd;border-radius:8px;margin:8px 0}
</style></head><body><h1>区块 ${esc(report.config?.blockId)} 测试报告</h1>
<p class="meta">运行 ${esc(report.runId)} · ${esc(report.startedAt || '')} → ${esc(report.finishedAt || '')} · 页面 ${esc(report.config?.targetPage || '')}（${esc(report.config?.targetPageKind === 'custom' ? '自定义页面' : '系统页面')}）· 状态：<b>${esc(report.status || '')}</b>${previewMeta}</p>
<div class="counts"><div class="count pass"><b>${counts.pass}</b>通过</div><div class="count fail"><b>${counts.fail}</b>失败</div><div class="count"><b>${counts.skip}</b>跳过</div><div class="count"><b>${counts.na}</b>无此设置项</div><div class="count"><b>${counts['human-review']}</b>人工判断</div><div class="count"><b>${counts.record}</b>记录</div><div class="count"><b>${counts.deferred}</b>延后运行</div><div class="count"><b>${counts.blocked}</b>被阻止</div><div class="count"><b>${counts['env-paused']}</b>环境暂停</div><div class="count"><b>${counts['env-timeout']}</b>环境超时</div></div>
<h2>结论</h2><p>${conclusion}</p>${report.failure ? `<p>中断阶段：${esc(report.failure.stage)}；${esc(report.failure.message)}</p>` : ''}
${guardHtml}
${fails.length ? `<h2>缺陷单草稿（${fails.length} 条，复制可用）</h2>${fails.map((check) => `<pre class="draft">${esc(defectDraft(check))}</pre>`).join('\n')}` : ''}
<h2>失败、跳过、无此设置项、人工判断、延后运行与被阻止</h2>${cards ? `<div class="cards">${cards}</div>` : '<p>没有失败、跳过、无此设置项、人工判断、延后运行或被阻止的检查。</p>'}
<h2>全部检查（${report.checks.length} 项）</h2><div class="filters"><button data-f="all" class="on">全部</button><button data-f="fail">失败</button><button data-f="pass">通过</button><button data-f="skip">跳过</button><button data-f="na">无此设置项</button><button data-f="human-review">人工判断</button><button data-f="record">记录</button><button data-f="deferred">延后运行</button><button data-f="blocked">被阻止</button><button data-f="env-paused">环境暂停</button><button data-f="env-timeout">环境超时</button></div>
<table><thead><tr><th>检查项（名称 + 描述）</th><th>结果</th><th>预期</th><th>实际</th><th>证据（文字）</th></tr></thead><tbody>${rows}</tbody></table>
${shots.length ? `<h2>整页截图</h2>${shots.map((shot) => `<p>${esc(shot.label)}<br><img class="shot" src="${esc(shot.rel)}" alt="${esc(shot.label)}" onerror="this.parentElement.style.display='none'"></p>`).join('\n')}` : ''}
<script>document.querySelectorAll('.filters button').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('.filters button').forEach((item)=>item.classList.remove('on'));button.classList.add('on');const filter=button.dataset.f;document.querySelectorAll('tbody tr').forEach((row)=>{row.style.display=filter==='all'||row.dataset.status===filter?'':'none';});}));</script></body></html>`;
  const out = outPath || path.join(projectRoot, 'reports', `${report.runId}.html`);
  await writeFile(out, html, 'utf8');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reportPath, outPath] = process.argv.slice(2);
  if (!reportPath) { console.error('用法：node scripts/report-html.mjs <report.json> [out.html]'); process.exitCode = 2; }
  else renderReport(reportPath, outPath).then((out) => console.log(`报告页面：${out}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
