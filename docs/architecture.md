# Architecture

| Path                                         | Responsibility                                       |
| -------------------------------------------- | ---------------------------------------------------- |
| `src/`                                       | React interface, localization and frontend tests     |
| `src-tauri/src/backend.rs`                   | Account operations and state coordination            |
| `src-tauri/src/rpc.rs`                       | Isolated Codex CLI processes and JSONL RPC           |
| `src-tauri/src/storage.rs`                   | Local metadata and profile directories               |
| `src-tauri/src/alerts.rs`, `notification.rs` | Quota transitions and native notifications           |
| `src-tauri/src/transfer.rs`, `warmup.rs`     | Encrypted transfer and one-shot prompt scheduling    |
| `native/macos/`                              | Swift account-switching bridge and credential broker |
| `scripts/`                                   | Build, signing, packaging and migration tools        |

## Frontend/native boundary

[bridge.ts](../src/lib/bridge.ts) defines frontend calls; [types.ts](../src/lib/types.ts) defines their data. [lib.rs](../src-tauri/src/lib.rs) registers native handlers. Keep these files aligned when changing the interface; command arguments and returned JSON use camelCase. Timestamps use Unix seconds.

Events update state (`state-changed`), login (`login-changed`), switching (`desktop-switch-progress`) and scheduled prompts (`warmup-changed`). The frontend uses capability flags to enable platform-specific operations. User-facing errors are localized through `src/lib/presentation.ts`.

Isolated accounts use separate CLI homes and the OS credential store. macOS original-account switching uses a Swift transaction and a signed XPC broker; keep bundle identifiers and signing identity stable. Archive credentials stay native to the [transfer implementation](account-transfer.md).

macOS is locally validated. Windows/Linux runtime behavior remains unverified; original-account switching is unavailable there. Notification availability depends on native readiness and OS permissions.
