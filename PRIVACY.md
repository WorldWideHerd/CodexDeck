# Privacy

Account labels, settings and cached quotas are saved in the app's local data directory. Sign-in credentials use the operating system's credential store; exported account archives include credentials encrypted with your chosen password.

CodexDeck communicates with the installed Codex CLI for authentication and usage requests. **Start / schedule** sends a real `Reply only OK.` prompt through selected accounts and may consume quota. The current app has no diagnostic reporting or update-service integration.

On macOS, switching the original Codex/ChatGPT account changes that app's login after system authentication and saves a recovery backup in Keychain.

Treat [account exports](docs/account-transfer.md) and their passwords as sensitive. Do not attach real account data to issues.
