#!/usr/bin/env python3
"""Opt-in macOS integration check. Never opens a user's account credential items."""
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f'{Path(args[0]).name} failed: {result.stderr.strip()}')
    return result


def main():
    original_list = run('/usr/bin/security', 'list-keychains', '-d', 'user').stdout
    with tempfile.TemporaryDirectory(prefix='codexdeck-signing-') as directory:
        directory = Path(directory)
        password = directory / 'password'
        password.write_text(secrets.token_hex(32))
        password.chmod(0o600)
        keychain = directory / 'synthetic.keychain-db'
        first, second, denied = [directory / name for name in ('first', 'changed', 'untrusted')]
        source = ROOT / 'scripts/tests/signing-probe.swift'
        for binary, flags in [(first, []), (second, ['-D', 'CHANGED'])]:
            run('/usr/bin/swiftc', '-suppress-warnings', '-module-cache-path', str(ROOT / '.build/swift-cache'),
                str(source), *flags, '-o', str(binary))
            # Exercise the real build signing path twice, reusing its saved identity.
            run('/usr/bin/python3', str(ROOT / 'scripts/sign-app.py'), str(binary))
        assert first.read_bytes() != second.read_bytes(), 'The two executables must differ'
        details = run('/usr/bin/codesign', '-d', '-r-', str(first))
        requirement = next(line.split('designated =>', 1)[1].strip()
                           for line in (details.stdout + details.stderr).splitlines() if 'designated =>' in line)
        assert 'certificate leaf' in requirement and 'cdhash' not in requirement
        run('/usr/bin/codesign', '--verify', '--strict', '-R', '=' + requirement, str(second))
        denied.write_bytes(second.read_bytes())
        denied.chmod(0o700)
        run('/usr/bin/codesign', '--force', '--sign', '-', '--identifier', 'local.codex.usage', str(denied))
        rejection = subprocess.run(['/usr/bin/codesign', '--verify', '-R', '=' + requirement, str(denied)], capture_output=True)
        assert rejection.returncode != 0, 'A different signer must not meet the old requirement'
        run(str(first), str(keychain), str(password), 'create')
        run(str(second), str(keychain), str(password), 'read')
        run(str(denied), str(keychain), str(password), 'deny')
    assert run('/usr/bin/security', 'list-keychains', '-d', 'user').stdout == original_list
    print('PASS: designated requirement and temporary-keychain ACL continuity; different signer denied; search list unchanged. This does not model login-keychain code-hash partitions.')


if __name__ == '__main__':
    main()
