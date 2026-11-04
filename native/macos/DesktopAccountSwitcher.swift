import AppKit
import Darwin
import Foundation

@MainActor
protocol DesktopApplicationRuntime {
    func checkInstallation() throws
    func quitOriginal() async throws -> Bool
    func requireStopped() throws
    func launchOriginal() async throws
}

/// Targets the original installation and its original data, never our account launchers.
@MainActor
final class OriginalDesktopRuntime: DesktopApplicationRuntime {
    nonisolated static var home: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex") }
    nonisolated static var userData: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Codex")
    }
    private var application: URL {
        for path in ["/Applications/ChatGPT.app", "/Applications/Codex.app"] {
            let url = URL(fileURLWithPath: path)
            if Bundle(url: url)?.bundleIdentifier == "com.openai.codex" { return url }
        }
        return URL(fileURLWithPath: "/Applications/ChatGPT.app")
    }

    func checkInstallation() throws {
        guard Bundle(url: application)?.bundleIdentifier == "com.openai.codex" else { throw DesktopSwitchError.unavailable }
    }

    func executableURL() throws -> URL {
        try checkInstallation()
        for path in ["Contents/Resources/codex-cli/bin/codex", "Contents/Resources/codex"] {
            let url = application.appendingPathComponent(path)
            if FileManager.default.isExecutableFile(atPath: url.path) { return url }
        }
        throw DesktopSwitchError.unavailable
    }

    private func originalProcesses() throws -> [NSRunningApplication] {
        try checkInstallation()
        return try NSWorkspace.shared.runningApplications.filter { app in
            guard app.bundleURL?.standardizedFileURL == application.standardizedFileURL else { return false }
            let values = try Self.processPaths(app.processIdentifier)
            return Self.isOriginal(paths: values, home: Self.home, userData: Self.userData)
        }
    }

    nonisolated static func isOriginal(paths: [String: String], home: URL, userData: URL) -> Bool {
        func same(_ path: String?, _ expected: URL) -> Bool {
            guard let path, !path.isEmpty else { return true }
            return URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL == expected.resolvingSymlinksInPath().standardizedFileURL
        }
        return same(paths["CODEX_HOME"], home) && same(paths["CODEX_ELECTRON_USER_DATA_PATH"], userData)
            && same(paths["--user-data-dir"], userData)
    }

    /// Read only the process's launch paths; no tokens or other environment values are retained.
    static func processPaths(_ pid: pid_t) throws -> [String: String] {
        var query: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&query, u_int(query.count), nil, &size, nil, 0) == 0, size > 4 else { throw DesktopSwitchError.quit }
        var bytes = [UInt8](repeating: 0, count: size)
        let status = bytes.withUnsafeMutableBytes { sysctl(&query, u_int(query.count), $0.baseAddress, &size, nil, 0) }
        guard status == 0 else { throw DesktopSwitchError.quit }
        return try parseProcessPaths(Data(bytes.prefix(size)))
    }

    nonisolated static func parseProcessPaths(_ data: Data) throws -> [String: String] {
        let bytes = Array(data)
        guard bytes.count > 4 else { throw DesktopSwitchError.quit }
        let argc = Int(UInt32(bytes[0]) | UInt32(bytes[1]) << 8 | UInt32(bytes[2]) << 16 | UInt32(bytes[3]) << 24)
        guard argc > 0, argc < 4096 else { throw DesktopSwitchError.quit }
        var offset = 4
        func string() throws -> String {
            guard offset < bytes.count, let end = bytes[offset...].firstIndex(of: 0) else { throw DesktopSwitchError.quit }
            let value = String(decoding: bytes[offset..<end], as: UTF8.self)
            offset = end + 1
            return value
        }
        _ = try string() // executable path, followed by padding
        while offset < bytes.count, bytes[offset] == 0 { offset += 1 }
        var result: [String: String] = [:]
        var nextIsData = false
        for _ in 0..<argc {
            let argument = try string()
            if nextIsData { result["--user-data-dir"] = argument; nextIsData = false }
            else if argument == "--user-data-dir" { nextIsData = true }
            else if argument.hasPrefix("--user-data-dir=") { result["--user-data-dir"] = String(argument.dropFirst(16)) }
        }
        while offset < bytes.count, bytes[offset] != 0 {
            let entry = try string()
            guard let separator = entry.firstIndex(of: "=") else { continue }
            let name = String(entry[..<separator])
            if ["CODEX_HOME", "CODEX_ELECTRON_USER_DATA_PATH"].contains(name) {
                result[name] = String(entry[entry.index(after: separator)...])
            }
        }
        return result
    }

    /// Keep process start times so a recycled PID can never target an unrelated app.
    struct ProcessIdentity: Equatable {
        let pid: pid_t
        let parent: pid_t
        let uid: uid_t
        let seconds: Int
        let microseconds: Int
    }

    nonisolated static func descendants(of roots: Set<pid_t>, in processes: [ProcessIdentity], uid: uid_t) -> [ProcessIdentity] {
        var selected = roots
        var result: [ProcessIdentity] = []
        var added = true
        while added {
            added = false
            for process in processes where process.uid == uid && !selected.contains(process.pid) && selected.contains(process.parent) {
                selected.insert(process.pid)
                result.append(process)
                added = true
            }
        }
        return result
    }

    private static func processTable() throws -> [ProcessIdentity] {
        var query: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
        // The table may grow between sysctl calls. Retry with spare capacity.
        for _ in 0..<3 {
            var size = 0
            guard sysctl(&query, u_int(query.count), nil, &size, nil, 0) == 0 else { throw DesktopSwitchError.quit }
            let stride = MemoryLayout<kinfo_proc>.stride
            var entries = [kinfo_proc](repeating: kinfo_proc(), count: size / stride + 128)
            size = entries.count * stride
            let status = entries.withUnsafeMutableBytes { sysctl(&query, u_int(query.count), $0.baseAddress, &size, nil, 0) }
            if status != 0 { continue }
            return entries.prefix(size / stride).compactMap { entry in
                guard entry.kp_proc.p_stat != SZOMB else { return nil }
                return ProcessIdentity(pid: entry.kp_proc.p_pid, parent: entry.kp_eproc.e_ppid,
                    uid: entry.kp_eproc.e_ucred.cr_uid,
                    seconds: entry.kp_proc.p_starttime.tv_sec, microseconds: Int(entry.kp_proc.p_starttime.tv_usec))
            }
        }
        throw DesktopSwitchError.quit
    }

    private var trackedProcesses: [pid_t: ProcessIdentity] = [:]

    /// Track descendants before asking the app to quit: background tasks can outlive
    /// their parent and become reparented to launchd during a normal quit attempt.
    private func runningOriginalTree() throws -> [ProcessIdentity] {
        let applications = try originalProcesses()
        let table = try Self.processTable()
        let live = Dictionary(uniqueKeysWithValues: table.map { ($0.pid, $0) })
        trackedProcesses = trackedProcesses.filter { pid, identity in
            guard let current = live[pid] else { return false }
            return current.uid == identity.uid && current.seconds == identity.seconds && current.microseconds == identity.microseconds
        }
        let roots = Set(applications.map(\.processIdentifier))
        for process in table where roots.contains(process.pid) && process.uid == getuid() {
            trackedProcesses[process.pid] = process
        }
        for process in Self.descendants(of: Set(trackedProcesses.keys), in: table, uid: getuid()) {
            trackedProcesses[process.pid] = process
        }
        return Array(trackedProcesses.values)
    }

    private func confirmForceQuit() -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = L("بستن اجباری Codex؟", "Force quit Codex?")
        alert.informativeText = L(
            "Codex هنوز باز است یا تسک پس‌زمینه دارد. با ادامه، Codex و همهٔ پردازش‌ها و تسک‌های وابسته به همین نسخه بسته می‌شوند. ممکن است کار ذخیره‌نشده از دست برود. سپس تعویض حساب ادامه پیدا می‌کند.",
            "Codex is still running or has background tasks. Continuing will force close Codex and all processes and tasks belonging to this instance. Unsaved work may be lost. The account operation will then continue.")
        // Cancel is the default; force quit always requires an explicit choice.
        alert.addButton(withTitle: L("انصراف", "Cancel"))
        alert.addButton(withTitle: L("بستن همه و ادامه", "Close all and continue"))
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertSecondButtonReturn
    }

    func quitOriginal() async throws -> Bool {
        let applications = try originalProcesses()
        let wasRunning = try !runningOriginalTree().isEmpty
        for app in applications where !app.isTerminated { _ = app.terminate() }
        let deadline = Date().addingTimeInterval(20)
        while try !runningOriginalTree().isEmpty && Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try await Self.forceQuitIfNeeded(running: { try self.runningOriginalTree() }, confirm: { self.confirmForceQuit() }) { process in
            // Refresh identity immediately before each signal. Never kill by name.
            let current = try Self.processTable().first { $0.pid == process.pid }
            guard let current, current.uid == process.uid,
                  current.seconds == process.seconds, current.microseconds == process.microseconds else { return }
            guard kill(process.pid, SIGKILL) == 0 || errno == ESRCH else { throw DesktopSwitchError.quit }
        }
        try requireStopped()
        return wasRunning
    }

    static func forceQuitIfNeeded(running: () throws -> [ProcessIdentity], confirm: () -> Bool,
                                  stop: (ProcessIdentity) throws -> Void) async throws {
        guard try !running().isEmpty else { return }
        guard confirm() else { throw DesktopAuthorizationError.cancelled }
        let deadline = Date().addingTimeInterval(5)
        while true {
            let processes = try running()
            if processes.isEmpty { return }
            guard Date() < deadline else { throw DesktopSwitchError.quit }
            for process in processes { try stop(process) }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    func requireStopped() throws {
        guard try runningOriginalTree().isEmpty else { throw DesktopSwitchError.quit }
    }

    func launchOriginal() async throws {
        try checkInstallation()
        try requireStopped()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.activates = true
        var environment = ProcessInfo.processInfo.environment
        for name in Array(environment.keys) where name.hasPrefix("CODEX_") || ["OPENAI_API_KEY", "OPENAI_BASE_URL"].contains(name) {
            environment.removeValue(forKey: name)
        }
        // Explicit original paths prevent a widget launched from another account inheriting that account.
        environment["CODEX_HOME"] = Self.home.path
        environment["CODEX_ELECTRON_USER_DATA_PATH"] = Self.userData.path
        configuration.environment = environment
        configuration.arguments = ["--user-data-dir=\(Self.userData.path)"]
        let app: NSRunningApplication = try await withCheckedThrowingContinuation { continuation in
            let attempt = DesktopLaunchAttempt(continuation)
            NSWorkspace.shared.openApplication(at: application, configuration: configuration) { app, _ in
                Task { @MainActor in
                    if let app { attempt.finish(.success(app)) }
                    else { attempt.finish(.failure(DesktopSwitchError.launch)) }
                }
            }
        }
        try await Task.sleep(nanoseconds: 1_000_000_000)
        guard !app.isTerminated,
              Self.isOriginal(paths: try Self.processPaths(app.processIdentifier), home: Self.home, userData: Self.userData) else {
            throw DesktopSwitchError.launch
        }
    }
}

@MainActor
private final class DesktopLaunchAttempt {
    private var continuation: CheckedContinuation<NSRunningApplication, Error>?
    private var timeout: Task<Void, Never>?

    init(_ continuation: CheckedContinuation<NSRunningApplication, Error>) {
        self.continuation = continuation
        timeout = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 20_000_000_000) }
            catch { return }
            self?.finish(.failure(DesktopSwitchError.launch))
        }
    }

    func finish(_ result: Result<NSRunningApplication, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timeout?.cancel()
        timeout = nil
        continuation.resume(with: result)
    }
}

