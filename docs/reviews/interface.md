# Reference layout review — 2026-10-28

Rebuilt the React dashboard around the supplied private visual reference: full-width header, original logo, add account control, sort/layout controls, three-column neutral cards, prominent quota percentages, RTL remaining bars, alert control, reset-credit expiry, editable manual subscription row, capability-gated ChatGPT switch button, and fixed refresh/settings/quit footer. The private reference image was not copied into the project.

Account state, login lifecycle, command bridge, native capabilities and Rust implementation remain unchanged. The explicit browser preview now offers six synthetic accounts; the original three-account default fixture remains available to existing tests. No production data, credentials or running app were used during QA.

Validation:
- 30 frontend tests passed; TypeScript, production Vite build and Prettier check passed.
- 23 Rust tests passed with the existing offline toolchain.
- Browser/CUA visual checks: Persian dark cards at the reference logical width (1045), 1080×760 window without horizontal overflow, English light list, settings, and lowest-quota sorting (0, 4, 8, 65, 100, 100).
- Historical screenshots are kept outside the public repository.
- Release bundle built with `npm run tauri -- build --bundles app --config '{"productName":"CodexDeck Visual Review"}'`. The product-name override creates a separate bundle and does not change checked-in native configuration. Output: `src-tauri/target/release/bundle/macos/CodexDeck Visual Review.app` (13.42 MiB).

Differences: unsupported switching remains disabled with a visible explanation, increasing card height slightly. Browser preview has a synthetic-data notice; native UI does not. Dates retain existing Gregorian semantics. Tauri uses its existing system titlebar. This pass did not launch the release app, exercise real login/notifications, or certify Windows/Linux rendering. The user's existing open app and bundle were not replaced.

## Detail parity pass — 2026-10-29

Three parallel agents compared the settings, account popovers and native macOS menus against the Swift implementation. Settings is now a 340px anchored panel with equal-width language/appearance/refresh choices, scrollable sections and a separate quit row. Account actions have the Swift-style compact heading, icon rows and destructive separator; avatar and bell open dedicated color and alert dialogs. Gift details float without changing the card height. Sorting uses a compact choice popover. Footer icons now use gear/power.

The native tray uses a monochrome template icon matching the Swift arcs/bars. Left click toggles a dedicated 330px quota summary; right click offers localized native actions. Native application menus include editing/window actions, refresh, settings and quit. Settings opens the anchored frontend panel through a real native event. Summary positioning uses the icon's monitor/work area, resizes for the current account count and falls back to the dashboard if creating/showing the summary fails. Only the existing local event capability was extended to the new local window; no credentials/storage/authentication behavior changed.

Validation: frontend tests include settings selected states, unavailable services, unknown/stale menu quotas and empty lists. Native Rust tests remain green (23). Browser screenshots cover Persian dark settings, English light settings and account action menu. A separate debug application with identifier `com.codexdeck.visualqa` was launched against a fresh temporary directory containing only synthetic metadata. Its native Persian application menu and Settings action were verified. The debug instance was then stopped; the real app was not closed. The system menu-bar inspection tool timed out, so tray click positioning/focus-loss behavior is implemented but not visually certified. Release output remains the separate `CodexDeck Visual Review.app` bundle.

Remaining differences: Lucide icons approximate SF Symbols rather than reproducing them exactly; native Tauri window chrome/material and OS control rendering differ from SwiftUI. Update and optional diagnostic services retain an explicit unavailable state. Switching remains capability-disabled. This is a closer implementation, not a claim of pixel-perfect/native-behavior identity.
