import importlib.util
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('registration', Path(__file__).resolve().parents[1] / 'register-macos-app.py')
registration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registration)


class RegistrationTests(unittest.TestCase):
    def make_bundle(self, root, identifier=registration.IDENTIFIER):
        app = root / 'CodexDeck.app'
        (app / 'Contents/MacOS').mkdir(parents=True)
        (app / 'Contents/MacOS/app').write_bytes(b'preserved executable')
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': identifier}))
        return app

    def test_unregisters_existing_path_then_preserves_bundle_without_app_suffix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = self.make_bundle(root)
            binary = app / 'Contents/MacOS/app'
            inode = binary.stat().st_ino
            def unregister(arguments, **kwargs):
                self.assertTrue(app.exists())
                self.assertEqual(arguments, [registration.LSREGISTER, '-u', str(app)])
                return subprocess.CompletedProcess(arguments, 0)
            with binary.open('rb') as running, patch.object(registration.subprocess, 'run', side_effect=unregister):
                registration.retire(app, root / 'backups')
                self.assertEqual(running.read(), b'preserved executable')
            self.assertFalse(app.exists())
            backup, = (root / 'backups').iterdir()
            self.assertEqual(backup.suffix, '.backup')
            self.assertEqual((backup / 'Contents/MacOS/app').stat().st_ino, inode)

    def test_refuses_other_app_without_unregistering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = self.make_bundle(root, 'other.app')
            with patch.object(registration.subprocess, 'run') as run:
                with self.assertRaises(ValueError):
                    registration.retire(app, root / 'backups')
                run.assert_not_called()
            self.assertTrue(app.exists())

    def test_unregister_failure_preserves_bundle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = self.make_bundle(root)
            with patch.object(registration.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2)):
                with self.assertRaises(RuntimeError):
                    registration.retire(app, root / 'backups')
            self.assertTrue(app.exists())


if __name__ == '__main__':
    unittest.main()
