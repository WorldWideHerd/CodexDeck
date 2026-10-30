# Security

Use GitHub's **Security → Report a vulnerability** when available. Otherwise, open an issue requesting a private contact without describing the vulnerability. A dedicated reporting address is not configured.

Never post tokens, login URLs, `auth.json`, account archives, Keychain exports, `.env` or signing keys publicly. Include the app version, operating system and steps using synthetic data where possible.

The macOS credential broker uses code-signing checks between the app and its bundled XPC service. Account switching requires system authentication and retains a recovery backup. Keep the app's signing identity and cached broker stable across local builds; changing them can require new Keychain approval.
