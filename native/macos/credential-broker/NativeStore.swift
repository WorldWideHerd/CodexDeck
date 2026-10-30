import CryptoKit
import Foundation
import Security
import LocalAuthentication

struct BrokerNativeStore {
    var copyMatching: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = { SecItemCopyMatching($0, $1) }
    var update: (CFDictionary, CFDictionary) -> OSStatus = { SecItemUpdate($0, $1) }
    var add: (CFDictionary) -> OSStatus = { SecItemAdd($0, nil) }
    var remove: (CFDictionary) -> OSStatus = { SecItemDelete($0) }
    private func query(service: String, account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }

    func read(service: String, account: String, context: LAContext? = nil) -> (Data?, OSStatus) {
        var query = query(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        if let context { query[kSecUseAuthenticationContext as String] = context }
        var result: CFTypeRef?
        let status = copyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return (nil, status) }
        guard let data = result as? Data, data.count <= CredentialBrokerIdentity.maximumBytes else { return (nil, errSecDecode) }
        return (data, errSecSuccess)
    }

    func exportAccounts(_ accounts: [String], context: LAContext) -> (Data?, OSStatus) {
        guard accounts.count <= 1000, Set(accounts).count == accounts.count,
              accounts.allSatisfy({ CredentialBrokerIdentity.accepts(service: "Codex Auth", account: $0, marker: nil) }) else { return (nil, errSecParam) }
        var values: [Data?] = []
        var total = 0
        for account in accounts {
            let (data, status) = read(service: "Codex Auth", account: account, context: context)
            guard status == errSecSuccess || status == errSecItemNotFound else { return (nil, status) }
            total += data?.count ?? 0
            guard total <= CredentialBrokerIdentity.maximumExportBytes / 4 * 3 else { return (nil, errSecDataTooLarge) }
            values.append(data)
        }
        guard let encoded = try? JSONEncoder().encode(values), encoded.count <= CredentialBrokerIdentity.maximumExportBytes else { return (nil, errSecDataTooLarge) }
        return (encoded, errSecSuccess)
    }

    func write(_ data: Data?, service: String, account: String, marker: Data?) -> OSStatus {
        let query = query(service: service, account: account)
        guard let data else {
            let status = remove(query as CFDictionary)
            return status == errSecItemNotFound ? errSecSuccess : status
        }
        var changes: [String: Any] = [kSecValueData as String: data]
        if let marker { changes[kSecAttrGeneric as String] = marker }
        let status = update(query as CFDictionary, changes as CFDictionary)
        guard status == errSecItemNotFound else { return status } // Preserve all existing ACLs.
        var addition = query.merging(changes) { _, new in new }
        addition[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        if service == "Codex Auth" || service == "Codex Usage Desktop Switch v2" {
            // New shared login items must also be readable by the signed app that uses them.
            // Only newly created items receive this policy; existing user permissions stay intact.
            let (access, status) = newCredentialAccess(account: account, shared: service == "Codex Auth")
            guard status == errSecSuccess, let access else { return status }
            addition[kSecAttrAccess as String] = access
        }
        return add(addition as CFDictionary)
    }

    private func newCredentialAccess(account: String, shared: Bool) -> (SecAccess?, OSStatus) {
        var own: SecTrustedApplication?
        var status = SecTrustedApplicationCreateFromPath(nil, &own)
        guard status == errSecSuccess, let own else { return (nil, status) }
        var apps = [own]
        let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").resolvingSymlinksInPath().path
        let original = "cli|" + SHA256.hash(data: Data(home.utf8)).map { String(format: "%02x", $0) }.joined().prefix(16)
        for path in shared ? ["/Applications/ChatGPT.app", "/Applications/Codex.app"] : [] {
            let app = URL(fileURLWithPath: path)
            guard Bundle(url: app)?.bundleIdentifier == "com.openai.codex" else { continue }
            if account == original, let trusted = trustedOpenAI(app, identifier: "com.openai.codex") { apps.append(trusted) }
            let cli = app.appendingPathComponent("Contents/Resources/codex-cli/CodexCLI.app")
            if let trusted = trustedOpenAI(cli, identifier: "codex") { apps.append(trusted) }
            break
        }
        var access: SecAccess?
        status = SecAccessCreate((shared ? "Codex Auth" : "CodexDeck recovery backup") as CFString, apps as CFArray, &access)
        return (access, status)
    }

    private func trustedOpenAI(_ url: URL, identifier: String) -> SecTrustedApplication? {
        var code: SecStaticCode?, requirement: SecRequirement?
        let rule = "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"2DC432GLL2\""
        guard SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess,
              SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess else { return nil }
        var trusted: SecTrustedApplication?
        guard SecTrustedApplicationCreateFromPath(url.path, &trusted) == errSecSuccess else { return nil }
        return trusted
    }
}
