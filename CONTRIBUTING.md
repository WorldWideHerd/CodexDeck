# Contributing

Start with the [README](README.md) for installation and the [development guide](docs/development.md) for app behavior. Run commands from the repository root.

## Making changes

Keep interface changes in `src/`, Rust behavior in `src-tauri/` and macOS Swift integration in `native/macos/`. Keep the [frontend/native contract](docs/architecture.md) current when changing commands or data formats. Include a clear description of the problem, the change and validation in pull requests.

Use synthetic accounts and temporary directories for tests. Never include real credentials, account archives, login URLs, `.env`, `.local-data/`, signing keys or private service configuration in changes or reports. Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Validation

Run `npm test` and `npm run format:check` for frontend changes, `cargo test --locked --manifest-path src-tauri/Cargo.toml` for native behavior and `python3 -m unittest discover -s scripts/tests -p 'test_*.py'` for build tools on macOS. Build the full native app after changes; on macOS use `npm run build:mac`. Record the actual operating system and results. A browser preview or frontend build alone does not validate native integration.

## Local artifacts

`node_modules/`, `dist/`, `output/`, `src-tauri/target/`, generated icons, `.build/` and `.local-data/` are ignored. Preserve existing signing identities and credential broker caches during cleanup. The server is maintained separately and is not a build dependency.

## Language

Write documentation, issue and pull request templates, commit messages and code comments in English. Persian text belongs only in app localization, required localization tests and bundled language resources. Keep historical screenshots containing localized text outside the public documentation.
