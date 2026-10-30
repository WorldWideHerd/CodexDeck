#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run tauri -- build --bundles app
# Never hand out the intermediate Tauri bundle: it exists before signing completes.
# Publish a complete signed copy atomically, preserving the previous app for rollback.
mkdir -p output
stage_root=$(mktemp -d "$PWD/output/.stage-XXXXXXXX")
bundle="$stage_root/CodexDeck.app"
ditto src-tauri/target/release/bundle/macos/CodexDeck.app "$bundle"
python3 scripts/sign-app.py "$bundle" --identifier com.codexdeck.desktop
python3 scripts/build-credential-broker.py "$bundle"
python3 scripts/sign-app.py "$bundle" --identifier com.codexdeck.desktop
/usr/bin/codesign --verify --strict "$bundle"
python3 scripts/publish-app.py "$bundle" "$PWD/output/CodexDeck.app"
rmdir "$stage_root" 2>/dev/null || true
python3 scripts/register-macos-app.py
echo "$PWD/output/CodexDeck.app"
