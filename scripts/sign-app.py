#!/usr/bin/env python3
"""Keep beta Keychain identity stable across builds without changing account ACLs."""
import hashlib
import argparse
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run(*arguments):
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode:
        # All inputs are paths/public signing identifiers. Passwords are read from a private file.
        raise RuntimeError(f'{Path(arguments[0]).name} failed: {result.stderr.strip()}')
    return result.stdout.strip()


def signing_helper():
    source = ROOT / 'scripts/prepare-signing-keychain.swift'
    cache = ROOT / '.build/signing-tools'
    cache.mkdir(parents=True, exist_ok=True)
    helper = cache / ('prepare-' + hashlib.sha256(source.read_bytes()).hexdigest()[:16])
    if not helper.exists():
        run('/usr/bin/swiftc', '-module-cache-path', str(ROOT / '.build/swift-cache'),
            str(source), '-o', str(helper))
    return helper


def local_identity():
    directory = ROOT / '.local-data/signing'
    certificate = directory / 'certificate.pem'
    password = directory / 'password'
    keychain = directory / 'signing.keychain-db'
    helper = signing_helper()
    if directory.is_symlink():
        raise RuntimeError('The local signing directory must not be a symlink.')
    if not directory.exists():
        directory.mkdir(parents=True, mode=0o700)
        password.write_text(secrets.token_hex(32) + '\n')
        password.chmod(0o600)
        # The transient export is protected by the same random password. It is not shipped.
        with tempfile.TemporaryDirectory(prefix='import-', dir=directory) as temporary:
            temporary = Path(temporary)
            key, archive = temporary / 'key.pem', temporary / 'identity.p12'
            # LibreSSL shares a password-file BIO when both options use the same path.
            # Use a separate protected file so passin/passout do not consume one another.
            export_password = temporary / 'export-password'
            export_password.write_bytes(password.read_bytes())
            run('/usr/bin/openssl', 'req', '-new', '-x509', '-newkey', 'rsa:2048',
                '-sha256', '-days', '3650', '-subj', '/CN=CodexDeck Local Development/',
                '-addext', 'keyUsage=critical,digitalSignature',
                '-addext', 'extendedKeyUsage=critical,codeSigning',
                '-keyout', str(key), '-out', str(certificate), '-passout', f'file:{password}')
            run('/usr/bin/openssl', 'pkcs12', '-export', '-inkey', str(key),
                '-in', str(certificate), '-out', str(archive),
                '-passin', f'file:{password}', '-passout', f'file:{export_password}')
            run(str(helper), str(keychain), str(password), str(archive))
    else:
        if any(not path.is_file() or path.is_symlink() for path in (certificate, password, keychain)):
            raise RuntimeError('The saved signing identity is incomplete. Restore it; do not silently create a new identity.')
        run(str(helper), str(keychain), str(password))
    directory.chmod(0o700)
    password.chmod(0o600)
    keychain.chmod(0o600)
    fingerprint = run('/usr/bin/openssl', 'x509', '-in', str(certificate), '-noout', '-fingerprint', '-sha1')
    return fingerprint.split('=', 1)[1].replace(':', ''), keychain


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('bundle')
    parser.add_argument('--identifier', default='local.codex.usage')
    options = parser.parse_args()
    # Private signing material is excluded from git, bundles, release ZIPs and telemetry.
    os.umask(0o077)
    identity = os.environ.get('CODEXDECK_SIGNING_IDENTITY', '').strip()
    arguments = ['/usr/bin/codesign', '--force', '--options', 'runtime', '--sign']
    if identity:
        arguments.append(identity)
        arguments.append('--timestamp')
        if keychain := os.environ.get('CODEXDECK_SIGNING_KEYCHAIN', '').strip():
            arguments.extend(['--keychain', keychain])
    else:
        identity, keychain = local_identity()
        arguments.extend([identity, '--keychain', str(keychain), '--timestamp=none'])
    arguments.extend(['--identifier', options.identifier, options.bundle])
    if os.environ.get('CODEXDECK_SIGNING_IDENTITY', '').strip():
        run(*arguments)
    else:
        # Keep the local keychain searchable only while this signing process runs.
        run(str(signing_helper()), str(keychain), str(ROOT / '.local-data/signing/password'),
            '--codesign', *arguments[1:])
    run('/usr/bin/codesign', '--verify', '--strict', options.bundle)
    print('Signed with ' + ('explicit identity.' if os.environ.get('CODEXDECK_SIGNING_IDENTITY') else 'persistent local development identity.'))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error))
