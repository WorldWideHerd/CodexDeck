# Cross-platform CodexDeck

The current application lives in [`../`](..). It uses Rust, React, TypeScript, Tailwind and vendored shadcn/ui components. The historical Swift application has been removed; active macOS integration remains in `native/macos/`. Historical integration evidence below describes the state at the recorded date.

## Development

See [Development guide](development.md) for frontend commands and [`architecture.md`](architecture.md) for the command and data contract. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the host OS, then run from the repository root:

```sh
npm ci
npm test
npm run build
npm run tauri -- dev
```

`npm run dev` opens a browser preview. It starts empty; sample accounts are an explicit, labeled, in-memory visual preview. Browser preview does not perform account operations. The Tauri application uses real CLI RPCs and its own profile storage.

## Delivery boundaries

| Area | Rewrite scope |
| --- | --- |
| Dashboard | Persian RTL and English, Gregorian dates, localized numbers, light/dark/system, cards/list, sorting, manual order and metadata editing |
| Accounts | Isolated CLI processes and homes, browser login/cancellation, quota reads, cached metadata, additional quota buckets and reset credits |
| Desktop shell | Tray, reopening dashboard, pin, explicit quit and periodic refresh |
| Quota alerts | Native macOS authorization and scheduling adapter; Windows/Linux alert enable is explicitly blocked until visual readiness is verified |
| Credentials | CLI-backed operating-system keyring, with file-storage fallback disabled; this is not the legacy signed broker's access-control model |
| Existing Swift connections | Not silently imported or moved; a fresh sign-in is needed in the rewrite |
| Original desktop account switching/undo | Available in the signed macOS build; see the desktop guide. Unavailable on Windows/Linux |
| Full Tauri account transfer | Settings → Account transfer & backup; encrypted, versioned JSON with credentials and settings; [format and compatibility](account-transfer.md) |
| Swift metadata migration | Explicit local importer at `scripts/import_swift_metadata.py`; preserves metadata and private source backup, requires reconnecting accounts |
| Existing release/policy/diagnostics services | Not connected in this initial rewrite; no telemetry is enabled or sent by it |
| Distribution | New platform packages, signing and notarization are separate from a successful local executable build |

The automated workflow at [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) defines checks for macOS, Windows and Linux. Adding a workflow is not evidence that those runners have executed. Cross-platform compilation also does not establish installed-app keyring, notification or tray behavior; record actual host evidence before publishing support claims.

## Local integration evidence

On 2026-10-28, the manager launched the macOS debug `.app` with an explicitly selected temporary data directory and a synthetic executable that implements account-only RPCs. No production account, Keychain item or original-app process was used.

Verified in the native Tauri window: empty initial state; adding an account; synthetic login reaching native quota persistence; both main and additional quota buckets; authoritative reset-credit count; manual refresh; editing a label and color; persisting the pin setting; hiding the dashboard on Command-W; and a second launch exiting successfully while reopening the first instance's window. The first smoke found an immediate-login-completion UI race, which was corrected and covered by a regression test. The rebuilt debug application passed the same immediate-completion scenario: connected account, populated quotas and no stale pending-login dialog. Language was verified on disk, followed by normal Command-Q exit (code 0), a fresh launch with the same synthetic root, and the expected English interface and retained account. Historical screenshots are kept outside the public repository.

The manager independently ran all 30 frontend tests, all 23 Rust tests (`cargo test --locked --offline`), the production frontend build and formatting check. The final general and notification reviews closed their identified findings through source inspection; those reviews do not certify real credential or OS notification behavior.

The manager also completed `npm run tauri -- build --bundles app`: the optimized macOS application is `src-tauri/target/release/bundle/macos/CodexDeck.app` (12.72 MiB). This is a local build, not a notarized/published distribution. Its minimum macOS version is 13.0. The debug bundle was used for isolated native UI tests; the release bundle was built but not used with real accounts.

Frontend browser checks separately covered Persian RTL/Gregorian dates, English, light/dark presentation and list layout. A native popup interaction timed out in the computer-use tool; this is not evidence that popup selection itself is broken. Real sign-in, locked-store behavior and actual notification permission/presentation have not been exercised, and Windows/Linux have not been executed locally.

## Importing Swift metadata

On explicit request, the metadata-only importer can populate an empty native data root. It preserves UUIDs (normalized to lowercase), manual order, labels, emails, plans, requested/resolved workspaces, colors, full cached snapshots, manual subscription dates, settings and alert transition state. Swift Date fields receive the 978307200-second epoch conversion; API reset dates remain unchanged. It does not read profiles, auth files, Keychain items or undo backups. Imported accounts require signing in again; their cached usage remains visibly stale.

The app must be closed. Without `--apply`, the script only validates and reports the account count. Apply requires exclusive ownership of the destination lock, writes private backups and metadata atomically, verifies the output and records an idempotent receipt. A destination with accounts is never overwritten. Unknown source fields remain preserved in the private source metadata archive. No diagnostics consent is transferred.

```sh
python3 scripts/import_swift_metadata.py \
  --source "$HOME/Library/Application Support/Codex Usage/accounts.json" \
  --destination "$HOME/Library/Application Support/com.codexdeck.desktop" \
  --preferences "$HOME/Library/Preferences/local.codex.usage.plist" \
  --apply
python3 -m unittest discover -s scripts/tests -p 'test_import*.py'
```

Migration archives are stored in the app data directory under `migration-backups/`. Keep account metadata, credentials and migration archives outside the repository.