/// Invoked only after the user confirms. Tests substitute the runtime and Keychain.
@MainActor
struct DesktopSwitchTransaction {
    let credentials: DesktopCredentialStore
    let runtime: any DesktopApplicationRuntime

    func execute(mode: DesktopAuthMode, previousAccountID: UUID?,
                 progress: (DesktopSwitchPhase) async -> Void = { _ in },
                 backupChanged: (DesktopBackupStatus) -> Void = { _ in },
                 beforeRecovery: () -> Void = {},
                 target: (DesktopAuthSnapshot) throws -> Data,
                 verify: () async throws -> Void) async throws {
        try runtime.checkInstallation()
        // The marker is saved atomically with the backup. Do not decrypt the previous
        // login just to decide whether a new switch is safe; that can prompt again.
        switch try credentials.backupStatus() {
        case .absent, .ready: break
        case .needsRecovery: throw DesktopSwitchError.recovery
        case .needsPermission: throw DesktopSwitchError.keychain
        }
        var previous: DesktopAuthSnapshot?
        var wasRunning = false
        var changed = false
        do {
            await progress(.quitting)
            wasRunning = try await runtime.quitOriginal()
            await progress(.saving)
            let snapshot = try credentials.snapshot(mode: mode, previousAccountID: previousAccountID)
            let selected = try target(snapshot)
            try credentials.saveBackup(snapshot)
            backupChanged(.needsRecovery)
            previous = snapshot
            try runtime.requireStopped()
            changed = true // A partial storage write must also be rolled back.
            try credentials.apply(selected, mode: mode)
            await progress(.verifying)
            try await verify()
            try runtime.requireStopped()
            await progress(.opening)
            try await runtime.launchOriginal()
            var completed = snapshot
            completed.needsRecovery = false
            try credentials.saveBackup(completed)
            backupChanged(.ready)
        } catch {
            let failure = error
            // A retained verifier must stop before rollback can replace its login.
            beforeRecovery()
            do {
                if changed || wasRunning { await progress(.recovering) }
                if changed, let previous {
                    _ = try await runtime.quitOriginal()
                    try credentials.restore(previous)
                }
                if wasRunning { try await runtime.launchOriginal() }
                if previous != nil { try credentials.saveBackup(nil); backupChanged(.absent) }
            } catch { throw DesktopSwitchError.recovery }
            throw failure
        }
    }

