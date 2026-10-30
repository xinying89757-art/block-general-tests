#!/bin/bash
set -u
set -o pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
if [ -f "$SCRIPT_DIR/package.json" ]; then ROOT=$SCRIPT_DIR; else ROOT=$(cd "$SCRIPT_DIR/.." && pwd); fi
if [ "$#" -lt 1 ]; then echo "用法：bash run-front.sh <tarball> [BLOCK_IDS...]" >&2; exit 2; fi
TARBALL=$1
shift
case "$TARBALL" in /*) ;; *) TARBALL="$PWD/$TARBALL" ;; esac
if [ ! -f "$TARBALL" ]; then echo "找不到 tarball：$TARBALL" >&2; exit 2; fi

if [ "$#" -gt 0 ]; then
  BLOCKS="$*"
else
  BLOCKS=$(sed -n 's/^[[:space:]]*BLOCK_ID[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" 2>/dev/null | tail -1 | tr -d "'\"\r")
fi
if [ -z "$BLOCKS" ]; then echo '未提供 BLOCK_ID，且 .env 中没有 BLOCK_ID。' >&2; exit 2; fi

echo "注意：Mac 前台 run 与盒子端 live run 不共享锁文件，请确认两边不会重叠。"

BEFORE_LOCK=$(shasum -a 256 "$ROOT/package-lock.json" 2>/dev/null | awk '{print $1}')
STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
mkdir -p "$ROOT/logs" "$ROOT/out" "$ROOT/reports" "$ROOT/screenshots"
LOG="$ROOT/logs/front-$STAMP.log"
export NO_PROXY=1 HTTPS_PROXY= https_proxy= HTTP_PROXY= http_proxy= ALL_PROXY= all_proxy=
tar -xzf "$TARBALL" -C "$ROOT" || exit 1
AFTER_LOCK=$(shasum -a 256 "$ROOT/package-lock.json" 2>/dev/null | awk '{print $1}')
if [ "$BEFORE_LOCK" != "$AFTER_LOCK" ]; then
  (cd "$ROOT" && npm ci) >>"$LOG" 2>&1 || exit 1
fi

MARKER=${TMPDIR:-/tmp}/block-front-marker-$$
: > "$MARKER"
trap 'rm -f "$MARKER"' EXIT HUP INT TERM
LOGIN_CHECK_STATUS=0
(cd "$ROOT" && node scripts/explore-login.mjs --check-only) >>"$LOG" 2>&1 || LOGIN_CHECK_STATUS=$?
if [ "$LOGIN_CHECK_STATUS" -eq 3 ]; then
  if ! (cd "$ROOT" && node scripts/explore-login.mjs) >>"$LOG" 2>&1; then
    echo "登录态检查或登录失败；日志：$LOG" >&2
    exit 1
  fi
elif [ "$LOGIN_CHECK_STATUS" -ne 0 ]; then
  echo "登录态检查运行失败；为避免重复登录，已停止。日志：$LOG" >&2
  exit 1
fi

RESULTS="$ROOT/out/front-results-$STAMP"
mkdir -p "$RESULTS"
EXIT_STATUS=0
for BLOCK_ID in $BLOCKS; do
  echo "[front] BLOCK_ID=$BLOCK_ID" >>"$LOG"
  if ! (cd "$ROOT" && BLOCK_ID="$BLOCK_ID" FRONT_ONLY=1 node src/run.mjs) >>"$LOG" 2>&1; then
    echo "[front] BLOCK_ID=$BLOCK_ID runner returned failure" >>"$LOG"
    EXIT_STATUS=1
  fi
  REPORT=$(find "$ROOT/reports" -type f -name "report-$BLOCK_ID-*.json" -newer "$MARKER" -print 2>/dev/null | sort | tail -1)
  if [ -n "$REPORT" ]; then
    HTML=${REPORT%.json}.html
    (cd "$ROOT" && node scripts/report-html.mjs "$REPORT" "$HTML") >>"$LOG" 2>&1 || true
    cp "$REPORT" "$RESULTS/"
    [ ! -f "$HTML" ] || cp "$HTML" "$RESULTS/"
    node - "$REPORT" <<'NODE' | tee -a "$LOG"
const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const failed=(r.checks||[]).filter(c=>c.status==='fail').map(c=>c.id);
const guardFailed=r.failure?.stage==='baseline-guard'||failed.includes('baseline-guard');
const status=guardFailed?'FAILURE (guard failed)':(r.status==='failed'?'FAILURE':'passed');
console.log(`[front-summary] ${r.config?.blockId}: ${status} pass=${r.summary?.pass||0} fail=${r.summary?.fail||0} skip=${r.summary?.skip||0} na=${r.summary?.na||0} deferred=${r.summary?.deferred||0} failed=${failed.join(',')||'none'}${guardFailed?' blocked='+((r.checks||[]).filter(c=>c.status==='blocked').length):''}`);
if(r.status==='failed'||guardFailed) process.exitCode=1;
NODE
    SUMMARY_STATUS=$?
    [ "$SUMMARY_STATUS" -eq 0 ] || EXIT_STATUS=1
  else
    echo "[front] BLOCK_ID=$BLOCK_ID report missing" >>"$LOG"
    EXIT_STATUS=1
  fi
done

find "$ROOT/screenshots" -type f -newer "$MARKER" -exec cp {} "$RESULTS/" \; 2>/dev/null
cp "$LOG" "$RESULTS/"
OUT="$ROOT/out/front-$STAMP.tar.gz"
(cd "$ROOT" && tar -czf "$OUT" -C "$ROOT" "${RESULTS#$ROOT/}" "logs/$(basename "$LOG")") || exit 1
echo "前台运行结果包：$OUT"
echo "汇总与详细日志：$LOG"
exit "$EXIT_STATUS"
