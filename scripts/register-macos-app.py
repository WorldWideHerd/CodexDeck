#!/usr/bin/env python3
"""Keep only the published desktop build discoverable in this checkout."""
from pathlib import Path
import plistlib
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
IDENTIFIER = 'com.codexdeck.desktop'


def retire(bundle, backups):
    if not bundle.exists():
        return
    if bundle.is_symlink() or backups.is_symlink():
        raise ValueError('Refusing symlinked app or backup directory')
    metadata = plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())
    if metadata.get('CFBundleIdentifier') != IDENTIFIER:
        raise ValueError(f'Refusing to retire a different application: {bundle}')
    # Unregister while the original path still exists. Renaming first leaves a
    # stale LaunchServices record; unregistering alone allows rediscovery.
    result = subprocess.run([LSREGISTER, '-u', str(bundle)], capture_output=True)
    if result.returncode not in (0, 1):
        raise RuntimeError(f'Could not unregister {bundle}')
    backups.mkdir(parents=True, exist_ok=True)
    bundle.rename(backups / f'CodexDeck-{uuid.uuid4().hex}.app.backup')


def main():
    installed = ROOT / 'output/CodexDeck.app'
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(installed)], check=True)
    backups = ROOT / 'output/.previous-builds'
    candidates = [ROOT / 'src-tauri/target/release/bundle/macos/CodexDeck.app',
                  ROOT / 'dist/desktop-release/CodexDeck.app']
    candidates.extend(backups.glob('*.app'))
    for bundle in candidates:
        retire(bundle, backups)
    subprocess.run([LSREGISTER, '-f', str(installed)], check=True)


if __name__ == '__main__':
    main()
