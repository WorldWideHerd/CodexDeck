import Foundation

@objc(CodexDeckCredentialBrokerProtocol)
protocol CredentialBrokerProtocol {
    func read(_ service: String, account: String, reply: @escaping (Data?, Int32) -> Void)
    func write(_ value: Data?, service: String, account: String, marker: Data?, reply: @escaping (Int32) -> Void)
    func ping(_ reply: @escaping (Int32) -> Void)
    func exportAccounts(_ accounts: [String], language: String, reply: @escaping (Data?, Int32) -> Void)
}

enum CredentialBrokerIdentity {
    static let service = "local.codex.usage.credentials"
    static let requirementKey = "CredentialBrokerRequirement"
    static let clientRequirementKey = "AllowedClientRequirement"
    static let maximumBytes = 2 * 1024 * 1024
    static let maximumExportBytes = 32 * 1024 * 1024

    static func accepts(service: String, account: String, marker: Data?) -> Bool {
        guard ["Codex Auth", "Codex Usage Desktop Switch", "Codex Usage Desktop Switch v2"].contains(service), account.utf8.count == 20,
              account.range(of: #"^cli\|[0-9a-f]{16}$"#, options: .regularExpression) != nil else { return false }
        if service == "Codex Auth" { return marker == nil }
        return marker == nil || marker == Data("ready-v1".utf8) || marker == Data("recovery-v1".utf8) || (service == "Codex Usage Desktop Switch v2" && marker == Data("empty-v1".utf8))
    }
}
