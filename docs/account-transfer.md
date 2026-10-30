# Full account transfer (Tauri)

Settings → Account transfer & backup → enter a password (at least 10 characters). Confirm it for **Export JSON**, then choose a file. On the destination, enter the same password, choose **Import JSON**, and select the archive. Canceling either picker changes nothing. Passwords cannot be recovered.

The archive includes all accounts in their manual order, labels, email, plan, workspace bindings, colors, subscription dates, quota alert thresholds and delivery state, cached usage buckets/reset credits, every application setting, and complete Codex OAuth credential records (including refresh tokens and fields added by Codex). Empty, never-connected accounts are explicitly represented without credentials. Export refuses to silently omit credentials for previously connected accounts. Reconnect any account whose credentials are missing/mismatched before retrying.

Import merges new accounts after existing accounts. Duplicate email + resolved workspace combinations retain the local account and credentials. A result shows imported/skipped counts. Settings are restored from the archive. Account IDs and OS credential keys are remapped for the destination. The executable path is included as source metadata but the destination's local executable selection is retained. OS notification permission and main ChatGPT/Codex desktop login are machine-specific and are not changed. The original Swift app's accounts are outside this feature's scope. Expired/revoked sessions may require signing in again.

No account tokens or archive plaintext are returned to the webview or written to local metadata, logs, or temporary plaintext files. Credentials use Codex's direct `Codex Auth` OS store, keyed by the first 16 hex characters of SHA-256 of the canonical profile home (`cli|…`). The app-server is explicitly configured for the same direct backend. Native file pickers keep filesystem access out of the webview. macOS may request access to Codex's Keychain items.

## Archive format and evolution

The outer JSON has `format: "codexdeck-account-archive"`, `version: 1`, an `encryption` object and Base64 `ciphertext`. Encryption uses AES-256-GCM, a fresh 12-byte nonce, a fresh 16-byte salt and PBKDF2-HMAC-SHA256 (600,000 iterations, 32-byte key). Associated data is compact JSON serialization of `[format, version, encryption]` (encryption keys serialized in declaration order: cipher, kdf, iterations, salt, nonce). The ciphertext includes the appended 16-byte authentication tag. Do not edit/reorder encryption fields when implementing a reader's associated-data serialization.

Decrypted payload:

```json
{
  "schemaVersion": 1,
  "schemaMinor": 0,
  "minimumReaderVersion": 1,
  "requiredFeatures": [],
  "createdAt": 0,
  "appVersion": "0.1.0",
  "sourcePlatform": "macos",
  "data": {
    "version": 1,
    "state": { "accounts": [], "settings": {}, "codexExecutable": null, "lastError": null },
    "alertKeys": {},
    "resolvedWorkspaces": {},
    "transferExtensions": {}
  },
  "credentials": {}
}
```

- Outer `version` changes require an explicit envelope/cryptography migration. Unknown versions or algorithms fail before decryption.
- `schemaVersion` is the major payload contract. Add explicit migration functions before accepting a future major; never interpret an unknown major as current data.
- Increment `schemaMinor` for additive, optional fields. Readers accept future minors and ignore unknown ordinary fields. New optional settings must have defaults for old archives.
- Increase `minimumReaderVersion` or add a `requiredFeatures` entry for changes that cannot safely be ignored. Version 1 supports no required feature flags; unknown flags fail before writes.
- Use namespaced keys inside `data.transferExtensions` for optional plugin/future data that must survive an import/re-export. This bag is persisted without interpretation. Unknown ordinary fields outside it may be discarded.
- Credential records are opaque JSON strings, preserved in full after structural identity validation. Never migrate them by retaining only known token fields.

Input is bounded to 32 MiB, 1,000 accounts, and 2 MiB per credential record. KDF cost is bounded to 600,000–2,000,000 iterations. Wrong passwords and modified ciphertext report the same error. Invalid IDs, duplicates inside an archive, missing credentials, workspace mismatches and invalid settings fail before writes.

Import writes only newly generated profile/credential keys, verifies their readback, then atomically commits metadata. On a reported failure, staged credentials/directories are removed; cleanup failure is explicitly reported. Existing accounts and credential records are not overwritten. A process/power failure before the metadata commit can leave unreachable new credential entries, but does not replace existing account metadata. These entries are not a completed import.

## Validation

Rust tests cover encryption round-trip, randomized salt/nonces, wrong password/tamper, format compatibility, identity mismatches, duplicate handling, key remapping, preservation of complete credentials/extensions, atomic archive writes, bounded reads, and rollback after credential/metadata failures. Tests use synthetic credentials and never access real account tokens.

Production builds and OS store behavior must be validated separately per platform. A macOS build does not validate Windows or Linux credential access.
