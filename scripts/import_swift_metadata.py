#!/usr/bin/env python3
"""Explicit, local metadata-only import. Never opens credentials or profile contents."""
import argparse
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import tempfile
import time
import uuid

SWIFT_EPOCH = 978307200


def number(value, low=0, high=32503680000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Invalid numeric metadata')
    return value


def swift_date(value):
    return None if value is None else number(value, -SWIFT_EPOCH, 31525372800) + SWIFT_EPOCH


def workspace(value):
    if value is not None and (not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', value)):
        raise ValueError('Invalid workspace identifier')
    return value


def convert(source, preferences=None):
    profiles = source.get('profiles')
    if not isinstance(profiles, list):
        raise ValueError('Expected Swift SavedState profiles array')
    settings = {'language': source.get('language', 'fa'), 'appearance': source.get('appearance', 'system'),
                'refreshMinutes': source.get('refreshMinutes', 3), 'layout': 'cards', 'sort': 'manual', 'pinned': False}
    preferences = preferences or {}
    for source_key, key, allowed in [('dashboardLayout', 'layout', ['cards', 'list']),
                                      ('dashboardSort', 'sort', ['manual', 'fiveHour', 'weekly', 'reset'])]:
        if preferences.get(source_key) in allowed:
            settings[key] = preferences[source_key]
    if settings['language'] not in ['fa', 'en'] or settings['appearance'] not in ['system', 'light', 'dark'] or settings['refreshMinutes'] not in [3, 5, 10, 30, 60]:
        raise ValueError('Unsupported saved settings')
    accounts, alerts, resolved, seen = [], {}, {}, set()
    for profile in profiles:
        account_id = str(uuid.UUID(profile['id']))
        if account_id in seen:
            raise ValueError('Duplicate account identifier')
        seen.add(account_id)
        label = profile['label']
        if not isinstance(label, str) or not label.strip() or len(label) > 100 or any(ord(c) < 32 for c in label):
            raise ValueError('Invalid account label')
        color = profile.get('cardColor')
        if color is not None:
            channels = [number(color[c], 0, 1) for c in ['red', 'green', 'blue']]
            color = '#' + ''.join(f'{math.floor(c * 255 + 0.5):02x}' for c in channels)
        alert = profile.get('fiveHourAlert')
        threshold = None
        if alert is not None:
            threshold = number(alert['threshold'], 1, 100)
            if threshold != int(threshold):
                raise ValueError('Alert threshold must be an integer')
            reset = alert.get('lastReset')
            if reset is not None:
                number(reset)
            if not isinstance(alert.get('isBelow', False), bool):
                raise ValueError('Invalid alert state')
            alerts[account_id] = {'isBelow': alert.get('isBelow', False), 'lastReset': reset}
        resolved_id = workspace(profile.get('resolvedWorkspaceID'))
        if resolved_id:
            resolved[account_id] = resolved_id
        accounts.append({'id': account_id, 'label': label, 'email': profile.get('email'), 'plan': profile.get('plan'),
                         'workspaceId': workspace(profile.get('workspaceID')), 'snapshot': copy.deepcopy(profile.get('snapshot')),
                         'updatedAt': swift_date(profile.get('updatedAt')), 'color': color,
                         'subscriptionEndsAt': swift_date(profile.get('subscriptionEndsAt')), 'alertThreshold': threshold,
                         'status': 'needsLogin', 'error': None})
    return {'version': 1, 'state': {'accounts': accounts, 'settings': settings,
                                  'codexExecutable': source.get('executablePath'), 'lastError': None},
            'alertKeys': alerts, 'resolvedWorkspaces': resolved}


def read_private_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('Expected a regular, bounded metadata file')
    raw = path.read_bytes()
    return raw, json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))


def atomic(path, raw):
    if path.is_symlink():
        raise ValueError('Refusing symbolic link')
    fd, name = tempfile.mkstemp(prefix='.import-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def migrate(source_path, target_root, preferences=None, apply=False):
    raw, source = read_private_json(source_path)
    converted = convert(source, preferences)
    digest = hashlib.sha256(raw).hexdigest()
    count = len(converted['state']['accounts'])
    if not apply:
        return {'accounts': count, 'credentialsTransferred': False, 'applied': False}
    if not target_root.is_absolute() or target_root.is_symlink():
        raise ValueError('Destination must be an absolute directory, not a symbolic link')
    target_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    target_root = target_root.resolve(strict=True)
    os.chmod(target_root, 0o700)
    lock_path = target_root / 'instance.lock'
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+b') as lock:
        # Interoperates with the Rust File::try_lock flock on macOS. Fail closed if the app is open.
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        target = target_root / 'state.json'
        archive = target_root / 'migration-backups'
        if archive.is_symlink():
            raise ValueError('Backup location is a symbolic link')
        archive.mkdir(mode=0o700, exist_ok=True)
        os.chmod(archive, 0o700)
        receipt = archive / f'swift-{digest}.receipt.json'
        if receipt.exists():
            return {'accounts': count, 'credentialsTransferred': False, 'applied': False, 'alreadyImported': True}
        if target.exists():
            existing_raw, existing = read_private_json(target)
            if existing.get('version') != 1:
                raise ValueError('Unsupported destination schema')
            current = existing['state']['accounts']
            if current:
                # Do not overwrite edits or reconnect state. A failed receipt write may be retried safely.
                if existing == converted:
                    atomic(receipt, json.dumps({'schemaVersion': 1, 'sourceDigest': digest, 'accounts': count,
                                                'credentialsTransferred': False}).encode())
                    return {'accounts': count, 'credentialsTransferred': False, 'applied': False, 'alreadyImported': True}
                raise ValueError('Destination has accounts; refusing to replace them')
            atomic(archive / f'before-{time.time_ns()}.json', existing_raw)
        # Preserve the complete source metadata including fields not used by the new application.
        atomic(archive / f'swift-{digest}.json', raw)
        payload = json.dumps(converted, ensure_ascii=False, allow_nan=False, indent=2).encode()
        atomic(target, payload)
        _, verified = read_private_json(target)
        if verified != converted:
            raise ValueError('Destination verification failed')
        atomic(receipt, json.dumps({'schemaVersion': 1, 'sourceDigest': digest, 'accounts': count,
                                    'importedAt': time.time(), 'credentialsTransferred': False}).encode())
        return {'accounts': count, 'credentialsTransferred': False, 'applied': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--preferences', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    prefs = None
    if args.preferences and args.preferences.exists():
        if args.preferences.is_symlink():
            raise ValueError('Preferences must not be a symbolic link')
        prefs = plistlib.loads(args.preferences.read_bytes())
    print(json.dumps(migrate(args.source, args.destination, prefs, args.apply)))
