#!/usr/bin/env python3
"""Compile the app icon for macOS surfaces that read the asset catalog."""
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile


def compile_icon(resources):
    resources = Path(resources)
    resources.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).resolve().parents[1] / 'src-tauri/icons/icon.png'
    with tempfile.TemporaryDirectory(prefix='codexdeck-icon-') as temporary:
        root = Path(temporary)
        catalog = root / 'Icons.xcassets'
        icon = catalog / 'CodexDeckIcon.appiconset'
        icon.mkdir(parents=True)
        images = []
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                filename = f'icon-{size}@{scale}x.png'
                pixels = str(size * scale)
                subprocess.run(['/usr/bin/sips', '-z', pixels, pixels, str(source),
                                '--out', str(icon / filename)], check=True, capture_output=True)
                images.append(dict(idiom='mac', size=f'{size}x{size}',
                                   scale=f'{scale}x', filename=filename))
        (icon / 'Contents.json').write_text(json.dumps({
            'images': images, 'info': {'version': 1, 'author': 'xcode'}}))
        partial = root / 'icon.plist'
        subprocess.run(['xcrun', 'actool', str(catalog), '--compile', str(resources),
                        '--platform', 'macosx', '--minimum-deployment-target', '13.0',
                        '--app-icon', 'CodexDeckIcon', '--output-partial-info-plist',
                        str(partial)], check=True)
        if not (resources / 'Assets.car').is_file():
            raise RuntimeError('App icon asset catalog was not generated')
        return plistlib.loads(partial.read_bytes())


def prepare():
    # Included by Tauri itself, so even its intermediate bundle has the final icon.
    resources = Path(__file__).resolve().parents[1] / 'src-tauri/generated-icons'
    metadata = compile_icon(resources)
    expected = {'CFBundleIconFile': 'CodexDeckIcon', 'CFBundleIconName': 'CodexDeckIcon'}
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise RuntimeError('Compiled icon metadata no longer matches Info.plist')


if __name__ == '__main__':
    prepare()
