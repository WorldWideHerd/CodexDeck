import AppKit
import Foundation
import Security
import Darwin

typealias SwitchCallback = @convention(c) (UInt64, UnsafePointer<CChar>) -> Void

struct SwitchProfile: Decodable {
    let id: UUID
    let label: String
    let email: String?
    let workspaceID: String?
    let resolvedWorkspaceID: String?
    let home: URL
    var account: AccountProfile { AccountProfile(id: id, label: label, email: email, workspaceID: workspaceID, resolvedWorkspaceID: resolvedWorkspaceID) }
}
struct SwitchRequest: Decodable {
    let action: String
    let language: String
    let selectedID: UUID?
    let previousID: UUID?
    let profiles: [SwitchProfile]
}

// Native-only export boundary: secrets never enter the webview. One broker call
// owns the authentication context for the entire export, then invalidates it.
@_cdecl("codexdeck_export_credentials")
func exportCredentials(_ accountsJSON: UnsafePointer<CChar>, _ language: UnsafePointer<CChar>,
                       _ buffer: UnsafeMutablePointer<UInt8>, _ capacity: Int32) -> Int32 {
    guard mainSwitchReady() == 1,
          let accounts = try? JSONDecoder().decode([String].self, from: Data(String(cString: accountsJSON).utf8)) else { return errSecParam }
    do {
        let data = try CredentialBrokerChannel.shared.exportAccounts(accounts, language: String(cString: language))
        guard data.count <= Int(capacity) else { return errSecDataTooLarge }
        data.copyBytes(to: buffer, count: data.count)
        return Int32(data.count)
    } catch CredentialBrokerFailure.keychain(operation: _, status: let status) { return status }
    catch { return errSecNotAvailable }
}

@_cdecl("codexdeck_main_switch_ready")
func mainSwitchReady() -> Int32 {
    guard AppCodeIdentity.isCurrent(),
          let requirement = Bundle.main.object(forInfoDictionaryKey: CredentialBrokerIdentity.requirementKey) as? String,
          !requirement.isEmpty,
          FileManager.default.fileExists(atPath: Bundle.main.bundleURL.appendingPathComponent("Contents/XPCServices/CodexDeckCredentials.xpc").path)
    else { return 0 }
    return 1
}

// Read-only packaged-binary health check. Never reads credentials or requests authentication.
@_cdecl("codexdeck_main_switch_probe")
func mainSwitchProbe() -> Int32 {
    guard mainSwitchReady() == 1,
          let requirement = Bundle.main.object(forInfoDictionaryKey: CredentialBrokerIdentity.requirementKey) as? String else { return 3 }
    let connection = NSXPCConnection(serviceName: CredentialBrokerIdentity.service)
    connection.remoteObjectInterface = NSXPCInterface(with: CredentialBrokerProtocol.self)
    connection.setCodeSigningRequirement(requirement)
    connection.resume()
    defer { connection.invalidate() }
    var status: Int32 = errSecNotAvailable
    guard let proxy = connection.synchronousRemoteObjectProxyWithErrorHandler({ _ in status = errSecNotAvailable }) as? CredentialBrokerProtocol else { return 4 }
    proxy.ping { status = $0 }
    return status == errSecSuccess ? 0 : 2
}

@_cdecl("codexdeck_main_switch_status")
func mainSwitchStatus() -> Int32 {
    guard mainSwitchReady() == 1 else { return 3 }
    do {
        switch try DesktopCredentialStore(home: OriginalDesktopRuntime.home).backupStatus() {
        case .absent, .ready: return 0
        case .needsRecovery: return 1
        case .needsPermission: return 2
        }
    } catch { return 2 }
}

@_cdecl("codexdeck_main_switch_request")
func mainSwitchRequest(_ request: UnsafePointer<CChar>, _ key: UInt64, _ callback: @escaping SwitchCallback) {
    let bytes = Data(String(cString: request).utf8)
    Task { @MainActor in await MainAccountSwitch.shared.run(bytes, key: key, callback: callback) }
}

@MainActor
final class MainAccountSwitch {
    static let shared = MainAccountSwitch()
    private var busy = false

