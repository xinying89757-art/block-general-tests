#!/bin/bash
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
DIST="$ROOT/dist"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/block-tests-pack.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
mkdir -p "$DIST"
(cd "$ROOT" && git archive HEAD | tar -xf - -C "$STAGE")
rm -rf "$STAGE/.auth" "$STAGE/reports" "$STAGE/logs" "$STAGE/node_modules" "$STAGE/dist"
for envfile in "$STAGE"/.env*; do
  [ ! -e "$envfile" ] || rm -f "$envfile"
done
find "$STAGE" -type f -name 'storageState-*' -exec rm -f {} \; 2>/dev/null || true

skip_path() {
  case "$1" in
    .env|.env.*|.auth|.auth/*|reports|reports/*|logs|logs/*|node_modules|node_modules/*|dist|dist/*|storageState-*|*/storageState-*) return 0 ;;
    *) return 1 ;;
  esac
}

cd "$ROOT"
while IFS= read -r -d '' file; do
  if skip_path "$file"; then continue; fi
  if [ ! -e "$file" ] && [ ! -L "$file" ]; then rm -f "$STAGE/$file"; continue; fi
  mkdir -p "$STAGE/$(dirname "$file")"
  cp -p "$file" "$STAGE/$file"
done < <(git diff --name-only -z HEAD)
while IFS= read -r -d '' file; do
  if skip_path "$file"; then continue; fi
  mkdir -p "$STAGE/$(dirname "$file")"
  cp -p "$file" "$STAGE/$file"
done < <(git ls-files -z --others --exclude-standard)

cp -p "$ROOT/scripts/run-front.sh" "$STAGE/run-front.sh"
chmod +x "$STAGE/run-front.sh"
PACKAGE="$DIST/block-tests-$STAMP.tar.gz"
tar -czf "$PACKAGE" -C "$STAGE" .
echo "$PACKAGE"
