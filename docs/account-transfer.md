# Account transfer

In **Settings → Account transfer & backup**, enter a password of at least 10 characters to export an encrypted JSON file. To import, choose the file and enter its password. Passwords cannot be recovered.

Archives contain account metadata, settings, cached usage and complete sign-in credentials. Treat them as sensitive. Export stops if a previously connected account's credentials cannot be read. On macOS, the OS may request authentication or Keychain access.

Import adds new accounts and skips existing email/workspace combinations. Imported settings are restored, but the destination's selected Codex executable is retained. OS notification permission and the original desktop app's login are not transferred. Switch away from or restore an active original account before transferring. Expired sessions may require signing in again.

## Format

The implementation is [transfer.rs](../src-tauri/src/transfer.rs).

- Envelope: `format: "codexdeck-account-archive"`, `version: 1`, encryption metadata and Base64 ciphertext.
- Encryption: AES-256-GCM; random 16-byte salt and 12-byte nonce; PBKDF2-HMAC-SHA256 with 600,000 iterations. Ciphertext includes the authentication tag.
- Associated data: compact JSON of `[format, version, encryption]`. Preserve encryption field order: `cipher`, `kdf`, `iterations`, `salt`, `nonce`.
- Limits: 32 MiB per archive, 1,000 accounts, 2 MiB per credential record; accepted KDF cost is 600,000–2,000,000 iterations.

Unknown envelope/major versions and required features are rejected. Future optional minor fields are accepted; use `data.transferExtensions` for data that must survive re-export. Credential JSON is preserved in full after identity validation.

Import validates before writing, generates new profile keys and commits metadata after credential verification. Reported failures trigger cleanup; a process crash can leave orphaned new credential entries. Existing accounts are not overwritten.
