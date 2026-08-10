#!/bin/bash
# Build PlainPaste.app (universal) and package it as PlainPaste.zip for download.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p build

swiftc -O -target arm64-apple-macos13  src/main.swift -o build/PlainPaste-arm64
swiftc -O -target x86_64-apple-macos13 src/main.swift -o build/PlainPaste-x86_64
lipo -create -output build/PlainPaste build/PlainPaste-arm64 build/PlainPaste-x86_64

APP=build/PlainPaste.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp src/Info.plist "$APP/Contents/Info.plist"
cp build/PlainPaste "$APP/Contents/MacOS/PlainPaste"

# Ad-hoc signature: no Developer ID, so downloads need a one-time
# "Open Anyway" in System Settings → Privacy & Security.
codesign --force --sign - "$APP"

rm -f PlainPaste.zip
ditto -c -k --keepParent "$APP" PlainPaste.zip

echo "Built $APP"
lipo -info "$APP/Contents/MacOS/PlainPaste"
echo "Packaged PlainPaste.zip ($(du -h PlainPaste.zip | cut -f1 | tr -d ' '))"
