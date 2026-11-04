import importlib.util
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('broker_builder', Path(__file__).resolve().parents[1] / 'build-credential-broker.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BrokerBuildTests(unittest.TestCase):
    def test_architectures_are_read_from_the_binary_and_unknown_targets_fail(self):
        with patch.object(builder, 'run', return_value='x86_64 arm64\n'):
            self.assertEqual(builder.architectures(Path('app')), ('arm64', 'x86_64'))
        for value in ('', 'arm64 arm64', 'i386'):
            with patch.object(builder, 'run', return_value=value), self.assertRaises(ValueError):
                builder.architectures(Path('app'))

    def test_existing_arm64_cache_identity_is_preserved_and_other_targets_are_distinct(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.swift'
            source.write_bytes(b'synthetic source')
            expected = hashlib.sha256(b'descriptor' + source.read_bytes()).hexdigest()
            digest = lambda archs: builder.cache_digest(b'descriptor', [source], archs)
            self.assertEqual(digest(('arm64',)), expected)
            self.assertEqual(len({expected, digest(('x86_64',)), digest(('arm64', 'x86_64'))}), 3)

    def test_intel_broker_compiles_for_intel_instead_of_arm(self):
        with patch.object(builder, 'run') as run:
            builder.compile_broker([Path('source.swift')], Path('broker'), ('x86_64',))
        args = run.call_args.args
        self.assertIn('x86_64-apple-macosx13.0', args)
        self.assertNotIn('arm64-apple-macosx13.0', args)

    def test_universal_broker_combines_both_compiled_slices(self):
        with patch.object(builder, 'run') as run, patch.object(Path, 'unlink') as unlink:
            builder.compile_broker([Path('source.swift')], Path('broker'), ('arm64', 'x86_64'))
        self.assertEqual(run.call_count, 3)
        self.assertIn('arm64-apple-macosx13.0', run.call_args_list[0].args)
        self.assertIn('x86_64-apple-macosx13.0', run.call_args_list[1].args)
        self.assertEqual(run.call_args_list[2].args,
                         ('/usr/bin/lipo', '-create', 'broker-arm64', 'broker-x86_64', '-output', 'broker'))
        self.assertEqual(unlink.call_count, 2)

    def test_keychain_broker_joins_callers_security_session(self):
        self.assertIs(builder.XPC_SETTINGS['JoinExistingSession'], True)
        self.assertEqual(builder.XPC_SETTINGS['ServiceType'], 'Application')

    def test_peer_requirement_changes_only_the_application_identifier(self):
        parent = 'identifier "local.codex.usage" and certificate leaf = H"0123456789012345678901234567890123456789"'
        expected = builder.broker_requirement(parent)
        self.assertEqual(expected, parent.replace('"local.codex.usage"', '"local.codex.usage.credentials"'))

    def test_tauri_parent_retains_the_same_stable_broker_identity(self):
        parent = 'identifier "com.codexdeck.desktop" and certificate leaf = H"0123456789012345678901234567890123456789"'
        self.assertEqual(builder.broker_requirement(parent), parent.replace('"com.codexdeck.desktop"', '"local.codex.usage.credentials"'))

    def test_adhoc_or_unexpected_parent_cannot_silently_get_a_broker(self):
        for requirement in ['cdhash H"0123"', 'identifier "someone.else" and certificate leaf = H"0123"', 'identifier "local.codex.usage"']:
            with self.subTest(requirement=requirement), self.assertRaises(ValueError):
                builder.broker_requirement(requirement)
