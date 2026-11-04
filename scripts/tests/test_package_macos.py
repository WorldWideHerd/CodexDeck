import importlib.util
import json
import os
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('macos_packager', Path(__file__).resolve().parents[1] / 'package-macos.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
VERSION = json.loads((packager.ROOT / 'package.json').read_text())['version']


class PackageTests(unittest.TestCase):
    def make_app(self, root):
        app = root / 'CodexDeck.app'
        (app / 'Contents/MacOS').mkdir(parents=True)
        (app / 'Contents/XPCServices/CodexDeckCredentials.xpc/Contents/MacOS').mkdir(parents=True)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': 'com.codexdeck.desktop', 'CFBundleExecutable': 'codexdeck',
            'CFBundleShortVersionString': VERSION,
            'CredentialBrokerRequirement': 'identifier "local.codex.usage.credentials"'}))
        return app

    def test_missing_broker_is_rejected_before_archiving(self):
        with tempfile.TemporaryDirectory() as folder:
            app = self.make_app(Path(folder))
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            del info['CredentialBrokerRequirement']
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
            with patch.object(packager, 'run') as run, self.assertRaisesRegex(ValueError, 'broker'):
                packager.inspect(app, VERSION, False)
            run.assert_not_called()

    def test_mixed_architectures_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            app = self.make_app(Path(folder))
            with patch.object(packager, 'binary_architectures', side_effect=[['arm64'], ['x86_64']]), \
                    self.assertRaisesRegex(ValueError, 'architectures differ'):
                packager.inspect(app, VERSION, False)

    def test_local_signature_cannot_be_mislabeled_as_a_public_release(self):
        with tempfile.TemporaryDirectory() as folder:
            app = self.make_app(Path(folder))
            with patch.object(packager, 'binary_architectures', return_value=['arm64']), \
                    patch.object(packager, 'run', return_value='Authority=CodexDeck Local Development\nflags=runtime'), \
                    self.assertRaisesRegex(ValueError, 'Developer ID'):
                packager.inspect(app, VERSION, True)

    def test_developer_id_requires_timestamp(self):
        with tempfile.TemporaryDirectory() as folder:
            app = self.make_app(Path(folder))
            with patch.object(packager, 'binary_architectures', return_value=['arm64']), \
                    patch.object(packager, 'run', return_value='Authority=Developer ID Application: Synthetic\nflags=runtime'), \
                    self.assertRaisesRegex(ValueError, 'timestamp'):
                packager.inspect(app, VERSION, True)

    def test_missing_notary_credentials_fail_explicitly(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, 'notarization'):
            packager.notary_credentials(None)
        self.assertEqual(packager.notary_credentials('synthetic-profile'), ['--keychain-profile', 'synthetic-profile'])

    def test_preview_never_calls_apple_and_archive_checksum_matches_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.make_app(root)
            output = root / 'releases'

            def command(*args):
                self.assertNotIn('notarytool', args)
                if '-c' in args:
                    Path(args[-1]).write_bytes(b'synthetic archive')
                return ''

            with patch.object(packager, 'inspect', return_value=['arm64']), patch.object(packager, 'run', side_effect=command):
                packager.package(app, output, 'preview')
            manifest = json.loads(next(output.glob('*.json')).read_text())
            self.assertFalse(manifest['notarized'])
            self.assertEqual(manifest['channel'], 'preview')
            archive = output / manifest['archive']
            self.assertEqual(manifest['sha256'], packager.hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertEqual(next(output.glob('*.sha256')).read_text(), f"{manifest['sha256']}  {archive.name}\n")

    def test_rejected_notarization_produces_no_release_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            output = root / 'releases'
            with patch.object(packager, 'inspect', return_value=['arm64']), \
                    patch.object(packager, 'run', return_value='{"status":"Invalid"}'), \
                    self.assertRaisesRegex(RuntimeError, 'did not accept'):
                packager.package(root / 'CodexDeck.app', output, 'release', 'synthetic-profile')
            self.assertEqual(list(output.iterdir()), [])

    def test_release_archive_is_created_after_stapling_and_gatekeeper_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            output = root / 'releases'
            calls = []

            def command(*args):
                calls.append(args)
                if 'notarytool' in args:
                    return '{"status":"Accepted"}'
                if '-c' in args:
                    Path(args[-1]).write_bytes(b'notarized synthetic archive')
                return ''

            with patch.object(packager, 'inspect', return_value=['arm64']) as inspect, \
                    patch.object(packager, 'run', side_effect=command):
                packager.package(root / 'CodexDeck.app', output, 'release', 'synthetic-profile')
            manifest = json.loads(next(output.glob('*.json')).read_text())
            self.assertTrue(manifest['notarized'])
            self.assertNotIn('preview', manifest['archive'])
            operations = [args[1:3] for args in calls]
            self.assertLess(operations.index(('stapler', 'staple')), operations.index(('stapler', 'validate')))
            self.assertLess(next(i for i, args in enumerate(calls) if '--assess' in args), len(calls) - 1)
            self.assertEqual(inspect.call_count, 2)

    def test_errors_do_not_echo_notarization_password(self):
        result = packager.subprocess.CompletedProcess([], 1, stdout='', stderr='synthetic-password denied')
        with patch.dict(os.environ, {'APPLE_PASSWORD': 'synthetic-password'}), \
                patch.object(packager.subprocess, 'run', return_value=result), \
                self.assertRaisesRegex(RuntimeError, r'\[redacted\] denied'):
            packager.run('xcrun')
