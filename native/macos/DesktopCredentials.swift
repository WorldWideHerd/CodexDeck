import CryptoKit
import Foundation
import Security

enum DesktopSwitchError: Error, LocalizedError {
    case unavailable, unsupportedStorage, keychain, invalidAccount, workspace, quit, launch, changed, recovery

    var errorDescription: String? {
        switch self {
        case .unavailable: return storedMessage("اپ اصلی ChatGPT/Codex پیدا نشد؛ نسخهٔ دسکتاپ را در Applications نصب کن.", "The original ChatGPT/Codex app was not found. Install the desktop app in Applications.")
        case .unsupportedStorage: return storedMessage("روش نگهداری اطلاعات ورود این نسخه پشتیبانی نمی‌شود؛ حساب اصلی تغییر نکرد.", "This credential storage configuration is not supported. The original account was not changed.")
        case .keychain: return storedMessage("دسترسی به Keychain ممکن نشد؛ اجازهٔ دسترسی را بررسی کن.", "Could not access Keychain. Check the access permission.")
        case .invalidAccount: return storedMessage("هویت حساب انتخابی تأیید نشد؛ دوباره وارد این حساب شو.", "Could not verify the selected account. Sign in to this account again.")
        case .workspace: return storedMessage("حساب انتخابی با محدودیت ورود یا ورک‌اسپیس اپ اصلی سازگار نیست.", "The selected account does not match the original app’s login or workspace requirements.")
        case .quit: return storedMessage("اپ اصلی بسته نشد یا دوباره باز شد؛ تغییری در ورود آن انجام نشد. کارهای باز را تمام کن و دوباره تلاش کن.", "The original app did not quit, or reopened. Its credentials were not changed. Finish open work and try again.")
        case .launch: return storedMessage("بازکردن اپ اصلی ممکن نشد؛ از Applications دوباره بازش کن.", "Could not reopen the original app. Open it from Applications.")
        case .changed: return storedMessage("حساب اپ اصلی بیرون از ویجت تغییر کرده؛ برای اتصال این کارت دوباره وارد شو.", "The original app’s account changed outside the widget. Sign in to reconnect this card.")
        case .recovery: return storedMessage("بازیابی خودکار کامل نشد؛ با دکمهٔ «بازگردانی حساب قبلی» دوباره تلاش کن. پشتیبان در Keychain حفظ شده است.", "Automatic recovery did not complete. Try Restore previous account. The backup is preserved in Keychain.")
        }
    }
}

enum DesktopAuthMode: String, Codable {
    case file, keyring, auto

    static func configuration(_ data: Data, profile: AccountProfile? = nil) throws -> DesktopAuthMode {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let config = object["config"] as? [String: Any],
              let mode = DesktopAuthMode(rawValue: config["cli_auth_credentials_store"] as? String ?? "file"),
              (config["auth_keyring_backend"] as? String ?? "direct") == "direct" else {
            throw DesktopSwitchError.unsupportedStorage
        }
        if let profile {
            if let method = config["forced_login_method"] as? String, method != "chatgpt" {
                throw DesktopSwitchError.workspace
            }
            let requirement = config["forced_chatgpt_workspace_id"]
            let allowed = (requirement as? String).map { [$0] } ?? requirement as? [String] ?? []
            if !allowed.isEmpty, !allowed.contains(profile.resolvedWorkspaceID ?? profile.workspaceID ?? "") {
                throw DesktopSwitchError.workspace
            }
        }
        return mode
    }
}

/// Only used in memory or in our Keychain item, never in account metadata or logs.
struct DesktopAuthSnapshot: Codable {
    var file: Data?
    var keychain: Data?
    var mode: DesktopAuthMode
    var previousAccountID: UUID?
    var needsRecovery = true

    var credentials: Data? { mode == .file ? file : keychain ?? (mode == .auto ? file : nil) }
}

enum DesktopBackupStatus: Equatable {
    case absent, ready, needsRecovery, needsPermission
}

protocol CredentialKeychain {
    func read(service: String, account: String) throws -> Data?
    func write(_ data: Data?, service: String, account: String) throws
    func backupStatus(service: String, account: String) throws -> DesktopBackupStatus
    func writeBackup(_ data: Data?, needsRecovery: Bool?, service: String, account: String) throws
}

