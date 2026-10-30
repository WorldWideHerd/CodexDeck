# Development guide

Independent React 19 + TypeScript + Vite application for the Tauri 2 rewrite. The Rust application is maintained in `src-tauri/`. Existing Swift sources and account data are not imported or modified by this frontend.

## Use in Codex (macOS)

For a connected account, **Use in Codex** now uses the previous Swift app’s original-account workflow: approve Touch ID or your Mac password, quit the original Codex/ChatGPT app normally, save a recovery backup in Keychain, apply the selected login, verify it and reopen the original app. Finish open work before approving. Settings → **Restore original desktop account** restores the preceding login. Failed verification, partial writes and launch failures use the existing rollback transaction; an interrupted recovery retains its Keychain backup. The UI shows the current stage.

This is available in the signed macOS build produced by `npm run build:mac`, with the official Codex/ChatGPT app installed in `/Applications`. Quit the older Swift widget before using the new integration. The main account’s usage reads use the original credential home, preventing a second isolated reader from refreshing a stale copied login. Switching away or restoring synchronizes refreshed credentials back to matching isolated accounts. Sign-in/removal of the active original account and archive transfer require restoring/switching away first. Windows/Linux switching remains unavailable.

## Full account transfer

Settings → Account transfer & backup exports/imports password-encrypted, versioned JSON containing accounts, complete sign-in credentials, settings and cached usage. Existing duplicate accounts are kept and imported settings are restored. See [the archive format and compatibility contract](account-transfer.md). This feature applies to Tauri accounts; Swift metadata migration remains separate.

On macOS, export reads all requested account credentials in one call to the signed credential broker. One fresh LocalAuthentication context authorizes the export with Touch ID (Mac password fallback) and is shared by all Keychain reads, then invalidated. Previously the rebuilding main executable performed an independent Keychain read per account, potentially producing one password prompt per item. Legacy item ACLs or a locked login Keychain may still require system password approval; export does not rewrite those permissions. The portable archive still requires its own encryption password. Cancellation stops immediately without writing a partial export or retrying individual reads.

## Workspace redesign

New installations default to a compact account list; existing saved layout choices are preserved. Each row compares main-bucket five-hour and weekly remaining quotas with reset countdowns. Click the account identity or disclosure button to expand full details, account actions, additional buckets, alerts and manual reorder controls. Card view remains available. Missing windows stay unknown, cached values are labelled, and passed reset times continue to await server confirmation.

`src/workspace.css` owns the new workspace theme and responsive layout. The quick tray panel uses matching surfaces, saved sorting, plan labels and reset countdowns. Command/Ctrl-R refreshes in the native app; Command/Ctrl-comma opens Settings. Reduced-motion preferences disable decorative transitions.

Validation: production frontend build and 39 tests pass. Browser review covered Persian dark mode, English light mode, compact and desktop widths, disclosure and card layout. The original redesign did not add account switching; the subsequent signed macOS integration is described above. Native Windows execution and packaged macOS behavior were not validated by this UI pass.

## Run

Node 22.12 or newer is required.

```sh
npm ci
npm run dev            # browser: http://127.0.0.1:1420
npm run tauri dev      # native desktop, requires the Rust/Tauri prerequisites
npm run build          # typecheck and production frontend -> dist/
npm test
npm run format:check
npm run tauri build    # frontend and native packaging
npm run build:mac      # macOS .app with persistent project signing identity
```

The browser starts with **zero accounts**. The explicit “Show sample data” button opts into clearly labeled, in-memory synthetic examples. Reloading discards these examples. Browser operations never invoke native account commands, log in, refresh quotas, switch desktop accounts, or save credentials. Language, theme, sorting and layout controls work locally for visual review. Native operations are enabled only inside Tauri.

## Frontend structure

