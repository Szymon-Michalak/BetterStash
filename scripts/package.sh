#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
npm run check

VERSION="$(node -p "require('./manifest.json').version")"
ARCHIVE="$ROOT/dist/better-stash-v$VERSION.zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
node scripts/stage.mjs chrome "$STAGE"
mkdir -p "$ROOT/dist"
rm -f "$ARCHIVE"
(cd "$STAGE" && zip -q "$ARCHIVE" ./*)
unzip -tq "$ARCHIVE"
echo "Created $ARCHIVE"
