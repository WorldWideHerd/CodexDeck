# Notification implementation review — 2026-10-28

## Current closure review — supersedes the historical findings below

The current source was reread after the core fixes. This is independent **source review only**: the manager reports 23 Rust tests passing, but this follow-up did not rerun them or execute any native permission/notification operation. The earlier 10-test temporary-crate result below applies only to the earlier snapshot; its two defect-evidence assertions are now obsolete and must not be presented as tests of the fixed version.

| Finding | Current disposition and source evidence |
| --- | --- |
| N1 visual restrictions consume dedup | **Closed for current known macOS settings.** `notification::classify_macos` reads authorization, alert setting/style, sound and notification-center setting. `Quiet.can_send()` is false. Authorized visual notifications with disabled sound remain intentionally sendable as `Silent`; unknown sound is separately `SoundUnknown`. |
| N2 recovery during denial | **Closed by source inspection.** `alerts::reserve` evaluates fresh quota before permission gating, records recovery and leaves blocked downward crossings unreserved. `Backend::check_alert` now calls this path even when readiness is blocked. |
| N3 Windows asynchronous failure | **Safely deferred.** Enabled Windows `ToastNotifier.Setting` maps to `Unverified`, which cannot reserve/send through the backend. The retained Windows send helper still lacks asynchronous failure tracking/installed identity validation, but that is not a currently reachable alert-delivery defect. Do not claim Windows quota-alert support until implemented and validated. |
| N4 Linux authorization unknown | **Safely deferred.** A reachable server now returns `Unverified`, whose message explicitly says quota alerts are unavailable. Server reachability no longer authorizes reservation. Linux sound/permission/DND parity remains unsupported, not simulated success. |
| N5 global state lock during OS send | **Closed by source inspection.** `check_alert` drops `saved` before external send and checks matching account, threshold and reservation before rollback. Per-account refresh serialization remains. A rollback-save error is now explicitly surfaced. |
| N6 stale sound warnings | **Closed for fresh quota checks.** `check_alert` updates `readiness.message()` on each fresh check, emits changed warnings even without a reservation change, and clears a previous recognized readiness message on Ready. This is polling after successful refresh, not continuous OS-settings monitoring. |

No remaining definite P1/P2 implementation defect was established in this bounded closure review. Existing known limits must remain explicit: scheduling acknowledgement is not proof of visible/audible presentation; timeout can race late OS acceptance and cause a retry duplicate, while crash between reservation persistence and submission can suppress delivery. The new backend error text correctly describes timeout ambiguity and rollback persistence failure. These are documented delivery tradeoffs, not exactly-once delivery.

Callback/lifetime improvements are also present: `Registration::drop` removes cancelled registrations; poisoned map locks use recovery rather than panic across the C boundary; foreground options now include banner/list/sound. The existing ARC-retained NSString/block lifetime assessment still applies. Native send rechecks authorization without prompting before scheduling. There is still no atomic guarantee that user settings cannot change between the readiness check and OS enqueue; no platform API shown supplies such a guarantee.

Remaining acceptance evidence: installed macOS denial/later grant, visual/sound setting changes, foreground/background scheduling, delayed/missing callbacks and storage-failure injection. Native UI tests were deliberately not executed. Windows/Linux remain gated safe deferrals. Do not reopen platform support based solely on a helper returning success or compilation.

**Historical material below is retained as the before-fix audit trail. Its claims marked open, old enum/status encoding, line numbers and test evidence describe the earlier snapshot and are not the current implementation contract.** Current macOS permission values are packed with marker `0x1000`: auth bits 0–2, alert 3–4, sound 5–6, style 7–8, notification-center 9–10. `Ready`, `Silent`, `SoundUnknown` are sendable; `Quiet`, `Unverified`, `NotRequested`, `Denied`, `Unavailable` are blocked. Function names remain `permission(request: bool)` and `send(title, body)`.

## Scope and outcome

The manager changed this specialist task from a second Rust/objc2 adapter to a read-only review of the core implementation. The unused specialist `src/notification_adapter.rs` was removed before integration; **do not add objc2 dependencies for it**. This document is the specialist's only final repository artifact. No other implementation file was changed by this review.

Reviewed `src/notification.rs`, `src/notification_mac.m`, `build.rs`, the alert enable/refresh paths in `src/backend.rs`, `src/alerts.rs`, and notification-related configuration. References below are a concurrent working-tree snapshot; function names are the stable anchors if line numbers move.

