import Foundation

/// One isolated Codex process per account. Only account-related RPCs are used.
@MainActor
final class RPCClient {
    private let executable: URL
    private let home: URL
    private let credentialsStore: String?
    private let experimentalAPI: Bool
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var buffer = Data()
    private var nextID = 0
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var deadlines: [Int: Task<Void, Never>] = [:]
    var onNotification: ((String, [String: Any]) -> Void)?
    var onExit: (() -> Void)?
    var isRunning: Bool { process?.isRunning == true }

    func matches(executable expectedExecutable: URL, home expectedHome: URL, credentialsStore expectedStore: String?) -> Bool {
        executable.resolvingSymlinksInPath().standardizedFileURL == expectedExecutable.resolvingSymlinksInPath().standardizedFileURL
            && home.resolvingSymlinksInPath().standardizedFileURL == expectedHome.resolvingSymlinksInPath().standardizedFileURL
            && credentialsStore == expectedStore
    }

    init(executable: URL, home: URL, credentialsStore: String? = "file", experimentalAPI: Bool = false) {
        self.executable = executable
        self.home = home
        self.credentialsStore = credentialsStore
        self.experimentalAPI = experimentalAPI
    }

    func start() async throws {
        if isRunning { return }
        let manager = FileManager.default
        try manager.createDirectory(at: home, withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700])
        let worker = Process()
        worker.executableURL = executable
        worker.arguments = ["app-server", "--listen", "stdio://", "-c", "analytics.enabled=false"]
        if let credentialsStore {
            worker.arguments! += ["-c", "cli_auth_credentials_store=\"\(credentialsStore)\""]
        }
        var environment = ProcessInfo.processInfo.environment
        // Never inherit another Codex profile or API/provider authentication.
        for key in ["CODEX_HOME", "CODEX_SQLITE_HOME", "CODEX_API_KEY", "OPENAI_API_KEY",
                    "CODEX_ACCESS_TOKEN", "OPENAI_BASE_URL", "CODEX_ELECTRON_USER_DATA_PATH"] {
            environment.removeValue(forKey: key)
        }
        environment["CODEX_HOME"] = home.path
        worker.environment = environment
        worker.currentDirectoryURL = home
        let stdin = Pipe(), stdout = Pipe()
        worker.standardInput = stdin
        worker.standardOutput = stdout
        // Auth URLs and tokens are deliberately never written to a log.
        worker.standardError = FileHandle.nullDevice
        input = stdin
        output = stdout
        buffer.removeAll()
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            Task { @MainActor [weak self] in self?.receive(bytes) }
        }
        worker.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.process === worker else { return }
                self.failAll(UsageError.message("اتصال متوقف شد؛ دوباره تلاش کن."))
                self.onExit?()
            }
        }
        process = worker
        do {
            try worker.run()
            var params: [String: Any] = [
                "clientInfo": ["name": "codex_usage_widget", "title": "CodexDeck", "version": "1.6.7"]
            ]
            if experimentalAPI { params["capabilities"] = ["experimentalApi": true] }
            _ = try await request("initialize", params: params)
            try write(["method": "initialized"])
        } catch {
            stop()
            throw error
        }
    }

    func request(_ method: String, params: [String: Any]? = nil, timeout: Double = 35) async throws -> Data {
        guard isRunning else { throw UsageError.message("اتصال Codex در دسترس نیست.") }
        nextID += 1
        let id = nextID
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            deadlines[id] = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                self.deadlines.removeValue(forKey: id)
                self.pending.removeValue(forKey: id)?.resume(throwing: UsageError.message("پاسخی نرسید؛ اتصال اینترنت را بررسی کن."))
            }
            var packet: [String: Any] = ["id": id, "method": method]
            if let params { packet["params"] = params }
            do { try write(packet) }
            catch {
                deadlines.removeValue(forKey: id)?.cancel()
                pending.removeValue(forKey: id)?.resume(throwing: error)
            }
        }
    }

    func stop() {
        output?.fileHandleForReading.readabilityHandler = nil
        process?.terminationHandler = nil
        if process?.isRunning == true { process?.terminate() }
        process = nil
        try? input?.fileHandleForWriting.close()
        try? output?.fileHandleForReading.close()
        input = nil
        output = nil
        failAll(UsageError.message("اتصال بسته شد."))
        buffer.removeAll()
    }

    private func write(_ packet: [String: Any]) throws {
        guard let input else { throw UsageError.message("اتصال بسته است.") }
        var bytes = try JSONSerialization.data(withJSONObject: packet)
        bytes.append(0x0a)
        try input.fileHandleForWriting.write(contentsOf: bytes)
    }

    private func receive(_ data: Data) {
        guard !data.isEmpty else { return }
        buffer.append(data)
        guard buffer.count <= 8 * 1024 * 1024 else {
            stop()
            onExit?()
            return
        }
        while let newline = buffer.firstIndex(of: 0x0a) {
            let line = Data(buffer[..<newline])
            buffer.removeSubrange(...newline)
            guard let packet = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if let id = packet["id"] as? Int, let callback = pending.removeValue(forKey: id) {
                deadlines.removeValue(forKey: id)?.cancel()
                if let error = packet["error"] as? [String: Any] {
                    callback.resume(throwing: UsageError.message(Self.safeMessage(error["message"] as? String)))
                } else {
                    do {
                        let result = packet["result"] ?? [:]
                        callback.resume(returning: try JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed]))
                    } catch { callback.resume(throwing: error) }
                }
            } else if let method = packet["method"] as? String {
                // No tools, inference turns, or credential requests are serviced by this client.
                if let id = packet["id"] {
                    try? write(["id": id, "error": ["code": -32601, "message": "Unsupported method"]])
                } else {
                    onNotification?(method, packet["params"] as? [String: Any] ?? [:])
                }
            }
        }
    }

    private func failAll(_ error: Error) {
        let callbacks = Array(pending.values)
        pending.removeAll()
        deadlines.values.forEach { $0.cancel() }
        deadlines.removeAll()
        callbacks.forEach { $0.resume(throwing: error) }
    }

    static func safeMessage(_ message: String?) -> String {
        let text = (message ?? "").lowercased()
        if text.contains("keyring") || text.contains("keychain") || text.contains("credential store") {
            return "دسترسی به Keychain ممکن نشد؛ دسترسی اپ را بررسی کن."
        }
        if text.contains("401") || text.contains("unauthorized") || text.contains("not authenticated") || text.contains("log in") || text.contains("sign in") || text.contains("refresh token") {
            return "ورود منقضی شده؛ دوباره وارد شو."
        }
        if text.contains("403") || text.contains("permission") || text.contains("workspace") {
            return "دسترسی اکانت یا ورک‌اسپیس را بررسی کن."
        }
        if text.contains("429") || text.contains("too many") { return "درخواست‌ها زیاد شده؛ کمی بعد تلاش کن." }
        if text.contains("key") && text.contains("api") { return "با اکانت ChatGPT وارد شو." }
        return "دریافت اطلاعات ممکن نشد؛ اتصال را بررسی کن."
    }
}
