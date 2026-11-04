import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(sys.platform == 'darwin', 'macOS signing integration')
class FreshSigningTests(unittest.TestCase):
    def test_fresh_identity_signs_and_restores_search_list_after_success_and_failure(self):
        def run(*args, **kwargs):
            return subprocess.run(args, capture_output=True, text=True, check=True, **kwargs)

        before = run('/usr/bin/security', 'list-keychains', '-d', 'user').stdout
        environment = {**os.environ, 'CODEXDECK_SIGNING_IDENTITY': '', 'CODEXDECK_SIGNING_KEYCHAIN': ''}
        with tempfile.TemporaryDirectory(prefix='codexdeck-signing-test-') as folder:
            root = Path(folder)
            (root / 'scripts').mkdir()
            for name in ('sign-app.py', 'prepare-signing-keychain.swift'):
                shutil.copy2(ROOT / 'scripts' / name, root / 'scripts' / name)
            app = root / 'Probe.app'
            executable = app / 'Contents/MacOS/probe'
            executable.parent.mkdir(parents=True)
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
                'CFBundleIdentifier': 'com.codexdeck.signing-test',
                'CFBundleExecutable': 'probe', 'CFBundlePackageType': 'APPL',
            }))
            run('/usr/bin/clang', '-x', 'c', '-', '-o', str(executable), input='int main(void) { return 0; }')
            certificate = root / '.local-data/signing/certificate.pem'
            first_certificate = None
            for _ in range(2):
                run(sys.executable, str(root / 'scripts/sign-app.py'), str(app),
                    '--identifier', 'com.codexdeck.signing-test', env=environment)
                run('/usr/bin/codesign', '--verify', '--strict', str(app))
                self.assertEqual(run('/usr/bin/security', 'list-keychains', '-d', 'user').stdout, before)
                if first_certificate is None:
                    first_certificate = certificate.read_bytes()
                self.assertEqual(certificate.read_bytes(), first_certificate)
            helper = next((root / '.build/signing-tools').glob('prepare-*'))
            failed = subprocess.run([
                str(helper), str(root / '.local-data/signing/signing.keychain-db'),
                str(root / '.local-data/signing/password'), '--codesign', '--force',
                '--sign', '-', str(root / 'missing.app'),
            ], capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn('codesign', failed.stderr)
            self.assertEqual(run('/usr/bin/security', 'list-keychains', '-d', 'user').stdout, before)
