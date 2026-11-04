#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
tauri_args=(build --bundles app)
bundle_dir="src-tauri/target/release/bundle/macos"
register=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "--target requires a Rust target" >&2; exit 2; }
      case "$2" in
        aarch64-apple-darwin|x86_64-apple-darwin|universal-apple-darwin) ;;
        *) echo "Unsupported macOS target: $2" >&2; exit 2 ;;
      esac
      tauri_args+=(--target "$2")
      bundle_dir="src-tauri/target/$2/release/bundle/macos"
      shift 2 ;;
    --skip-registration) register=0; shift ;;
    *) echo "Unknown build option: $1" >&2; exit 2 ;;
  esac
done
npm run version:check
npm run tauri -- "${tauri_args[@]}"
# Never hand out the intermediate Tauri bundle: it exists before signing completes.
# Publish a complete signed copy atomically, preserving the previous app for rollback.
mkdir -p output
stage_root=$(mktemp -d "$PWD/output/.stage-XXXXXXXX")
trap 'rmdir "$stage_root" 2>/dev/null || true' EXIT
bundle="$stage_root/CodexDeck.app"
ditto "$bundle_dir/CodexDeck.app" "$bundle"
python3 scripts/sign-app.py "$bundle" --identifier com.codexdeck.desktop
python3 scripts/build-credential-broker.py "$bundle"
python3 scripts/sign-app.py "$bundle" --identifier com.codexdeck.desktop
/usr/bin/codesign --verify --deep --strict "$bundle"
python3 scripts/publish-app.py "$bundle" "$PWD/output/CodexDeck.app"
rmdir "$stage_root" 2>/dev/null || true
if [[ "$register" == 1 ]]; then
  python3 scripts/register-macos-app.py
fi
echo "$PWD/output/CodexDeck.app"
