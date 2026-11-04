# Development

Run commands from the repository root. Prerequisites are listed in the [README](../README.md).

## Commands

| Command                  | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `npm run tauri -- dev`   | Run the native app                                         |
| `npm run dev`            | Browser preview; sample data only                          |
| `npm run build`          | Type-check and build the frontend into `dist/`             |
| `npm run tauri -- build` | Build and package for the current platform                 |
| `npm run build:mac`      | Build, sign and publish the local macOS app into `output/` |
| `npm run package:mac`    | Package a complete signed app as a preview ZIP, checksum and manifest |
| `npm run version:check`  | Check that application versions and lockfiles agree |

## Checks

```sh
npm test
npm run test:release
npm run version:check
npm run licenses:check
npm run format:check
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

On macOS, also run the build-tool checks and complete app build:

```sh
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
bash scripts/test-desktop-quit.sh
npm run build:mac
```

The [CI workflow](../.github/workflows/ci.yml) defines macOS, Windows and Linux checks. Its configuration alone does not establish support on those platforms.

macOS checks build and package the complete signed app, including the credential broker. Windows/Linux checks build installers. See the [release guide](releasing.md) for architecture selection, GitHub artifacts, version updates and the separate notarized release workflow.

## macOS signing

Use `output/CodexDeck.app`; the intermediate Tauri bundle has not completed the project's signing and broker packaging steps. The default development identity and broker cache live in ignored `.local-data/`. Preserve them across rebuilds.

To use an existing signing identity, set `CODEXDECK_SIGNING_IDENTITY` and, if needed, `CODEXDECK_SIGNING_KEYCHAIN`. Signing does not perform notarization.

Original-account switching requires the signed app and the official Codex/ChatGPT application installed in `/Applications`. Finish open work before switching; Settings provides **Restore original desktop account**.

## Local files

Dependencies and generated output (`node_modules/`, `dist/`, `output/`, `src-tauri/target/`, generated icons and `.build/`) are ignored. Private service configuration is maintained outside this repository and is not a build dependency.

The optional `scripts/import_swift_metadata.py` tool imports old Swift metadata into an empty destination. Run with `--help`; omit `--apply` to validate without writing. Credentials are not imported, so accounts require signing in again.

After dependency changes, regenerate and review notices with `npm run licenses:generate`. This reads the complete locked Rust graph, including other platforms. For the reviewed GLib backport, install the GLib development library and run the optimized probe described in [vendor/README.md](../vendor/README.md).

The macOS signing helper temporarily includes only the local signing keychain alongside the existing search list while `codesign` runs, then restores the list even if signing fails. It does not change the default keychain, trust settings or account credential ACLs. Build-tool tests exercise a fresh temporary identity so CI does not depend on a developer’s cached signing state.

## Reporting connection check

After deploying the companion server, run the built app executable with `--reporting-smoke-test`. This exits before normal app initialization and uses the production native HTTPS transport to check `/health`, `/ready`, and a temporary presence join/leave. It does not load local accounts or generate synthetic diagnostic records. Run it explicitly; ordinary startup never runs the probe or overrides a saved disabled preference.

```sh
output/CodexDeck.app/Contents/MacOS/codexdeck --reporting-smoke-test
```

The service must include `/v1/presence`; deploy server changes before distributing this app. Reporting defaults to on for new installations and missing/null legacy preferences, with no permission prompt. Existing explicit opt-outs stay off; users can change the setting under Usage & errors. Keep reporting endpoints behind HTTPS with the real trusted Traefik CIDR configured on the server. Current clients do not send durable installation/launch metrics; the server's historical 7/30-day charts remain separate from its live count.
