# Security

Use GitHub's [private vulnerability reporting](https://github.com/WorldWideHerd/CodexDeck/security/advisories/new) when the repository owner has enabled it (Security → Report a vulnerability). Otherwise, open an issue requesting a private contact without describing the vulnerability. A dedicated reporting address is not configured.

Never post tokens, login URLs, `auth.json`, account archives, Keychain exports, `.env` or signing keys publicly. Include the app version, operating system and steps using synthetic data where possible.

The macOS credential broker uses code-signing checks between the app and its bundled XPC service. Account switching requires system authentication and retains a recovery backup. Keep the app's signing identity and cached broker stable across local builds; changing them can require new Keychain approval.

Dependency advisories and the reviewed Linux GLib backport are tracked in [dependency security](docs/dependency-security.md). Upstream maintenance warnings remain visible; release preparation does not imply that every platform has been runtime-tested.