extension CredentialKeychain {
    func backupStatus(service: String, account: String) throws -> DesktopBackupStatus {
        guard let data = try read(service: service, account: account) else { return .absent }
        return try JSONDecoder().decode(DesktopAuthSnapshot.self, from: data).needsRecovery ? .needsRecovery : .ready
    }
    func writeBackup(_ data: Data?, needsRecovery: Bool?, service: String, account: String) throws {
        try write(data, service: service, account: account)
    }
}

struct SystemCredentialKeychain: CredentialKeychain {
    var copyMatching: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = { SecItemCopyMatching($0, $1) }
    private func query(_ service: String, _ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }

    func read(service: String, account: String) throws -> Data? {
        var request = query(service, account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = copyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw CredentialBrokerFailure.keychain(operation: "legacy-read", status: status) }
        guard let data = result as? Data else { throw DesktopSwitchError.keychain }
        return data
    }

    func write(_ data: Data?, service: String, account: String) throws {
        try write(data, service: service, account: account, metadata: nil)
    }

    func writeBackup(_ data: Data?, needsRecovery: Bool?, service: String, account: String) throws {
        let metadata = needsRecovery.map { Data(($0 ? "recovery-v1" : "ready-v1").utf8) }
        try write(data, service: service, account: account, metadata: metadata)
    }

