import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publish_app', Path(__file__).resolve().parents[1] / 'publish-app.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


@unittest.skipUnless(sys.platform == 'darwin', 'macOS bundle publication')
class PublishAppTests(unittest.TestCase):
    def bundle(self, path, data):
        executable = path / 'Contents/MacOS/CodexDeck'
        executable.parent.mkdir(parents=True)
        executable.write_bytes(data)
        return executable

    def test_swap_preserves_old_executable_and_its_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target, staged = root / 'CodexDeck.app', root / '.stage/CodexDeck.app'
            old = self.bundle(target, b'old running executable')
            new = self.bundle(staged, b'new signed executable')
            old_inode, new_inode = old.stat().st_ino, new.stat().st_ino
            with old.open('rb') as running:
                backup = publisher.publish(staged, target)
                self.assertEqual(backup.suffix, '.backup')
                self.assertEqual(running.read(), b'old running executable')
                self.assertEqual(old.read_bytes(), b'new signed executable')
                self.assertEqual(old.stat().st_ino, new_inode)
                preserved = backup / 'Contents/MacOS/CodexDeck'
                self.assertEqual(preserved.stat().st_ino, old_inode)
                self.assertEqual(preserved.read_bytes(), b'old running executable')

    def test_first_install_moves_complete_bundle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            staged, target = root / '.stage/CodexDeck.app', root / 'CodexDeck.app'
            self.bundle(staged, b'new')
            self.assertIsNone(publisher.publish(staged, target))
            self.assertEqual((target / 'Contents/MacOS/CodexDeck').read_bytes(), b'new')

    def test_failed_exchange_leaves_installed_bundle_intact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            staged, target = root / '.stage/CodexDeck.app', root / 'CodexDeck.app'
            self.bundle(staged, b'new')
            installed = self.bundle(target, b'old')
            inode = installed.stat().st_ino
            with patch.object(publisher, 'exchange', side_effect=OSError('synthetic failure')):
                with self.assertRaises(OSError):
                    publisher.publish(staged, target)
            self.assertEqual(installed.stat().st_ino, inode)
            self.assertEqual(installed.read_bytes(), b'old')