The core implementation removes the desktop-plugin permission fiction. Installed `tauri-plugin-notification 2.8.0/src/desktop.rs:193–206` unconditionally returns `Granted` from both permission methods. The native macOS implementation instead reads `UNNotificationSettings`, requests only on explicit enable, and waits for the scheduling callback. This is a substantial correction, but visible/audible delivery parity is **not yet established**. The findings below remain actionable; successful compilation does not close them.

## Actual interface and semantics

- `notification::permission(request: bool) -> impl Future<Output = Readiness>`; this is not the initially proposed `Result<Readiness, String>` interface.
- `notification::send(title: &str, body: &str) -> impl Future<Output = Result<(), String>>`.
- `Readiness::{Ready, Silent, Quiet, NotRequested, Denied, Unavailable}`; `can_send()` currently accepts **Ready, Silent and Quiet**. `message()` returns a fixed optional user-safe explanation.
- macOS bridge status integers: permission `0 = NotRequested`, `1 = Denied`, `2 = Ready`, `3 = Silent`, `4 = Quiet`, anything else `Unavailable`; notification `0 = scheduling callback with nil NSError`, anything else failure. Rust callbacks use `extern "C" fn(u64, i32)`; Objective-C uses matching `uint64_t, int32_t`. The request flag uses C `bool` from `stdbool.h`, matching Rust `bool`.
- Linux `Quiet` currently means only `GetServerInformation` succeeded. Windows `Quiet` means `ToastNotifier.Setting == Enabled`. Neither reports sound authorization.
- **Acceptance is not presentation:** macOS completion acknowledges scheduling; Linux returns a notification-server ID; Windows `Show` returns synchronous API success. None proves a user saw or heard an alert. Focus/Do Not Disturb, previews, routing, mute and other system policy can suppress presentation. Never label `Ok(())` as confirmed visible delivery.

## Findings requiring decisions or correction

### N1 — P2: known-disabled visual alerts are treated as ready and consume dedup

Evidence: `notification_mac.m:22–31` (`status`), `notification.rs:12–13` (`can_send`), `backend.rs:589–626` (`check_alert`), `alerts.rs:44–54` (`reserve`). macOS maps authorized-but-`alertSetting != Enabled` and provisional authorization to `Quiet`, then `can_send` accepts it. `alertStyle` and `notificationCenterSetting` are not read. Apple explicitly says even `alertSetting == Enabled` can have an alert style that displays nothing.

Example: enable alerts, disable banners/alerts in System Settings, cross below the quota threshold. Readiness still passes; a nil scheduling error commits `is_below = true`. Re-enabling visual notifications while still below the threshold does not retry. This is different from unavoidable Focus suppression: a known restriction was available before reservation.

Correction: split “authorized but visual alerts disabled/provisional” from “ready with sound disabled.” Read granular visual settings and fail closed for the former under a visible-alert contract. At minimum do not claim ready/consume transitions on a known disabled visual path. Keep limited notification-center-only delivery only if intentionally supported and clearly disclosed. Test the native classification independently; the current enum-only test cannot detect this mapping bug.

### N2 — P2: disabled permission also prevents recording quota recovery

Evidence: `backend.rs:589–594` early return; `alerts.rs:51–54` returns the previous state before evaluating the new window. A pure synthetic reproduction passed in the temporary review crate: send once below threshold; while permission is denied, observe quota above threshold; restore permission and observe a new downward crossing with the same reset. The old `is_below` remains true, so the new crossing is suppressed.

Correction: separate tracking quota recovery/new periods from reserving delivery. Known denied/unknown must not reserve an unseen downward crossing, but a fresh valid recovery can clear `is_below` without sending. Persist that recovery even when delivery is blocked. Include this exact same-reset sequence in regression tests; quota values need not be monotonic (the existing transition test already supports recovery).

### N3 — P2: Windows success does not capture asynchronous toast failure

Evidence: `notification.rs:139–157` creates a notifier with a fixed AUMID, checks `Setting` separately, calls `Show`, and drops the local toast without registering `Failed`. Microsoft documents failures that occur when the system subsequently attempts to raise the toast. The backend consequently keeps the reservation after a successful `Show`, even if Windows later reports failure.

