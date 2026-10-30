#!/usr/bin/env python3
"""Exercise the shipped broker's authenticated IPC using ping only, never credentials."""
import argparse
import hashlib
import importlib.util
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('broker_builder', ROOT / 'scripts/build-credential-broker.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def run(*args, expected=0):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if result.returncode != expected:
        raise SystemExit(f'{Path(args[0]).name} failed ({result.returncode}): {result.stdout.strip()} {result.stderr.strip()}')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--identifier', choices=['local.codex.usage', 'com.codexdeck.desktop'], default='local.codex.usage')
    identifier = parser.parse_args().identifier
    with tempfile.TemporaryDirectory(prefix='codexdeck-broker-check-') as temporary:
        root = Path(temporary)
        applications = []
        broker_hashes = []
        for variant, flags in [('first', []), ('updated', ['-D', 'CHANGED'])]:
            app = root / (variant + '.app')
            executable = app / 'Contents/MacOS/ParentProbe'
            executable.parent.mkdir(parents=True)
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
                'CFBundleIdentifier': identifier, 'CFBundleExecutable': 'ParentProbe',
                'CFBundleName': 'CodexDeck broker test', 'CFBundlePackageType': 'APPL',
                'CFBundleVersion': '1' if variant == 'first' else '2'}))
            # Swift requires a main.swift basename for top-level executable code in a multifile build.
            source = root / 'main.swift'
            shutil.copyfile(ROOT / 'scripts/tests/broker-probe.swift', source)
            run('/usr/bin/swiftc', '-module-cache-path', str(ROOT / '.build/swift-cache'),
                str(ROOT / 'native/macos/CredentialBrokerProtocol.swift'), str(source), *flags, '-o', str(executable))
            run('/usr/bin/python3', str(ROOT / 'scripts/sign-app.py'), str(app), '--identifier', identifier)
            broker = builder.build(app)
            broker_hashes.append(hashlib.sha256((broker / 'Contents/MacOS/CodexDeckCredentials').read_bytes()).hexdigest())
            run('/usr/bin/python3', str(ROOT / 'scripts/sign-app.py'), str(app), '--identifier', identifier)
            run(str(executable))
            applications.append(app)
        assert broker_hashes[0] == broker_hashes[1], 'A main app update must retain the exact broker binary'
        assert (applications[0] / 'Contents/MacOS/ParentProbe').read_bytes() != (applications[1] / 'Contents/MacOS/ParentProbe').read_bytes()
        # Same bundle ID and a copied service are insufficient without the authorized certificate.
        impostor = root / 'impostor.app'
        shutil.copytree(applications[1], impostor)
        run('/usr/bin/codesign', '--force', '--sign', '-', '--identifier', identifier, str(impostor))
        run(str(impostor / 'Contents/MacOS/ParentProbe'), expected=2)
    print('PASS: two changed signed clients connect; broker binary is identical; a foreign signer is rejected. No account credentials accessed.')


if __name__ == '__main__':
    main()
