import Foundation
import Security

/// Routine credential access uses the stable broker; explicit legacy recovery authenticates once.
final class CredentialBrokerChannel {
    static let shared = CredentialBrokerChannel()
    private let lock = NSLock()
    private var connection: NSXPCConnection?

    private func proxy(onFailure: @escaping (NSError) -> Void) throws -> CredentialBrokerProtocol {
        if connection == nil {
            guard let requirement = Bundle.main.object(forInfoDictionaryKey: CredentialBrokerIdentity.requirementKey) as? String,
                  !requirement.isEmpty else { throw DesktopSwitchError.keychain }
            let connection = NSXPCConnection(serviceName: CredentialBrokerIdentity.service)
            connection.remoteObjectInterface = NSXPCInterface(with: CredentialBrokerProtocol.self)
            // Kernel-backed peer validation applies to every message, not just a PID lookup.
            connection.setCodeSigningRequirement(requirement)
            connection.resume()
            self.connection = connection
        }
        guard let proxy = connection?.synchronousRemoteObjectProxyWithErrorHandler({ onFailure($0 as NSError) })
            as? CredentialBrokerProtocol else { throw DesktopSwitchError.keychain }
        return proxy
    }

    func read(service: String, account: String) throws -> Data? {
        guard CredentialBrokerIdentity.accepts(service: service, account: account, marker: nil) else { throw DesktopSwitchError.keychain }
        lock.lock(); defer { lock.unlock() }
        var status = errSecNotAvailable
        var value: Data?
        var failure: NSError?
        let proxy = try proxy { failure = $0 }
        proxy.read(service, account: account) { value = $0; status = $1 }
        if failure != nil { connection?.invalidate(); connection = nil }
        if status == errSecItemNotFound && failure == nil { return nil }
        if let failure { throw CredentialBrokerFailure.transport(domain: failure.domain, code: failure.code) }
        guard status == errSecSuccess else { throw CredentialBrokerFailure.keychain(operation: "read", status: status) }
        guard let value,
              value.count <= CredentialBrokerIdentity.maximumBytes else { throw DesktopSwitchError.keychain }
        return value
    }

    func write(_ data: Data?, service: String, account: String, marker: Data?) throws {
        guard (data?.count ?? 0) <= CredentialBrokerIdentity.maximumBytes,
              CredentialBrokerIdentity.accepts(service: service, account: account, marker: marker) else { throw DesktopSwitchError.keychain }
        lock.lock(); defer { lock.unlock() }
        var status = errSecNotAvailable
        var failure: NSError?
        let proxy = try proxy { failure = $0 }
        proxy.write(data, service: service, account: account, marker: marker) { status = $0 }
        if failure != nil { connection?.invalidate(); connection = nil }
        if let failure { throw CredentialBrokerFailure.transport(domain: failure.domain, code: failure.code) }
        guard status == errSecSuccess else { throw CredentialBrokerFailure.keychain(operation: "write", status: status) }
    }

    func exportAccounts(_ accounts: [String], language: String) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        var status = errSecNotAvailable
        var data: Data?
        var failure: NSError?
        let proxy = try proxy { failure = $0 }
        proxy.exportAccounts(accounts, language: language) { data = $0; status = $1 }
        if let failure {
            connection?.invalidate(); connection = nil
            throw CredentialBrokerFailure.transport(domain: failure.domain, code: failure.code)
        }
        guard status == errSecSuccess else { throw CredentialBrokerFailure.keychain(operation: "export", status: status) }
        guard let data, data.count <= CredentialBrokerIdentity.maximumExportBytes else { throw DesktopSwitchError.keychain }
        return data
    }
}

struct BrokerCredentialKeychain: CredentialKeychain {
    private let migratedService = "Codex Usage Desktop Switch v2"
    private let empty = Data("{\"migrationCompleted\":true}".utf8)

    func read(service: String, account: String) throws -> Data? {
        let channel = CredentialBrokerChannel.shared
        guard service == DesktopCredentialStore.backupService else { return try channel.read(service: service, account: account) }
        if let data = try channel.read(service: migratedService, account: account) {
            return data == empty ? nil : data
        }
        let legacy: Data?
        do { legacy = try channel.read(service: service, account: account) }
        catch CredentialBrokerFailure.keychain(operation: _, status: errSecInteractionNotAllowed) {
            // Explicit recovery only. macOS authenticates access to the original item.
            legacy = try SystemCredentialKeychain().read(service: service, account: account)
        }
        guard let legacy else { return nil }
        let snapshot = try JSONDecoder().decode(DesktopAuthSnapshot.self, from: legacy)
        try channel.write(legacy, service: migratedService, account: account,
                          marker: Data((snapshot.needsRecovery ? "recovery-v1" : "ready-v1").utf8))
        guard try channel.read(service: migratedService, account: account) == legacy else { throw DesktopSwitchError.changed }
        return legacy // The original backup remains an untouched archive.
    }
    func write(_ data: Data?, service: String, account: String) throws {
        if service == DesktopCredentialStore.backupService {
            try writeBackup(data, needsRecovery: nil, service: service, account: account)
        } else { try CredentialBrokerChannel.shared.write(data, service: service, account: account, marker: nil) }
    }
    func writeBackup(_ data: Data?, needsRecovery: Bool?, service: String, account: String) throws {
        guard service == DesktopCredentialStore.backupService else { throw DesktopSwitchError.keychain }
        let marker = data == nil ? "empty-v1" : (needsRecovery == false ? "ready-v1" : "recovery-v1")
        // A durable tombstone prevents the retained legacy archive from resurfacing after restore.
        try CredentialBrokerChannel.shared.write(data ?? empty, service: migratedService, account: account, marker: Data(marker.utf8))
    }
    func backupStatus(service: String, account: String) throws -> DesktopBackupStatus {
        let system = SystemCredentialKeychain()
        if try system.itemExists(service: migratedService, account: account) {
            return try system.backupStatus(service: migratedService, account: account)
        }
        return try system.backupStatus(service: service, account: account)
    }
}

/// Carries only public operation/error identifiers; never credential data or paths.
enum CredentialBrokerFailure: Error, LocalizedError {
    case transport(domain: String, code: Int)
    case keychain(operation: String, status: OSStatus)

    var errorDescription: String? {
        switch self {
        case let .transport(domain, code):
            return storedMessage("ارتباط با سرویس امن اطلاعات ورود برقرار نشد", "Could not connect to the credential service") + " (\(domain):\(code))."
        case let .keychain(operation, status):
            let message = status == errSecInteractionNotAllowed
                ? storedMessage("Keychain به تأیید سیستم نیاز دارد، اما سرویس اطلاعات ورود امکان نمایش درخواست را ندارد", "Keychain requires system approval, but the credential service cannot show the request")
                : storedMessage("عملیات Keychain انجام نشد", "Keychain operation failed")
            return message + " (\(operation):\(status))."
        }
    }
}
