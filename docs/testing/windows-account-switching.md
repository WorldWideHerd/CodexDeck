# Windows original-account switching

The Windows implementation targets the official OpenAI Codex MSIX installation in
Microsoft Store/Appx. A separate Codex CLI must be selected in CodexDeck Settings or discovered automatically.
Unpackaged desktop installations are not detected by this implementation.

Save open work and close Codex, its background tasks, and other Codex CLI processes
before switching or restoring. CodexDeck does not force quit Windows processes.
The selected profile must have a connected ChatGPT login. File, direct keyring,
and auto storage are supported; incompatible login/workspace restrictions fail
before the original credentials are replaced.

Recovery data is written to `.codex/codexdeck-desktop-recovery.dpapi`, encrypted
with Windows DPAPI for the current Windows user. Secrets never enter the webview
or command-line arguments. A pending recovery blocks further switches; use
**Restore original desktop account** in Settings to recover. Do not delete the
recovery file before restoring. Each successful switch backs up the immediately
preceding desktop account, matching the macOS transaction behavior.

## Native validation

Run on Windows with Rust, Node, WebView2, the official Codex app and Codex CLI:

```powershell
npm ci
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --bundles nsis
```

The Windows-only Rust tests cover DPAPI roundtrip/tamper rejection and isolated
file/keyring backup restoration with synthetic credentials. Shared tests cover
storage and workspace restrictions.

Manually validate with disposable accounts:

1. With Codex or a CLI task running, switching must fail without changing login.
2. Close Codex; switch A to B. Confirm the opened app shows B and the backup is encrypted.
3. Close Codex; restore A from Settings. Confirm A opens and the recovery file disappears.
4. Repeat for `file`, `keyring`, and `auto` storage and a workspace-restricted account.
5. Interrupt the app after the backup is written. Restart CodexDeck; switching must
   be blocked and Restore must recover the saved account.
6. Corrupt a copy of the encrypted backup; restore must fail without changing login.
7. Confirm a refreshed original login is synced only to a card with a matching identity.

A macOS build does not validate these Windows runtime cases or produce a Windows installer.
