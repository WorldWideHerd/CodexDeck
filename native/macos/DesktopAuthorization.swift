import Foundation
import LocalAuthentication

enum DesktopAuthorizationIntent: Equatable {
    case switchAccount(String), restoreAccount, copyProjects

    var reason: String {
        switch self {
        case .switchAccount(let label):
            let name = String(label.prefix(120))
            return L("ChatGPT بسته می‌شود و با حساب «\(name)» دوباره باز می‌شود.",
                     "ChatGPT will close and reopen using ‘\(name)’.")
        case .restoreAccount:
            return L("حساب قبلی ChatGPT بازگردانی می‌شود و برنامه دوباره باز می‌شود.",
                     "Restore ChatGPT’s previous account and reopen the app.")
        case .copyProjects:
            return L("فهرست پروژه‌های محلی در حساب فعلی Codex کپی می‌شود.",
                     "Copy the local project list into the current Codex account.")
        }
    }
}

enum DesktopAuthorizationError: Error, LocalizedError {
    case cancelled, unavailable, failed

    var errorDescription: String? {
        switch self {
        case .cancelled: return storedMessage("تأیید لغو شد؛ حساب تغییر نکرد.", "Authorization cancelled. The account was not changed.")
        case .unavailable: return storedMessage("تأیید هویت در دسترس نیست؛ تنظیمات Touch ID و رمز ورود مک را بررسی کن.",
                                    "Authentication is unavailable. Check Touch ID and your Mac login password settings.")
        case .failed: return storedMessage("هویت تأیید نشد؛ حساب تغییر نکرد. دوباره تلاش کن.", "Authentication failed. The account was not changed. Try again.")
        }
    }
}

/// The system prompt replaces the existing confirmation, rather than adding an unlock at launch.
/// This authorizes this app's operation; it does not change Codex's independent Keychain ACLs.
@MainActor
final class SystemDesktopAuthorizer {
    private let evaluate: (LAContext, LAPolicy, String) async throws -> Bool

    init(evaluate: @escaping (LAContext, LAPolicy, String) async throws -> Bool = { context, policy, reason in
        try await context.evaluatePolicy(policy, localizedReason: reason)
    }) { self.evaluate = evaluate }

    func authorize(_ intent: DesktopAuthorizationIntent) async throws {
        try Task.checkCancellation()
        let context = LAContext()
        context.localizedCancelTitle = L("انصراف", "Cancel")
        context.localizedFallbackTitle = L("استفاده از رمز مک", "Use Mac password")
        defer { context.invalidate() }
        do {
            // macOS chooses Touch ID when available and offers the Mac password fallback.
            // Do not reuse successful authentication across separate account operations.
            let approved = try await withTaskCancellationHandler {
                try await evaluate(context, .deviceOwnerAuthentication, intent.reason)
            } onCancel: { context.invalidate() }
            try Task.checkCancellation()
            guard approved else { throw DesktopAuthorizationError.failed }
        } catch is CancellationError { throw DesktopAuthorizationError.cancelled }
        catch let error as DesktopAuthorizationError { throw error }
        catch let error as LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel: throw DesktopAuthorizationError.cancelled
            case .passcodeNotSet, .notInteractive: throw DesktopAuthorizationError.unavailable
            default: throw DesktopAuthorizationError.failed
            }
        } catch { throw DesktopAuthorizationError.failed }
    }
}