Correction/claim boundary: retain the toast and failure event registration for a defined lifetime and integrate known failures with reservation rollback. Absence of a failure event is still not a positive presentation acknowledgement; document the weaker Windows contract explicitly. If strict acknowledged scheduling cannot be established, gate this platform as unsupported for that contract rather than claiming native acknowledgement. Keep raw HRESULT/error text out of UI/logs.

Installed Windows acceptance also requires proving that the Start Menu shortcut/registered identity matches `com.codexdeck.desktop`. This review found the identifier in Tauri configuration, but did not inspect a generated installer or Windows registry. Do not infer working unpackaged/debug toast delivery from that string alone. Activation/click handling is absent and remains a separate usability gap.

### N4 — P2 for readiness claims: Linux server reachability is not user authorization

Evidence: `notification.rs:108–112` only calls `get_server_information`; `117–128` submits through `notify-rust`. The freedesktop method returns server name/vendor/version/specification version, not per-app permission or sound/DND settings. `Quiet` currently allows reservation despite this unknown state. `show()` returning a server ID is truthful server acceptance, not visible or audible delivery.

Correction: distinguish server availability from authorization/readiness in capability/UI data. The portable protocol cannot establish per-app sound permission or DND. Under the requested strict readiness gate, return an honest unsupported/unverified reason and avoid reservation; alternatively support an explicitly described limited server-acceptance contract. `GetCapabilities` can report sound *support*, but cannot establish that sound is enabled for this app. No sound hint is currently requested, so there is no affirmative audible-alert contract.

### N5 — P2 responsiveness: global saved-state lock spans external delivery

Evidence: `backend.rs:595–629` holds `saved` while awaiting `notification::send`. On macOS this can last 30 seconds; on Linux it awaits a blocking desktop-service call without an explicit outer deadline. All state readers/mutations sharing this mutex stall. No definite mutex cycle/main-thread deadlock was found in the inspected paths: native work dispatches asynchronously to the main queue and callbacks do not acquire `saved`. The problem established here is blocking unrelated state, not a claimed deadlock.

Correction: persist a reservation under the state lock, release it before external work, then reacquire to commit/rollback only the matching account/threshold/generation/reservation. Preserve the existing per-account serialization or introduce an explicit reservation identity; do not blindly restore an old record over intervening edits/removal. Bound Linux/Windows service waits and test a synthetic stalled service while another account/state operation proceeds.

### N6 — P3: sound/readiness warnings become stale after initial enable

Evidence: `backend.rs:210–234` publishes `Silent`/`Quiet` messages only when threshold changes from None to Some. `check_alert` only reports a message when `can_send == false`. Turning sound off after enable therefore produces no current readiness warning. Turning it back on does not clear an earlier warning. macOS classifies sound `NotSupported` as `Silent`, conflating unavailable and explicitly disabled sound.

For `Silent`, successful *visual* scheduling currently consumes dedup, and later enabling sound does **not** replay the alert. This is reasonable for a clearly disclosed visual-alert contract; it is not audible-delivery parity and should not silently be presented as such. A failed native scheduling call restores the previous reservation; disabled sound by itself does not.

Correction: expose current granular readiness/sound state separately from sticky `last_error`, refresh it without permission prompts, and distinguish disabled from unknown/unavailable sound. Add coverage for sound changes after enable and for successful silent delivery versus scheduling failure.

## Callback, lifetime and threading assessment

