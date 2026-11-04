#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
probe_dir=$(mktemp -d "${TMPDIR:-/tmp}/codexdeck-quit-test.XXXXXXXX")
trap 'rm -rf "$probe_dir"' EXIT
/usr/bin/swiftc -target "$(uname -m)-apple-macosx13.0" -parse-as-library \
  native/macos/*.swift scripts/tests/desktop-quit-probe.swift \
  -module-cache-path "$probe_dir/cache" -o "$probe_dir/probe"
"$probe_dir/probe"
