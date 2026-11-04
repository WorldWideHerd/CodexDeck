#!/usr/bin/env python3
"""Reuse the exact signed credential broker while rebuilding the main app."""
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
IDENTIFIER = 'local.codex.usage.credentials'
# Keychain access and authentication UI require the calling user's audit session.
XPC_SETTINGS = {'ServiceType': 'Application', 'RunLoopType': 'dispatch_main', 'JoinExistingSession': True}


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f'{Path(args[0]).name} failed: {result.stderr.strip()}')
    return result.stdout + result.stderr


def requirement(app):
    details = run('/usr/bin/codesign', '-d', '-r-', str(app))
    return next(line.split('designated =>', 1)[1].strip() for line in details.splitlines() if 'designated =>' in line)


def broker_requirement(parent):
    if 'cdhash' in parent or 'certificate' not in parent:
        raise ValueError('The credential broker requires a persistent certificate signing identity, not ad-hoc signing.')
    result, count = re.subn(r'\bidentifier\s+(?:"(?:local\.codex\.usage|com\.codexdeck\.desktop)"|local\.codex\.usage|com\.codexdeck\.desktop)(?=\s|$)',
                            'identifier "' + IDENTIFIER + '"', parent)
    if count != 1:
        raise ValueError('Unexpected main app signing identifier.')
    return result


def architectures(binary):
    values = tuple(sorted(run('/usr/bin/lipo', '-archs', str(binary)).split()))
    if not values or len(set(values)) != len(values) or not set(values) <= {'arm64', 'x86_64'}:
        raise ValueError('Unsupported macOS executable architecture.')
    return values


def app_architectures(app):
    values = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    name = values.get('CFBundleExecutable', '')
    if not name or Path(name).name != name:
        raise ValueError('Invalid application executable name.')
    return architectures(app / 'Contents/MacOS' / name)


def cache_digest(descriptor, sources, archs):
    # Preserve the existing arm64 cache and its exact signed Keychain identity.
    content = descriptor + b''.join(source.read_bytes() for source in sources)
    if archs != ('arm64',):
        content += json.dumps(archs).encode()
    return hashlib.sha256(content).hexdigest()


def compile_broker(sources, executable, archs):
    slices = []
    for arch in archs:
        target = executable if len(archs) == 1 else executable.with_name(executable.name + '-' + arch)
        run('/usr/bin/swiftc', '-O', '-whole-module-optimization', '-suppress-warnings',
            '-target', arch + '-apple-macosx13.0', '-module-name', 'CodexDeckCredentials',
            '-module-cache-path', str(ROOT / '.build/swift-cache'),
            *map(str, sources), '-o', str(target))
        slices.append(target)
    if len(slices) > 1:
        run('/usr/bin/lipo', '-create', *map(str, slices), '-output', str(executable))
        for path in slices:
            path.unlink()


def build(app):
    app = Path(app)
    archs = app_architectures(app)
    parent = requirement(app)
    expected = broker_requirement(parent)
    sources = [ROOT / name for name in ['native/macos/CredentialBrokerProtocol.swift',
        'native/macos/credential-broker/NativeStore.swift', 'native/macos/credential-broker/main.swift']]
    info = {'CFBundleIdentifier': IDENTIFIER, 'CFBundleName': 'CodexDeck', 'CFBundleDisplayName': 'CodexDeck',
            'CFBundleExecutable': 'CodexDeckCredentials', 'CFBundlePackageType': 'XPC!',
            'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1', 'LSMinimumSystemVersion': '13.0',
            'AllowedClientRequirement': parent,
            'CredentialBrokerBuildPolicy': 'hardened-runtime-v1',
            'XPCService': XPC_SETTINGS}
    descriptor = plistlib.dumps(info, sort_keys=True)
    digest = cache_digest(descriptor, sources, archs)
    cache = ROOT / '.local-data/credential-broker'
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    if cache.is_symlink():
        raise ValueError('The credential broker cache must not be a symlink.')
    cached = cache / digest / 'CodexDeckCredentials.xpc'
    if not cached.exists():
        with tempfile.TemporaryDirectory(prefix='.compile-', dir=cache) as temporary:
            bundle = Path(temporary) / 'CodexDeckCredentials.xpc'
            executable = bundle / 'Contents/MacOS/CodexDeckCredentials'
            executable.parent.mkdir(parents=True)
            (bundle / 'Contents/Info.plist').write_bytes(descriptor)
            compile_broker(sources, executable, archs)
            run('/usr/bin/python3', str(ROOT / 'scripts/sign-app.py'), str(bundle), '--identifier', IDENTIFIER)
            cached.parent.mkdir()
            shutil.move(str(bundle), cached)
    # Never trust a cache merely because it exists, and never silently re-sign/rebuild it.
    run('/usr/bin/codesign', '--verify', '--strict', '-R', '=' + expected, str(cached))
    if 'runtime' not in run('/usr/bin/codesign', '-d', '--verbose=4', str(cached)):
        raise ValueError('The credential broker must use the hardened runtime.')
    if plistlib.loads((cached / 'Contents/Info.plist').read_bytes()) != info:
        raise ValueError('The credential broker cache does not match its source configuration.')
    if architectures(cached / 'Contents/MacOS/CodexDeckCredentials') != archs:
        raise ValueError('The credential broker architecture does not match the main application.')
    destination = app / 'Contents/XPCServices/CodexDeckCredentials.xpc'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise ValueError('Build the broker into a fresh staged app bundle.')
    shutil.copytree(cached, destination)
    plist = app / 'Contents/Info.plist'
    values = plistlib.loads(plist.read_bytes())
    values['CredentialBrokerRequirement'] = expected
    plist.write_bytes(plistlib.dumps(values))
    print('Credential broker source revision: ' + digest[:16] + ' (exact signed binary reused across main app versions).')
    return destination


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: build-credential-broker.py STAGED_APP')
    build(sys.argv[1])