    /// Read only our non-secret state marker, never the saved credentials. Suppress auth UI.
    func backupStatus(service: String, account: String) throws -> DesktopBackupStatus {
        var request = query(service, account)
        request[kSecReturnAttributes as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        request[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        var result: CFTypeRef?
        let status = copyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return .absent }
        if status == errSecInteractionNotAllowed || status == errSecAuthFailed { return .needsPermission }
        guard status == errSecSuccess, let attributes = result as? [String: Any] else { throw DesktopSwitchError.keychain }
        switch attributes[kSecAttrGeneric as String] as? Data {
        case Data("empty-v1".utf8) where service == "Codex Usage Desktop Switch v2": return .absent
        case Data("ready-v1".utf8): return .ready
        case Data("recovery-v1".utf8): return .needsRecovery
        default: return .needsPermission // Old backups must be reviewed once before use.
        }
    }

    func itemExists(service: String, account: String) throws -> Bool {
        var request = query(service, account)
        request[kSecReturnAttributes as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        request[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let status = copyMatching(request as CFDictionary, nil)
        if status == errSecItemNotFound { return false }
        if status == errSecSuccess || status == errSecInteractionNotAllowed || status == errSecAuthFailed { return true }
        throw CredentialBrokerFailure.keychain(operation: "metadata", status: status)
    }

    private func write(_ data: Data?, service: String, account: String, metadata: Data?) throws {
        let request = query(service, account)
        guard let data else {
            let status = SecItemDelete(request as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw DesktopSwitchError.keychain }
            return
        }
        var changes: [String: Any] = [kSecValueData as String: data]
        if let metadata { changes[kSecAttrGeneric as String] = metadata }
        let status = SecItemUpdate(request as CFDictionary, changes as CFDictionary)
        if status == errSecItemNotFound {
            var addition = request
            addition[kSecValueData as String] = data
            if let metadata { addition[kSecAttrGeneric as String] = metadata }
            addition[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw DesktopSwitchError.keychain }
        } else if status != errSecSuccess { throw DesktopSwitchError.keychain }
    }
}

struct DesktopCredentialStore {
    static let authService = "Codex Auth"
    static let backupService = "Codex Usage Desktop Switch"
    let home: URL
    var keychain: any CredentialKeychain = BrokerCredentialKeychain()

    // Matches Codex's direct macOS credential backend. Unsupported backends are rejected.
    static func accountKey(for home: URL) -> String {
        let path = home.resolvingSymlinksInPath().standardizedFileURL.path
        let hash = SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
        return "cli|" + hash.prefix(16)
    }

    func readSource(_ source: URL, expected: AccountProfile) throws -> Data {
        let store = DesktopCredentialStore(home: source, keychain: keychain)
        let file = source.appendingPathComponent("auth.json")
        try store.rejectSymlink(file)
        let data = try Data(contentsOf: file)
        guard Self.matches(data, profile: expected) else { throw DesktopSwitchError.invalidAccount }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return data
    }

    func syncSource(_ source: URL, credentials: Data, expected: AccountProfile) throws {
        guard Self.matches(credentials, profile: expected) else { return }
        let store = DesktopCredentialStore(home: source, keychain: keychain)
        try store.writeFile(credentials)
    }

    func snapshot(mode: DesktopAuthMode, previousAccountID: UUID?) throws -> DesktopAuthSnapshot {
        let file = home.appendingPathComponent("auth.json")
        try rejectSymlink(file)
        let bytes = FileManager.default.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
        let stored = mode == .file ? nil : try keychain.read(service: Self.authService, account: Self.accountKey(for: home))
        return DesktopAuthSnapshot(file: bytes, keychain: stored, mode: mode, previousAccountID: previousAccountID)
    }

    func apply(_ data: Data, mode: DesktopAuthMode) throws {
        if mode == .file { try writeFile(data) }
        else {
            try keychain.write(data, service: Self.authService, account: Self.accountKey(for: home))
            try writeFile(nil)
        }
    }

    func restore(_ snapshot: DesktopAuthSnapshot) throws {
        if snapshot.mode != .file {
            try keychain.write(snapshot.keychain, service: Self.authService, account: Self.accountKey(for: home))
        }
        try writeFile(snapshot.file)
    }

    func backup() throws -> DesktopAuthSnapshot? {
        guard let data = try keychain.read(service: Self.backupService, account: Self.accountKey(for: home)) else { return nil }
        return try JSONDecoder().decode(DesktopAuthSnapshot.self, from: data)
    }

    func backupStatus() throws -> DesktopBackupStatus {
        try keychain.backupStatus(service: Self.backupService, account: Self.accountKey(for: home))
    }

    func saveBackup(_ snapshot: DesktopAuthSnapshot?) throws {
        let data = try snapshot.map { try JSONEncoder().encode($0) }
        try keychain.writeBackup(data, needsRecovery: snapshot?.needsRecovery,
                                service: Self.backupService, account: Self.accountKey(for: home))
    }

    private func rejectSymlink(_ file: URL) throws {
        if (try? file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
            throw DesktopSwitchError.unsupportedStorage
        }
    }

    private func writeFile(_ data: Data?) throws {
        let manager = FileManager.default
        let file = home.appendingPathComponent("auth.json")
        try rejectSymlink(file)
        guard let data else {
            if manager.fileExists(atPath: file.path) { try manager.removeItem(at: file) }
            return
        }
        try manager.createDirectory(at: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = home.appendingPathComponent(".usage-auth-\(UUID().uuidString)")
        defer { try? manager.removeItem(at: temporary) }
        guard manager.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
            throw DesktopSwitchError.unsupportedStorage
        }
        let handle = try FileHandle(forWritingTo: temporary)
        defer { try? handle.close() }
        try handle.write(contentsOf: data)
        try handle.synchronize()
        guard rename(temporary.path, file.path) == 0 else { throw DesktopSwitchError.unsupportedStorage }
    }

    static func matches(_ data: Data, profile: AccountProfile) -> Bool {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["auth_mode"] == nil || json["auth_mode"] as? String == "chatgpt",
              json["OPENAI_API_KEY"] == nil || json["OPENAI_API_KEY"] is NSNull,
              let tokens = json["tokens"] as? [String: Any],
              let access = tokens["access_token"] as? String, !access.isEmpty,
              let refresh = tokens["refresh_token"] as? String, !refresh.isEmpty,
              let id = tokens["id_token"] as? String,
              let claims = tokenClaims(id), let email = claims["email"] as? String,
              let expected = profile.email, email.lowercased() == expected.lowercased() else { return false }
        if let workspace = profile.resolvedWorkspaceID ?? profile.workspaceID {
            let auth = claims["https://api.openai.com/auth"] as? [String: Any]
            return (tokens["account_id"] as? String ?? auth?["chatgpt_account_id"] as? String) == workspace
        }
        return true
    }

    private static func tokenClaims(_ token: String) -> [String: Any]? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var body = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        body += String(repeating: "=", count: (4 - body.count % 4) % 4)
        guard let data = Data(base64Encoded: body) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
