# macOS native integration

Swift adapters, account switching, authorization, credential access and Codex RPC implementation for CodexDeck. `credential-broker/` contains the stable XPC service.

`src-tauri/build.rs` compiles the bridge; `scripts/build-credential-broker.py` packages the broker. Run `npm run build:mac` from the repository root after changes.

Private signing identities and broker caches remain in the ignored `.local-data/` directory. Keep bundle identifiers and the saved signing identity stable.
