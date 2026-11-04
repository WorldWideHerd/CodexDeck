#!/usr/bin/env python3
"""Package only a verified, complete app; release mode requires Apple notarization."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
IDENTIFIER = 'com.codexdeck.desktop'


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        message = result.stderr.strip() or result.stdout.strip()
        for key in ('APPLE_PASSWORD',):
            if value := os.environ.get(key):
                message = message.replace(value, '[redacted]')
        raise RuntimeError(f'{Path(args[0]).name} failed: {message}')
    return result.stdout + result.stderr


def binary_architectures(path):
    values = sorted(run('/usr/bin/lipo', '-archs', str(path)).split())
    if not values or len(set(values)) != len(values) or not set(values) <= {'arm64', 'x86_64'}:
        raise ValueError('Unsupported macOS architecture.')
    return values


def inspect(app, version, release):
    if app.is_symlink() or not app.is_dir() or app.suffix != '.app':
        raise ValueError('Select a complete .app directory, not a symbolic link.')
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != IDENTIFIER or info.get('CFBundleShortVersionString') != version:
        raise ValueError('Application identity/version does not match this checkout.')
    name = info.get('CFBundleExecutable', '')
    if not name or Path(name).name != name:
        raise ValueError('Invalid application executable.')
    broker = app / 'Contents/XPCServices/CodexDeckCredentials.xpc'
    requirement = info.get('CredentialBrokerRequirement', '')
    if not broker.is_dir() or not isinstance(requirement, str) or not requirement:
        raise ValueError('The app is missing its signed credential broker. Run npm run build:mac first.')
    archs = binary_architectures(app / 'Contents/MacOS' / name)
    if binary_architectures(broker / 'Contents/MacOS/CodexDeckCredentials') != archs:
        raise ValueError('Application and credential broker architectures differ.')
    notices = {
        'CodexDeck-MIT.txt': ROOT / 'LICENSE',
        'third-party-notices.txt': ROOT / 'public/licenses/third-party-notices.txt',
        'shadcn-MIT.txt': ROOT / 'public/licenses/shadcn-MIT.txt',
        'Vazirmatn-OFL.txt': ROOT / 'public/fonts/OFL.txt',
    }
    for name, source in notices.items():
        bundled = app / 'Contents/Resources/licenses' / name
        if not bundled.is_file() or bundled.read_bytes() != source.read_bytes():
            raise ValueError(f'Missing or stale bundled license notice: {name}')
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', str(app))
    run('/usr/bin/codesign', '--verify', '--strict', '-R', '=' + requirement, str(broker))
    details = run('/usr/bin/codesign', '-d', '--verbose=4', str(app))
    if release and 'Authority=Developer ID Application:' not in details:
        raise ValueError('Public release requires a Developer ID Application signature; local signatures are preview-only.')
    if release and ('Timestamp=' not in details or 'runtime' not in details):
        raise ValueError('Public release requires a secure timestamp and hardened runtime.')
    return archs


def notary_credentials(profile):
    if profile:
        return ['--keychain-profile', profile]
    keys = ('APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID')
    if not all(os.environ.get(key, '').strip() for key in keys):
        raise ValueError('Set CODEXDECK_NOTARY_PROFILE or APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID for notarization.')
    return ['--apple-id', os.environ['APPLE_ID'], '--password', os.environ['APPLE_PASSWORD'],
            '--team-id', os.environ['APPLE_TEAM_ID']]


def package(app, output, channel, profile=None):
    version = json.loads((ROOT / 'package.json').read_text())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
        raise ValueError('Invalid release version.')
    release = channel == 'release'
    archs = inspect(app, version, release)
    credentials = notary_credentials(profile) if release else None
    architecture = 'universal' if len(archs) > 1 else archs[0]
    stem = f'CodexDeck_{version}_macos_{architecture}' + ('' if release else '-preview')
    output.mkdir(parents=True, exist_ok=True)
    if output.is_symlink():
        raise ValueError('Release output must not be a symbolic link.')
    with tempfile.TemporaryDirectory(prefix='.package-', dir=output) as temporary:
        stage = Path(temporary)
        staged_app = stage / 'CodexDeck.app'
        run('/usr/bin/ditto', str(app), str(staged_app))
        if release:
            submission = stage / 'notarization.zip'
            run('/usr/bin/ditto', '-c', '-k', '--keepParent', str(staged_app), str(submission))
            result = json.loads(run('xcrun', 'notarytool', 'submit', str(submission),
                                    *credentials, '--wait', '--timeout', '30m', '--output-format', 'json'))
            if result.get('status') != 'Accepted':
                raise RuntimeError('Apple did not accept this app for notarization; no release archive was produced.')
            run('xcrun', 'stapler', 'staple', str(staged_app))
            run('xcrun', 'stapler', 'validate', str(staged_app))
            run('/usr/sbin/spctl', '--assess', '--type', 'execute', '--verbose=2', str(staged_app))
            inspect(staged_app, version, True)
        archive = stage / (stem + '.zip')
        run('/usr/bin/ditto', '-c', '-k', '--keepParent', str(staged_app), str(archive))
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        manifest = {'version': version, 'platform': 'macos', 'architectures': archs,
                    'channel': channel, 'notarized': release, 'archive': archive.name, 'sha256': digest}
        (stage / (stem + '.sha256')).write_text(f'{digest}  {archive.name}\n')
        (stage / (stem + '.json')).write_text(json.dumps(manifest, indent=2) + '\n')
        for suffix in ('.zip', '.sha256', '.json'):
            (stage / (stem + suffix)).replace(output / (stem + suffix))
    print(output / (stem + '.zip'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'output/releases')
    parser.add_argument('--channel', choices=['preview', 'release'], default='preview')
    parser.add_argument('--notary-profile', default=os.environ.get('CODEXDECK_NOTARY_PROFILE'))
    args = parser.parse_args()
    package(args.app.absolute(), args.output.absolute(), args.channel, args.notary_profile)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        raise SystemExit(str(error))
