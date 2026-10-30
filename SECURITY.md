# Security reports

Do not post tokens, `auth.json`, login URLs, `.env`, Keychain exports, account
folders, conversation content or an unredacted proof of a vulnerability publicly.

If the repository offers **Security → Report a vulnerability**, use that private
channel. If it does not, open an issue titled “Request for private security contact”
without disclosing the vulnerability. A dedicated private reporting contact has
not yet been configured for this beta.

Use the latest available beta when checking a problem. Account switching modifies
the original desktop app's login only after confirmation.

The macOS credential component is an app-bundled XPC service. Its connections use
macOS code-signing requirements in both directions, including the expected bundle
identifier and signing certificate; a bundle identifier by itself is insufficient.
The service checks the peer's user ID, allows only `Codex Auth` and
`Codex Usage Desktop Switch`, validates the `cli|` account key and limits payloads
to 2 MiB. It has no arbitrary command, file-path or network interface. Both the
main app and service use the hardened runtime. Ordinary app updates reuse the exact
signed service binary so the service's Keychain code-hash partition stays stable.
Changing that service can require a fresh permission. Existing ACLs are preserved;
new shared login records allow only the service and signature-verified OpenAI
programs that use them. Backups are created for the service alone. Keychain and
macOS user policies still apply; local authentication is a separate operation gate.