- `src/App.tsx`: application state, native event lifecycle, navigation and login/delete dialogs.
- `src/components/account-card.tsx`: multi-bucket quotas, reset credits, manual deadlines, account actions and accessible reorder controls.
- `src/components/account-form.tsx`: account metadata editor, custom color, manual local subscription date, optional alert threshold.
- `src/components/settings-panel.tsx`: language, appearance, refresh interval and CLI/capability settings, plus a native-only Quit app action.
- `src/components/ui/`: actual shadcn/ui New York registry component sources (Radix primitives), checked into the project as intended by shadcn. Progress additionally forwards its value for accessibility. The upstream MIT notice is preserved in `docs/licenses/shadcn.md` and copied into `public/licenses/shadcn-MIT.txt` so production assets include it.
- `src/lib/bridge.ts`: the exact command/event boundary from `architecture.md`; no alternate command names or simulated native success.
- `src/lib/login-lifecycle.ts`: generation-aware login reducer; terminal events cannot be overwritten by late pending command responses/events. Completed, cancelled and timed-out attempts discard the displayed sign-in URL; new attempts retire previous login IDs.
- `src/lib/presentation.ts`: allowlisted Persian/English error summaries, state-ingress error normalization and product-facing capability text. Unknown errors use a fixed localized fallback; raw native text is never echoed, persisted or sent. Login, account, application and notification-permission messages share this presenter. Technical backend reasons remain in implementation documentation.
- `src/lib/usage.ts`: main-bucket quota sorting, all-bucket reset sorting, unknown values, stale status, deadlines and localized countdowns.
- `src/lib/*.test.ts`: quota and contract regression tests. Contract tests mock transport only; they do not read real credentials.
- `public/fonts/Vazirmatn.ttf`: copy of the existing repository font; no remote font request. Its SIL Open Font License is shipped beside it as `public/fonts/OFL.txt`.

Persian uses RTL and Persian digits. The default calendar is **Persian (Solar Hijri)**; Settings offers an independent Gregorian calendar option for either language. Manual subscription dates are entered in the selected calendar and converted to local Unix timestamps. Manual subscription dates are edited in local time and transmitted in Unix seconds. Settings and metadata persistence, periodic refresh, notification permissions/delivery, tray behavior, pinning and platform operations belong to the Rust backend. The frontend does not create duplicate refresh or system-notification timers. Quotas remain cached after reset until the server confirms the reset. Unknown reset-credit counts remain unknown.

Five-hour and weekly sort operate on the main bucket; next-reset sort considers every future window. Manual drag ordering and keyboard-accessible up/down buttons preserve saved order. Cached data is stale after `refreshMinutes * 60 + 120` seconds, or immediately for failed/needsLogin/idle state. Gift and subscription deadlines indicate three-day, one-day and expired urgency.

## Sources reviewed

- Tauri 2 command/camelCase argument and event documentation: https://v2.tauri.app/develop/calling-rust/
- Official Vite setup: https://ui.shadcn.com/docs/installation/vite
- Official registry: https://ui.shadcn.com/r/styles/new-york/{button,dialog,input,badge,card,progress,label,separator}.json
- shadcn/ui license: https://github.com/shadcn-ui/ui/blob/main/LICENSE.md

Downloaded registry components are not recreated look-alikes. Tailwind 4 is configured through `@tailwindcss/vite`; aliases and `components.json` allow subsequent shadcn additions.

## Validation and limits

`npm run build`, strict unused-code typechecking and 30 tests pass. `npm audit` reported zero vulnerabilities after moving Vitest to the fixed 5.0.5 series. Prettier formats the project. Browser QA verified the default empty state, explicit synthetic preview, Persian RTL, Gregorian dates with Persian digits, English language switch, list layout settings and the light theme. Historical preview screenshots are kept outside the public repository.

This is frontend validation. Real-account sign-in, CLI quota reads, native tray/pin/notification behavior, installed macOS application behavior, Windows and Linux execution must be assessed through the backend/native validation. Capability flags are authoritative: unsupported switching/restoration stays disabled with the backend reason. No Swift credential migration, updater, minimum-version enforcement or diagnostics feature is claimed by the frontend.

Network setup required permission outside the restricted environment. The first Python network attempt failed DNS; the system Python had a CA-chain error. The Homebrew Python's verified TLS successfully retrieved the official registry; certificate validation was never disabled. npm used the installed Node 22 executable and a temporary cache.

The final native lifecycle addition uses `quit_app()` through `bridge.quit()`. The Quit app button is rendered only in Tauri settings and is disabled while an operation is running. Native pending-operation shutdown behavior stays owned by the backend. Browser mode rejects quit before invoking transport. Both font and shadcn license notices are copied by Vite into `dist/` for packaged distribution.

