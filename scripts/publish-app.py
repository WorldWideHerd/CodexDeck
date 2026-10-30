#!/usr/bin/env python3
"""Publish a fully signed bundle without overwriting a running Mach-O in place."""
import ctypes
import os
from pathlib import Path
import sys
import uuid


def exchange(source, target):
    libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    rename = libc.renamex_np
    rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(os.fsencode(source), os.fsencode(target), 0x00000002):  # RENAME_SWAP
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def publish(source, target):
    source, target = Path(source).absolute(), Path(target).absolute()
    if source == target or source.suffix != '.app' or target.suffix != '.app':
        raise ValueError('Publish requires two different app bundle paths.')
    if source.is_symlink() or target.is_symlink() or not source.is_dir():
        raise ValueError('App bundles must be directories, not symlinks.')
    if not target.parent.is_dir() or (target.exists() and not target.is_dir()):
        raise ValueError('Invalid destination.')
    if not target.exists():
        os.rename(source, target)
        return None
    # Preparing the backup path first means an ordinary filesystem failure cannot
    # remove the installed bundle. The swap itself is one atomic OS operation.
    backups = target.parent / '.previous-builds'
    if backups.is_symlink():
        raise ValueError('The previous-builds directory must not be a symlink.')
    backups.mkdir(exist_ok=True)
    # A backup must not be discoverable as another installed application. Multiple
    # registered bundles with one identity can keep notification artwork stale.
    backup = backups / (target.stem + '-' + uuid.uuid4().hex + '.app.backup')
    exchange(source, target)
    try:
        os.rename(source, backup)
    except OSError:
        # The old executable remains intact here, including if it is still running.
        return source
    return backup


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: publish-app.py STAGED_APP DESTINATION_APP')
    previous = publish(sys.argv[1], sys.argv[2])
    print('Published complete app bundle.' + (' Previous bundle preserved: ' + str(previous) if previous else ''))