- ARC (`build.rs:3–7`) copies/retains Objective-C objects captured by escaping blocks. `codexdeck_notify:53–56` converts borrowed C strings to `NSString` synchronously before returning to Rust; the queued block strongly captures those strings. The Rust `CString` lifetime therefore does not create a demonstrated use-after-free. No raw Objective-C pointer crosses into Rust.
- The static strong delegate survives the notification center's weak delegate reference. `dispatch_once` initializes it; `deckCenter` runs on the main queue. Foreground callbacks invoke the completion handler once with banner and sound. Adding `.list` would preserve the Swift foreground notification-center behavior; the Swift baseline requested banner/list/sound.
- Native completion blocks may execute on a background thread. The C callback touches only a synchronized map and Tokio oneshot channel; it performs no AppKit/UI work. The map lock is released before invoking native entry points, so an immediate synchronous failure callback does not reenter a held map lock.
- Rust removes a sender on callback or 30-second timeout. Late/duplicate callbacks find no entry and are ignored. There is no borrowed callback closure to outlive. However, dropping/cancelling the Rust future before cleanup can leave an entry until a callback arrives; an RAII pending-registration guard would also clean up the no-callback case. Replace `lock().unwrap()` in the FFI callback with a non-panicking policy so a future poisoned-lock change cannot unwind across C.
- The 30-second deadline can expire while a user is still considering the permission prompt. The enable attempt then reports unavailable even if the user grants permission later. A later explicit enable should requery and succeed; test this with synthetic delayed callbacks. Never prompt from refresh.
- A **send timeout is ambiguous**: macOS may accept or even present the notification after Rust rolls back. A subsequent refresh may duplicate it (UUIDs differ). A late callback cannot repair this because its map entry is gone. Document this at-least-once retry tradeoff or represent an indeterminate reservation and reconcile it; do not describe timeout as proof that the OS rejected scheduling. Conversely, a crash after persistence but before submission, or rollback-save failure (`backend.rs:629` ignores the save result), may suppress a retry across restart. Exactly-once visible delivery is not provided.
- Outer `@try` catches synchronous exceptions on the dispatched main block; it does not surround calls made later inside asynchronous permission callbacks. Current callbacks use supported system APIs; no concrete exception was reproduced. If retaining the C boundary, ensure no Objective-C exception can escape an asynchronous block and no error descriptions/userInfo are logged.
- Windows API objects remain within synchronous scopes with no await while held. A missing explicit COM initialization call is **not** asserted as a bug: installed `windows-core 0.62.2/src/imp/factory_cache.rs:87–94` retries activation using `CoIncrementMTAUsage` on `CO_E_NOTINITIALIZED`. Windows execution is still unverified.

## Validation actually performed

Temporary crate: `/private/tmp/codexdeck-notification-review`. It includes the **actual repository** `notification.rs` and `alerts.rs`, compiles the actual `notification_mac.m` using ARC/blocks, and links Foundation/UserNotifications. A minimal `UsageWindow` test fixture uses the repository's same field types (`f64`, `Option<u64>`, `Option<f64>`). It is not a full Tauri/backend build.

`cargo test --offline --manifest-path /private/tmp/codexdeck-notification-review/Cargo.toml` passed **10 tests**: the eight existing notification/alert tests plus two review evidence tests demonstrating N1's Quiet reservation and N2's lost recovery. Those two tests intentionally assert the current defective behavior as evidence; they are not claimed fixes. No OS entry point is called by these tests. Native permission UI, notification submission, notification settings/account data, `.env`, and `.local-data` were never accessed. Windows/Linux compile/runtime and installer behavior were not tested.

Current core dependencies observed in `Cargo.lock`: `cc 1.10.0`, `tokio 1.54.1`, `notify-rust 4.18.2`, `windows 0.62.2`. Core Cargo features already include Windows `UI_Notifications`, `Data_Xml_Dom`, `Foundation`; native macOS uses compiler flags `-fobjc-arc -fblocks` plus Foundation/UserNotifications framework links. **No new dependency or Cargo change is requested by this review.**

Required follow-up tests: native status matrix including unknown enum, authorized/alerts-disabled, style None, provisional, sound disabled/unsupported; denial then later grant while still below threshold; recovery during denial; scheduling explicit error, delayed success, missing callback/cancellation and rollback disk failure; foreground/background presentation; Windows installed identity, blocked setting and asynchronous Failed; Linux missing server, DND/unknown permission and stalled server. Use synthetic service injection for unit tests. Installed-app real notification tests require a separately authorized manual session.

## Primary references checked

- [Apple requestAuthorization](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/requestauthorization(options:completionhandler:)): completion may use a background thread; the granted bool is not granular settings.
- [Apple alertSetting](https://developer.apple.com/documentation/usernotifications/unnotificationsettings/alertsetting): authorization and alert presentation style are separate.
- [Apple scheduling completion](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/add(_:withcompletionhandler:)): nil error acknowledges scheduling and the method may be called from any thread.
- [Apple foreground notification handling](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/SchedulingandHandlingLocalNotifications.html): default foreground suppression and delegate completion options.
- [Microsoft ToastNotification.Failed](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotification.failed): asynchronous failure and prechecking `Setting`.
- [Microsoft desktop toast prerequisites](https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast): installed shortcut/AUMID and event handlers.
- [freedesktop Desktop Notifications specification](https://specifications.freedesktop.org/notification/latest-single/): `Notify`, `GetServerInformation`, capabilities and optional sound hints.

These sources and the installed dependency source establish API contracts, not successful behavior on a user's desktop.