Supporting text contrast was checked using WCAG relative luminance. Light muted text is `#626c78`; warning text uses `#8a5b08` in light appearance and `#e4b45d` in dark appearance. Across canvas, card, muted and secondary surfaces, muted text has at least **4.76:1** contrast in light and **4.77:1** in dark. Deadline warnings have at least **5.23:1** in light and **6.94:1** in dark. Stale-warning text on its actual 10% amber-tinted card background measures **5.45:1** in light and **7.45:1** in dark (sRGB alpha compositing included). Decorative quota bars and icons are unchanged.

Localization does not claim to translate every possible native error. Known login, CLI, connection, storage and notification errors have actionable Persian/English summaries. Unknown errors show a short retry/restart message in the selected language. Only an allowlisted error code is kept when native state or login events enter React state; exceptions are likewise classified immediately. No raw-error logging, local storage or telemetry was introduced. Unavailable account switching uses localized installation/signing/platform explanations. The signed macOS build enables original-account switching and restoration, and reports authorization, verification and recovery errors without raw credential data.

Login lifecycle regression tests explicitly defer a mocked start-login response, deliver a completion/cancellation/failure event first, then resolve the pending response and verify the dialog stays closed. Additional cases cover successful local cancellation, dismissed failure, previous request generations, retired login IDs, unrelated accounts and terminal events without a login ID. Every UI cancel path uses the same reducer marker. Native implementation files are unchanged by this fix.

Card actions are consolidated in the account menu; the footer retains update time, refresh and actionable sign-in/cancel state. Quota alerts use an explicit enable checkbox, threshold presets and a custom percentage. The shared account-color editor provides labelled presets, a custom-color control and a validated HEX field.

Account supplementary information now opens in a Radix popover anchored to the More information button. It is portalled outside the card layout, flips to fit the available window space, scrolls long details internally, closes on outside click/Escape, and restores trigger focus. The reset-credit expiry indicator opens the same panel. Editing the subscription closes the panel without stealing focus from the editor. Interaction tests cover these dismissal and focus paths; viewport geometry still needs native visual validation.

## Start usage window

The dashboard's **Start / schedule** control sends `Reply only OK.` to selected connected accounts immediately or once at a local date/time within 30 days. It uses the existing per-account ChatGPT app-server connection, an ephemeral thread, an empty temporary working directory, read-only sandboxing, no approvals, and disabled shell/web/app tools. It does not switch the main desktop account or promise a visible Work chat. This is a real inference request and consumes quota.

Before each send, the backend reads fresh identity and quotas. A known five-hour bucket with a future server reset is skipped as already active; absent buckets remain unknown and are skipped. After a single request, the backend waits for the matching turn completion and rechecks quotas up to three times. Only a future reset on the server's five-hour bucket confirms an active window. A completed response alone is labelled separately; no reset timestamp is calculated locally. This does not guarantee that a message starts a window on every plan or model; real-account behavior still needs validation.

One pending/running batch is allowed. Schedule and per-account results persist locally, including a claim written before inference. Restarted in-flight batches are interrupted; overdue schedules are missed. The app must be running with the computer awake and online; a wall-clock suspension gap or more than 15 seconds of lateness skips the schedule. Pending batches can be cancelled. Requests run sequentially, so later accounts start later. There is no recurring schedule or automatic replay of a failed/uncertain send. The current batch/report is replaced only by the next explicit request and is not included in account transfer archives. Credentials and message responses are not added to the report.

macOS notification testing requires `output/CodexDeck.app` from `npm run build:mac`. The command stages, signs, verifies and atomically publishes the app. The macOS Rust build script compiles the canonical PNG into an asset catalog and ICNS before Tauri packages any bundle; `Info.plist` and `tauri.macos.conf.json` include the same named icon in both intermediate and published apps. Do not launch the intermediate `target/release/bundle/macos` bundle: Tauri creates it before signing is complete. After successful publication, `register-macos-app.py` unregisters and preserves the intermediate app, legacy `dist/desktop-release/CodexDeck.app`, and old discoverable backups with a `.app.backup` suffix, then registers only `output/CodexDeck.app`. Unregistering without moving the duplicate is insufficient because LaunchServices can rediscover it. The canonical bundle identifier and signing identity stay unchanged, preserving notification permissions. The Swift app (`local.codex.usage`) and Tauri app (`com.codexdeck.desktop`) have separate notification permissions even though both display CodexDeck. The build reuses the existing private local signing identity without changing either app identifier. Returning from system settings rechecks native readiness; Settings also offers a recheck without sending a notification. A failed authorization request is reported separately from permission denial.