    private func emit(_ value: [String: Any], key: UInt64, callback: SwitchCallback) {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
        text.withCString { callback(key, $0) }
    }
    private func stage(_ phase: DesktopSwitchPhase, key: UInt64, callback: SwitchCallback) {
        let name: String
        switch phase {
        case .authorizing: name = "authorizing"
        case .checkingAccount: name = "checkingAccount"
        case .checkingApp: name = "checkingApp"
        case .quitting: name = "quitting"
        case .saving: name = "saving"
        case .verifying: name = "verifying"
        case .opening: name = "opening"
        case .recovering: name = "recovering"
        case .authorizingProjectCopy: name = "authorizingProjectCopy"
        case .copyingProjects: name = "copyingProjects"
        }
        emit(["phase": name], key: key, callback: callback)
    }

    private func verifiedRuntime() throws -> (OriginalDesktopRuntime, URL) {
        let runtime = OriginalDesktopRuntime()
        let executable = try runtime.executableURL()
        guard let boundary = executable.path.range(of: ".app/Contents/") else { throw DesktopSwitchError.unavailable }
        let app = URL(fileURLWithPath: String(executable.path[..<boundary.lowerBound]) + ".app")
        var code: SecStaticCode?, requirement: SecRequirement?
        let rule = "anchor apple generic and identifier \"com.openai.codex\" and certificate leaf[subject.OU] = \"2DC432GLL2\""
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let code,
              SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess, let requirement,
              SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw DesktopSwitchError.unavailable }
        return (runtime, executable)
    }

    private func configuration(_ executable: URL, profile: AccountProfile? = nil) async throws -> DesktopAuthMode {
        let reader = RPCClient(executable: executable, home: OriginalDesktopRuntime.home, credentialsStore: nil)
        defer { reader.stop() }
        try await reader.start()
        return try DesktopAuthMode.configuration(await reader.request("config/read", params: ["includeLayers": false]), profile: profile)
    }
    private func verify(_ reader: RPCClient, account: AccountProfile) async throws {
        try await reader.start()
        let data = try await reader.request("account/read", params: ["refreshToken": false])
        guard let identity = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = identity["account"] as? [String: Any], value["type"] as? String == "chatgpt",
              let email = value["email"] as? String, email.lowercased() == account.email?.lowercased() else { throw DesktopSwitchError.invalidAccount }
        if let expected = account.resolvedWorkspaceID ?? account.workspaceID,
           let routing = identity["workspaceRouting"] as? [String: Any],
           let actual = routing["chatgptAccountId"] as? String, actual != expected { throw DesktopSwitchError.workspace }
    }
    // Sync only a known matching account. Never overwrite an unrelated card's login.
    private func sync(_ snapshot: DesktopAuthSnapshot, profiles: [SwitchProfile], storage: DesktopCredentialStore) throws {
        guard let current = snapshot.credentials else { return }
        if let profile = profiles.first(where: { DesktopCredentialStore.matches(current, profile: $0.account) }) {
            try storage.syncSource(profile.home, credentials: current, expected: profile.account)
        }
    }
    private func errorCode(_ error: Error) -> String {
        if let error = error as? DesktopProjectCopyError { return error.rawValue }
        if let error = error as? DesktopAuthorizationError {
            switch error { case .cancelled: return "desktopCancelled"; case .unavailable: return "desktopAuthorization"; case .failed: return "desktopAuthorization" }
        }
        if let error = error as? DesktopSwitchError {
            switch error {
            case .unavailable: return "desktopMissing"
            case .unsupportedStorage: return "desktopStorage"
            case .keychain: return "credentialStore"
            case .invalidAccount: return "desktopNeedsLogin"
            case .workspace: return "workspaceMismatch"
            case .quit: return "desktopQuit"
            case .launch: return "desktopLaunch"
            case .changed: return "desktopChanged"
            case .recovery: return "desktopRecovery"
            }
        }
        if let error = error as? CredentialBrokerFailure {
            switch error { case .transport: return "desktopBroker"; case .keychain: return "credentialStore" }
        }
        return "desktopVerification"
    }
    func run(_ data: Data, key: UInt64, callback: @escaping SwitchCallback) async {
        guard !busy else { emit(["done": true, "error": "desktopBusy"], key: key, callback: callback); return }
        guard data.count <= 1024 * 1024, let request = try? JSONDecoder().decode(SwitchRequest.self, from: data),
              ["switch", "restore", "copyProjects"].contains(request.action), mainSwitchReady() == 1 else {
            emit(["done": true, "error": "desktopBroker"], key: key, callback: callback); return
        }
        busy = true
        defer { busy = false }
        setSwitchLanguage(request.language)
        var verifier: RPCClient?
        defer { verifier?.stop() }
        // The previous Swift widget uses the same original login and backup. Keep one owner.
        guard NSRunningApplication.runningApplications(withBundleIdentifier: "local.codex.usage").isEmpty else {
            emit(["done": true, "error": "desktopOtherWidget"], key: key, callback: callback); return
        }
        do {
            guard AppCodeIdentity.isCurrent() else { throw DesktopSwitchError.changed }
            let (runtime, executable) = try verifiedRuntime()
            stage(request.action == "copyProjects" ? .authorizingProjectCopy : .authorizing,
                  key: key, callback: callback)
            let selected = request.profiles.first(where: { $0.id == request.selectedID })
            if request.action == "switch" && selected == nil { throw DesktopSwitchError.invalidAccount }
            let intent: DesktopAuthorizationIntent
            switch request.action {
            case "switch": intent = .switchAccount(selected!.label)
            case "copyProjects": intent = .copyProjects
            default: intent = .restoreAccount
            }
            try await SystemDesktopAuthorizer().authorize(intent)
            guard AppCodeIdentity.isCurrent() else { throw DesktopSwitchError.changed }
            // Kernel lock also serializes a second signed client/process of this integration.
            let lockPath = FileManager.default.temporaryDirectory.appendingPathComponent("codexdeck-main-switch-\(getuid()).lock").path
            let fd = Darwin.open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard fd >= 0 else { throw DesktopSwitchError.keychain }
            defer { flock(fd, LOCK_UN); close(fd) }
            guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
                emit(["done": true, "error": "desktopBusy"], key: key, callback: callback); return
            }
            if request.action == "copyProjects" {
                stage(.copyingProjects, key: key, callback: callback)
                let report = try await DesktopProjectCopy.copy(runtime: runtime, executable: executable)
                emit(["done": true, "projectReport": report], key: key, callback: callback)
                return
            }
            stage(.checkingApp, key: key, callback: callback)
            let storage = DesktopCredentialStore(home: OriginalDesktopRuntime.home)
            if request.action == "restore", try storage.backupStatus() == .absent {
                emit(["done": true, "error": "desktopNoBackup"], key: key, callback: callback); return
            }
            let transaction = DesktopSwitchTransaction(credentials: storage, runtime: runtime)
            var activeID: UUID?
            if let selected, request.action == "switch" {
                // Review legacy backup markers after the explicit system authorization.
                if try storage.backupStatus() == .needsPermission {
                    if let backup = try storage.backup() { try storage.saveBackup(backup) }
                }
                let mode = try await configuration(executable, profile: selected.account)
                try await transaction.execute(mode: mode, previousAccountID: request.previousID,
                    progress: { self.stage($0, key: key, callback: callback) },
                    beforeRecovery: { verifier?.stop(); verifier = nil },
                    target: { snapshot in
                        try self.sync(snapshot, profiles: request.profiles, storage: storage)
                        if let current = snapshot.credentials, DesktopCredentialStore.matches(current, profile: selected.account) { return current }
                        return try storage.readSource(selected.home, expected: selected.account)
                    }, verify: {
                        let reader = RPCClient(executable: executable, home: OriginalDesktopRuntime.home, credentialsStore: nil)
                        verifier = reader
                        try await self.verify(reader, account: selected.account)
                    })
                activeID = selected.id
            } else {
                var restoredCredentials: Data?
                _ = try await transaction.restorePrevious(
                    progress: { self.stage($0, key: key, callback: callback) },
                    validate: { backup in
                        let mode = try await self.configuration(executable)
                        guard mode == backup.mode else { throw DesktopSwitchError.unsupportedStorage }
                        restoredCredentials = backup.credentials
                    }, beforeRestore: { current in try self.sync(current, profiles: request.profiles, storage: storage) })
                if let restoredCredentials {
                    activeID = request.profiles.first(where: { DesktopCredentialStore.matches(restoredCredentials, profile: $0.account) })?.id
                }
            }
            verifier?.stop(); verifier = nil
            emit(["done": true, "activeId": activeID?.uuidString.lowercased() as Any? ?? NSNull()], key: key, callback: callback)
        } catch {
            let code = errorCode(error)
            emit(["done": true, "error": request.action == "copyProjects" && code == "desktopVerification"
                  ? "projectsCopyFailed" : code], key: key, callback: callback)
        }
    }
}
