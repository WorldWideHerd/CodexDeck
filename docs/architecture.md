# CodexDeck desktop command contract

The current Tauri app lives in the repository root. This document records the frontend/native command boundary and data formats. Active shared macOS security code lives in `native/macos/`.

## Shared interface

Tauri commands accept camelCase argument keys, return camelCase JSON. All times below are UNIX seconds (not Swift reference-date timestamps).

`get_state() -> AppState`
`add_account({label, workspaceId?}) -> AppState`
`update_account({id, patch}) -> AppState` (label, color, subscriptionEndsAt, alertThreshold)
`remove_account({id}) -> AppState`
`reorder_accounts({ids}) -> AppState`
`save_settings({patch}) -> AppState`
`refresh_accounts({id?}) -> AppState`
`start_login({id}) -> LoginState`
`cancel_login({id}) -> AppState`
`open_login_url({id}) -> void`
`set_pinned({pinned}) -> void`
`choose_codex_executable() -> AppState`
`get_platform_capabilities() -> PlatformCapabilities`
`switch_desktop_account({id}) -> AppState`
`restore_desktop_account() -> AppState`
`quit_app() -> void`

Events: `state-changed` payload AppState; `login-changed` payload LoginState. Command errors must be user-safe strings with no secrets.

AppState = { accounts: Account[], settings: Settings, codexExecutable: string|null, lastError: string|null }
Account = { id: string, label: string, email: string|null, plan: string|null, workspaceId: string|null, snapshot: UsageSnapshot|null, updatedAt: number|null, color: string|null, subscriptionEndsAt: number|null, alertThreshold: number|null, status: 'idle'|'refreshing'|'signingIn'|'connected'|'needsLogin'|'failed', error: string|null }
Settings = { language: 'fa'|'en', appearance: 'system'|'light'|'dark', refreshMinutes: number, layout: 'cards'|'list', sort: 'manual'|'fiveHour'|'weekly'|'reset', pinned: boolean }
LoginState = { accountId: string, loginId: string|null, url: string|null, status: 'pending'|'complete'|'cancelled'|'failed', error: string|null }
PlatformCapabilities = { platform: string, desktopSwitch: boolean, desktopRestore: boolean, reason: string|null }
UsageSnapshot contains: rateLimits?, rateLimitsByLimitId?, rateLimitResetCredits?, accountId?. Bucket windows use usedPercent, windowDurationMins?, resetsAt?. Preserve additional buckets and reset credits.

Frontend should treat capabilities as authoritative and explain unsupported features honestly. Never show simulated successful switching. Backend should implement safe platform support where verified; otherwise return an actionable unsupported reason and document what remains. Existing credentials must never be silently migrated or overwritten.

## Delivery target

Working buildable desktop app with shadcn components, Persian RTL/English, light/dark/system, real isolated account login and quota refresh through Codex CLI, persistent metadata, cards/list/sort/manual order/edit/remove, quota alerts where supported, tray and pinned dashboard. Platform-specific account switching, secure credential compatibility, update/diagnostics service parity must be explicitly assessed; do not claim full parity without validation.
