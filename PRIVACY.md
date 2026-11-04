# Privacy

Account labels, settings and cached quotas are saved in the app's local data directory. On macOS, managed account sign-in credentials use owner-only `auth.json` files inside private profile directories (files `0600`, directories `0700`). These files are not encrypted by the app and can be read by software running as your user. Other platforms use the operating system's credential store. Exported account archives include credentials encrypted with your chosen password.

CodexDeck communicates with the installed Codex CLI for authentication and usage requests. **Start / schedule** sends a real `Reply only OK.` prompt through selected accounts and may consume quota. The current app has no diagnostic reporting or update-service integration.

On macOS, switching the original Codex/ChatGPT account changes that app's login after system authentication and saves a recovery backup in Keychain.

Treat [account exports](docs/account-transfer.md) and their passwords as sensitive. Do not attach real account data to issues.
