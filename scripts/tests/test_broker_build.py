import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('broker_builder', Path(__file__).resolve().parents[1] / 'build-credential-broker.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BrokerBuildTests(unittest.TestCase):
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
