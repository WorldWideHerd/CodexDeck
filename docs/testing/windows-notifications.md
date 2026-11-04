# Windows notification verification

Use the NSIS `*-setup.exe` produced by `npm run tauri -- build --bundles nsis`
on Windows. A copied executable or `tauri dev` does not have the installed
Start Menu shortcut required by the desktop toast API. Install normally, with
Start Menu shortcuts enabled; if the shortcut was removed, reinstall normally
rather than using `/NS` or update-only mode.

The bundle identifier, process AppUserModelID and toast sender ID must all be
`com.codexdeck.desktop`. Tauri's standard NSIS template sets this ID on the
Start Menu shortcut and manages its registration/uninstall lifecycle. Keep
that template rather than adding a second competing shortcut/registry owner.

## Interactive checks (Windows 10 and Windows 11)

1. Install as the current user and launch from Start Menu. In CodexDeck's
   notification settings, send a test notification. With Windows notifications
   enabled, the request must reach Windows rather than return the generic
   "authorization cannot yet be verified" error. Check the banner, notification
   center and the CodexDeck entry in Settings > System > Notifications.
2. Inspect the installed shortcut's `System.AppUserModel.ID` property; it must
   equal `com.codexdeck.desktop`. Close the app, launch the installed executable
   directly from Explorer, and repeat the test; sender identity must stay the same.
3. Disable CodexDeck notifications in Windows Settings. Recheck permission and
   send a test: the app must report denied and must not enqueue a toast. Re-enable
   notifications and retry without reinstalling.
4. Repeat with global notifications disabled, then restored. Test Focus Assist /
   Do not disturb separately: enqueue success does not guarantee a visible banner.
   Sound cannot be verified by the WinRT setting API, so the app reports that
   limitation even when visual notifications are enabled.
5. Upgrade/reinstall, repeat the test, then uninstall. Check that the installer
   maintains a single working shortcut and removes its registration on uninstall.
   Repeat for any additional install modes used in a release.

Automated Rust tests cover the readiness decision: Windows `Enabled` allows the
first toast, and disabled settings block it. macOS builds do not compile or
exercise the Windows API calls. A passing macOS build is not Windows validation.

## First sender and status-query failures

A failed Windows status query must not make the explicit **Test notification** button unusable: the test attempts a direct toast submission and then checks status again. Normal quota notifications remain blocked while readiness is unknown, and known Windows denials are never treated as permission. An accepted submission is reported as submitted, not as a guarantee that a banner appeared. If status remains unknown after submission, the app keeps **Needs attention** rather than claiming notifications are enabled.

Windows cannot verify per-app sound through this API. That warning is displayed separately from an unknown notification status. Actual status-query and send failures include only a hexadecimal Windows error code, never the raw system error message. Include that code when diagnosing a missing sender. Check that a rejected test changes the app status to **Needs attention**, and that a successful test with unknown sound says **submitted** and **enabled**, without the misleading generic unknown-status message.
