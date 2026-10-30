import Foundation
import Security

enum AppCodeIdentity {
    static var restartMessage: String {
        storedMessage("نسخهٔ CodexDeck هنگام اجرا تغییر کرده است؛ برنامه را از منو کامل ببند و دوباره باز کن، سپس ادامه بده.",
                      "CodexDeck changed while it was running. Quit it from the menu and reopen it before continuing.")
    }

    static func isCurrent() -> Bool {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return false }
        return SecCodeCheckValidity(code, [], nil) == errSecSuccess
    }
}
