import copy
import fcntl
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from import_swift_metadata import convert, migrate, SWIFT_EPOCH


def source():
    return {'language': 'fa', 'appearance': 'dark', 'refreshMinutes': 3, 'profiles': [{
        'id': 'AABBCCDD-1234-4567-8901-112233445566', 'label': 'Synthetic',
        'email': 'synthetic@example.invalid', 'plan': 'pro', 'updatedAt': 100,
        'subscriptionEndsAt': 200, 'cardColor': {'red': 1, 'green': 0.5, 'blue': 0},
        'resolvedWorkspaceID': 'workspace',
        'snapshot': {'rateLimits': {'primary': {'usedPercent': 40, 'resetsAt': 1900000000}},
                     'rateLimitResetCredits': {'availableCount': 2}},
        'fiveHourAlert': {'threshold': 20, 'isBelow': True, 'lastReset': 1900000000}}]}


class ImportTests(unittest.TestCase):
    def test_units_ids_snapshot_and_alerts(self):
        original = source()
        saved = convert(original, {'dashboardSort': 'weekly', 'dashboardLayout': 'list'})
        a = saved['state']['accounts'][0]
        self.assertEqual(a['id'], original['profiles'][0]['id'].lower())
        self.assertEqual(a['updatedAt'], SWIFT_EPOCH + 100)
        self.assertEqual(a['subscriptionEndsAt'], SWIFT_EPOCH + 200)
        self.assertEqual(a['snapshot'], original['profiles'][0]['snapshot'])
        self.assertEqual(saved['alertKeys'][a['id']]['lastReset'], 1900000000)
        self.assertEqual(a['color'], '#ff8000')
        self.assertEqual(a['status'], 'needsLogin')
        self.assertEqual(saved['state']['settings']['layout'], 'list')
        self.assertEqual(saved['resolvedWorkspaces'][a['id']], 'workspace')
        self.assertEqual(original, source())

    def test_duplicate_and_config_injection_rejected(self):
        data = source()
        data['profiles'].append(copy.deepcopy(data['profiles'][0]))
        with self.assertRaises(ValueError):
            convert(data)
        data = source()
        data['profiles'][0]['workspaceID'] = 'x"\nmalicious=true'
        with self.assertRaises(ValueError):
            convert(data)

    def test_atomic_import_is_idempotent_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / 'accounts.json'
            raw = json.dumps(source()).encode()
            original.write_bytes(raw)
            target = root / 'new'
            self.assertFalse(migrate(original, target)['applied'])
            self.assertFalse(target.exists())
            self.assertTrue(migrate(original, target, apply=True)['applied'])
            self.assertTrue(migrate(original, target, apply=True)['alreadyImported'])
            self.assertEqual(original.read_bytes(), raw)
            self.assertEqual((target / 'state.json').stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(list((target / 'migration-backups').glob('swift-*.json'))), 2)

    def test_existing_accounts_and_running_app_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / 'accounts.json'
            original.write_text(json.dumps(source()))
            target = root / 'new'
            target.mkdir()
            state = convert(source())
            state['state']['accounts'][0]['label'] = 'Existing edited account'
            raw = json.dumps(state).encode()
            (target / 'state.json').write_bytes(raw)
            with self.assertRaises(ValueError):
                migrate(original, target, apply=True)
            self.assertEqual((target / 'state.json').read_bytes(), raw)
            with open(target / 'instance.lock', 'r+b') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError):
                    migrate(original, target, apply=True)

    def test_symlink_target_and_invalid_dates_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / 'accounts.json'
            original.write_text(json.dumps(source()))
            linked = root / 'link'
            linked.symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                migrate(original, linked, apply=True)
        data = source()
        data['profiles'][0]['updatedAt'] = float('nan')
        with self.assertRaises(ValueError):
            convert(data)


if __name__ == '__main__':
    unittest.main()
