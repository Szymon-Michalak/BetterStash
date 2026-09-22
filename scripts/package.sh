#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run check

VERSION="$(node -p "require('./manifest.json').version")"
ARCHIVE="$ROOT/dist/better-stash-v$VERSION.zip"
FILES=(
  manifest.json
  background.js
  shared.js
  layout.js
  dashboard.js
  diff.js
  content.js
  options.html
  options.js
  site-config.js
  styles.css
)

mkdir -p "$ROOT/dist"
rm -f "$ARCHIVE"
zip -q "$ARCHIVE" "${FILES[@]}"
unzip -tq "$ARCHIVE"
echo "Created $ARCHIVE"