    func restorePrevious(progress: (DesktopSwitchPhase) async -> Void = { _ in },
                         backupChanged: (DesktopBackupStatus) -> Void = { _ in },
                         validate: (DesktopAuthSnapshot) async throws -> Void = { _ in },
                         beforeRestore: (DesktopAuthSnapshot) throws -> Void = { _ in }) async throws -> UUID? {
        guard let backup = try credentials.backup() else { throw DesktopSwitchError.recovery }
        try runtime.checkInstallation()
        try await validate(backup)
        // A failed transaction may already have restored the exact original bytes.
        // Resolve its recovery marker without interrupting an already-correct desktop session.
        let existing = try credentials.snapshot(mode: backup.mode, previousAccountID: nil)
        if existing.file == backup.file, existing.keychain == backup.keychain {
            try credentials.saveBackup(nil)
            backupChanged(.absent)
            return backup.previousAccountID
        }
        await progress(.quitting)
        let wasRunning = try await runtime.quitOriginal()
        try runtime.requireStopped()
        var current: DesktopAuthSnapshot?
        var changed = false
        do {
            await progress(.saving)
            let snapshot = try credentials.snapshot(mode: backup.mode, previousAccountID: nil)
            current = snapshot
            try beforeRestore(snapshot)
            var recovering = backup
            recovering.needsRecovery = true
            try credentials.saveBackup(recovering)
            backupChanged(.needsRecovery)
            changed = true
            try credentials.restore(backup)
            await progress(.opening)
            try await runtime.launchOriginal()
            try credentials.saveBackup(nil)
            backupChanged(.absent)
            return backup.previousAccountID
        } catch {
            let failure = error
            do {
                await progress(.recovering)
                if changed, let current {
                    _ = try await runtime.quitOriginal()
                    try credentials.restore(current)
                }
                if wasRunning { try await runtime.launchOriginal() }
                try credentials.saveBackup(backup)
                backupChanged(backup.needsRecovery ? .needsRecovery : .ready)
            } catch { throw DesktopSwitchError.recovery }
            throw failure
        }
    }
}
