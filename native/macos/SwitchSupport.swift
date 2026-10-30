import Foundation

// Minimal adapter types for the unchanged, tested Swift desktop-switch implementation.
struct AccountProfile: Codable {
    var id: UUID
    var label: String
    var email: String?
    var workspaceID: String?
    var resolvedWorkspaceID: String?
}
enum UsageError: Error { case message(String) }
private var switchLanguage = "en"
func setSwitchLanguage(_ value: String) { switchLanguage = value }
func L(_ fa: String, _ en: String) -> String { switchLanguage == "fa" ? fa : en }
func storedMessage(_ fa: String, _ en: String) -> String { L(fa, en) }
