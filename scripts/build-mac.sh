#!/bin/bash
# Builds Wander.app and Wander.dmg on a Mac. Needs Node.js 22 and the Xcode Command Line Tools.
# Output: out/make/Wander-*.dmg (and a .zip). Unsigned unless APPLE_SIGN_IDENTITY is set.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "error: $*" >&2; exit 1; }
[[ "$(uname)" == "Darwin" ]] || fail "Build the Mac app on macOS."
command -v node >/dev/null || fail "Install Node.js 22 or later (https://nodejs.org)."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "Node.js 22.13 or later is required (found $(node -v))."
xcrun --find swiftc >/dev/null 2>&1 || fail "Install the Xcode Command Line Tools: xcode-select --install"

case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) fail "Unsupported CPU $(uname -m)." ;; esac

echo "==> Installing npm dependencies"
npm install --no-audit --no-fund

echo "==> Bundling Python 3.12"
node scripts/fetch-python.mjs

echo "==> Building the Swift Accessibility helper"
mkdir -p build
xcrun swiftc -O -target "$( [[ $ARCH == arm64 ]] && echo arm64 || echo x86_64 )-apple-macos13.0" \
  -o build/wander-helper native/wander-helper.swift

echo "==> Staging resources"
rm -rf build/python
cp -R "vendor/python/darwin-$ARCH" build/python

echo "==> Packaging Wander.app and the DMG"
npx electron-forge make --arch="$ARCH"

echo
echo "Done. Built files:"
find out/make -name '*.dmg' -o -name '*.zip' | sed 's/^/  /'
