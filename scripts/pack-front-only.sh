#!/bin/bash
# Pack only what scripts/front-style-only.mjs needs (no .auth, .env, reports, logs).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/dist/front-only.tar.gz}
mkdir -p "$(dirname "$OUT")"
cd "$ROOT"
git archive --format=tar.gz -o "$OUT" HEAD package.json package-lock.json src profiles \
  schemas/design-checklist.schema.json docs/check-types.md \
  scripts/front-style-only.mjs scripts/check-design-spec.mjs scripts/import-design-spec.mjs
echo "$OUT"
