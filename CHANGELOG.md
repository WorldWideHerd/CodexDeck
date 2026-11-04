# Changelog

## 0.1.1 — preview

- Make the isolated local signing keychain searchable while codesign constructs its certificate chain, then restore the previous search list on success and failure.
- Cover fresh-keychain signing, identity reuse and search-list restoration with a macOS integration test.

## 0.1.0 — release candidate

- Initialize the Windows notification sender identity and allow the first enabled toast; installer/runtime verification remains required.
- Bundle complete locked dependency license notices and check them in CI.
- Backport the GLib string-iterator output-pointer safety fix needed by the Linux GTK 3 backend.
- Prepare preview release drafts without Apple credentials, with per-platform checksums/manifests and a separate strict notarized macOS release channel.

- Multi-account Codex usage dashboard with five-hour and weekly quota windows.
- Isolated sign-in, quota notifications and a menu bar summary.
- Password-encrypted account export/import.
- Explicit one-shot prompts, with optional scheduling while the app is open and the computer is awake and online.
- Persian/English interface, Persian/Gregorian calendars and system/light/dark appearance.
- Signed macOS original-account switching with system authentication and recovery backup.

macOS Apple Silicon has been built and checked locally. Intel macOS, Windows and Linux require runtime validation before being advertised as supported. Automatic updates are not connected. CI preview archives use local development signatures; official macOS release archives require Developer ID signing and Apple notarization.
