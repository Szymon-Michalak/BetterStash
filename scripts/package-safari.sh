#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Safari packaging requires macOS and full Xcode." >&2
  exit 1
fi
npm run check
CONVERTER="$(xcrun --find safari-web-extension-converter)"
VERSION="$(node -p "require('./manifest.json').version")"
mkdir -p "$ROOT/dist"
WORK="$(mktemp -d "$ROOT/dist/safari-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
node scripts/stage.mjs safari "$WORK/extension"

"$CONVERTER" "$WORK/extension" --project-location "$WORK/project" \
  --app-name BetterStash --bundle-identifier com.betterstash.BetterStash \
  --objc --macos-only --copy-resources --no-open --no-prompt

PROJECT="$WORK/project/BetterStash/BetterStash.xcodeproj"
xcodebuild -project "$PROJECT" -scheme BetterStash -configuration Release \
  -derivedDataPath "$WORK/build" -destination 'generic/platform=macOS' \
  ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO MACOSX_DEPLOYMENT_TARGET=13.0 \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$VERSION" \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build

APP="$WORK/build/Build/Products/Release/BetterStash.app"
codesign --verify --deep --strict "$APP"
mkdir -p "$WORK/release"
ditto "$APP" "$WORK/release/BetterStash.app"
cp SAFARI.md "$WORK/release/README.md"
ARCHIVE="$ROOT/dist/better-stash-safari-v$VERSION-macos-developer.zip"
ditto -c -k --sequesterRsrc "$WORK/release" "$ARCHIVE"
unzip -tq "$ARCHIVE"
echo "Created $ARCHIVE"
