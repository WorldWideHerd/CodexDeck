# CodexDeck

A Codex account usage dashboard built with Tauri 2, React, TypeScript and Rust. Monitor multiple isolated accounts, compare quotas, receive alerts and use the menu bar panel. Persian and English interfaces are included.

The signed macOS build also supports switching the main Codex account. Windows and Linux runtime support still require validation on those platforms.

## Getting started

Requirements: Node.js 22.12+, a stable Rust toolchain and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. macOS builds also require Xcode and Python 3.

Run all commands from the repository root:

```sh
npm ci
npm run tauri -- dev
```

For a browser preview, use `npm run dev`. Native account operations require the Tauri app; sample accounts are an explicit visual preview.

## Build

```sh
# Complete signed macOS application
npm run build:mac

# Native packaging on the current platform
npm run tauri -- build
```

The signed macOS app is `output/CodexDeck.app`. Build output and local signing material are ignored by Git. See the [development guide](docs/development.md) for signing, packaging and account workflows.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/` | React interface, styles and frontend tests |
| `src-tauri/` | Rust backend, platform configuration and native Objective-C bridges |
| `native/macos/` | Swift integration, account switching and credential broker |
| `public/` | Fonts, branding and third-party notices |
| `scripts/` | Build, signing, packaging and migration tools |
| `scripts/tests/` | Tests and synthetic native probes for the tools |
| `docs/` | Development, platform status and data contracts |
| `.github/` | Continuous integration and issue templates |

This repository contains the app. The optional companion server and private deployment configuration are maintained outside the repository and are not needed to build or run it.

## Checks

```sh
npm test
npm run format:check
cargo test --locked --manifest-path src-tauri/Cargo.toml
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
npm run build:mac
```

Native Python checks require macOS. A successful macOS build does not validate Windows or Linux behavior.

[Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) · [Development](docs/development.md) · [Native backend](src-tauri/README.md) · [Platform status](docs/platforms.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

## License

CodexDeck is licensed under the [MIT License](LICENSE). Third-party components and fonts retain their own licenses; see [third-party notices](docs/README.md#third-party-licenses).
