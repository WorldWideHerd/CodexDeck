# Privacy

Account labels, settings and cached quotas are saved in the app's local data directory. On macOS, managed account sign-in credentials use owner-only `auth.json` files inside private profile directories (files `0600`, directories `0700`). These files are not encrypted by the app and can be read by software running as your user. Other platforms use the operating system's credential store. Exported account archives include credentials encrypted with your chosen password.

CodexDeck communicates with the installed Codex CLI for authentication and usage requests. **Start / schedule** sends a real `Reply only OK.` prompt through selected accounts and may consume quota. Update-service integration is not enabled. Optional app-presence and technical-error reporting is described below.

On macOS, switching the original Codex/ChatGPT account changes that app's login after system authentication and saves a recovery backup in Keychain.

Treat [account exports](docs/account-transfer.md) and their passwords as sensitive. Do not attach real account data to issues.

## Optional presence and technical reports

Reporting is off until you choose **Enable optional reporting** in the app. **No thanks** keeps it off and dismisses the prompt. Change your choice at any time in Settings → Optional reporting. Reporting is independent of account operations; an unavailable reporting server does not prevent using the app.

When enabled, the native app sends HTTPS requests to `https://codexdeck-api.worldwideherd.com`:

- **Presence:** a random session UUID and an online/offline flag, about once per minute while the app runs (including in the menu bar). The UUID is held in memory and changes after restarting or re-enabling reporting. The server retains current presence in memory for at most three minutes after the last signal. It does not write presence history to the database. The dashboard shows reporting app instances, not an exact count of people or foreground activity.
- **Technical errors:** a separate temporary random reporting identifier, a random event UUID, app version/build, event time and predefined operation/error codes. The app never adds raw error messages, stack traces, account names, emails, account IDs, tokens, login URLs, chats, file paths, quotas or hardware identifiers. Repeated errors are throttled. There is no durable report queue and no replay of errors from before consent.

The server keeps technical report rows for 30 days and daily error totals for up to 365 days, with deletion performed by daily cleanup. It does not store the request IP in report tables. Network services, including Cloudflare and the reverse proxy, can see connection IPs and request metadata; their logs and backup retention are managed separately by the operator. This is limited, pseudonymous reporting rather than a promise of complete anonymity.

Disabling reporting stops new reports and requests removal of the current presence. If that request cannot reach the server, presence expires after three minutes without another heartbeat. Previously submitted technical reports follow the retention schedule above. Closing or sleeping the app may leave a presence visible until it expires. No telemetry consent is exported with an account archive; importing accounts preserves this device's choice.

The desktop app contains no server administration key. Only the administrator can view the aggregate dashboard; online session identifiers are not returned by its API. Use a single server replica for the in-memory online count: a server restart clears the count and active apps repopulate it on their next heartbeat.
