import CryptoKit
import Foundation

enum DesktopProjectCopyError: String, Error {
    case projectsCloseApp, projectsNoAccount, projectsNoSource, projectsChanged, projectsCopyFailed
}

@MainActor
enum DesktopProjectCopy {
    private struct Project: Decodable {
        let id: String
        let name: String
        let rootPaths: [String]

        var key: ProjectKey {
            ProjectKey(name: name.lowercased(), roots: rootPaths.map {
                URL(fileURLWithPath: $0).resolvingSymlinksInPath().standardizedFileURL.path
            }.sorted())
        }

        var foldersExist: Bool {
            !rootPaths.isEmpty && rootPaths.allSatisfy { path in
                var directory: ObjCBool = false
                return path.hasPrefix("/") && FileManager.default.fileExists(atPath: path, isDirectory: &directory)
                    && directory.boolValue
            }
        }
    }

    private struct ProjectKey: Hashable {
        let name: String
        let roots: [String]
    }

    private struct Layout: Decodable {
        var projects: [String: Project] = [:]
        var order: [String] = []
        var pins: [String] = []

        enum CodingKeys: String, CodingKey {
            case projects = "local-projects"
            case order = "project-order"
            case pins = "pinned-project-ids"
        }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            projects = try values.decodeIfPresent([String: Project].self, forKey: .projects) ?? [:]
            order = try values.decodeIfPresent([String].self, forKey: .order) ?? []
            pins = try values.decodeIfPresent([String].self, forKey: .pins) ?? []
        }

        var orderedProjects: [Project] {
            var seen = Set<String>()
            return (order + projects.keys.sorted()).compactMap { id in
                seen.insert(id).inserted ? projects[id] : nil
            }
        }
    }

    private static func read(_ url: URL) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size <= 64 * 1024 * 1024 else {
            throw DesktopProjectCopyError.projectsChanged
        }
        return try Data(contentsOf: url)
    }

    private static func requireClosed(_ runtime: OriginalDesktopRuntime) throws {
        do { try runtime.requireStopped() }
        catch DesktopSwitchError.quit { throw DesktopProjectCopyError.projectsCloseApp }
    }

    // Idempotency keys include the destination owner, so a partial import can be retried
    // without reusing another account's project or creating a second copy.
    private static func projectID(owner: String, sourceID: String) -> String {
        var bytes = Array(SHA256.hash(data: Data("codexdeck:project:\(owner):\(sourceID)".utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x50
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
            .uuidString.lowercased()
    }

    static func copy(runtime: OriginalDesktopRuntime, executable: URL) async throws -> [String: Int] {
        try requireClosed(runtime)
        let home = OriginalDesktopRuntime.home
        let stateURL = home.appendingPathComponent(".codex-global-state.json")
        guard FileManager.default.fileExists(atPath: stateURL.path) else {
            throw DesktopProjectCopyError.projectsNoAccount
        }
        let original = try read(stateURL)
        guard var state = try JSONSerialization.jsonObject(with: original) as? [String: Any],
              let scope = state["electron-account-renderer-state-v1"] as? [String: Any],
              let owner = scope["owner"] as? String, owner.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
        else { throw DesktopProjectCopyError.projectsNoAccount }

        let destination = try JSONDecoder().decode(Layout.self, from: original)
        let inactive = scope["inactive"] as? [String: [String: Any]] ?? [:]
        let sources = try inactive.values.compactMap { account -> (Layout, [String: Any], [String: Any])? in
            guard let globals = account["globals"] as? [String: Any] else { return nil }
            let layout = try JSONDecoder().decode(Layout.self, from: JSONSerialization.data(withJSONObject: globals))
            guard !layout.projects.isEmpty else { return nil }
            return (layout, globals, account["atoms"] as? [String: Any] ?? [:])
        }.sorted { $0.0.projects.count > $1.0.projects.count }
        guard let (source, sourceGlobals, sourceAtoms) = sources.first,
              sources.dropFirst().first?.0.projects.count != source.projects.count else {
            throw DesktopProjectCopyError.projectsNoSource
        }

        var known = Set(destination.projects.values.map(\.key))
        var missing = 0
        let candidates = source.orderedProjects.filter { project in
            guard known.insert(project.key).inserted else { return false }
            guard project.foldersExist else { missing += 1; return false }
            return true
        }
        guard !candidates.isEmpty else { return ["copied": 0, "missing": missing] }

        let backup = home.appendingPathComponent(".codex-global-state.before-codexdeck-copy-\(UUID().uuidString)")
        guard FileManager.default.createFile(atPath: backup.path, contents: original, attributes: [.posixPermissions: 0o600]) else {
            throw DesktopProjectCopyError.projectsCopyFailed
        }
        let rpc = RPCClient(executable: executable, home: home, credentialsStore: nil, experimentalAPI: true)
        defer { rpc.stop() }
        try await rpc.start()
        var projects = state["local-projects"] as? [String: Any] ?? [:]
        var order = destination.order
        var pins = destination.pins
        var appearances = state["project-appearances"] as? [String: Any] ?? [:]
        let sourceAppearances = sourceGlobals["project-appearances"] as? [String: [String: Any]] ?? [:]
        var atoms = state["electron-persisted-atom-state"] as? [String: Any] ?? [:]
        let host = "local:\(home.path)"
        let mapKey = "app-server-project-id-by-legacy-project-id-by-host"
        var maps = state[mapKey] as? [String: [String: String]] ?? [:]
        var mapping = maps[host] ?? [:]
        var imported: [String: String] = [:]

        for candidate in candidates {
            try requireClosed(runtime)
            let id = projectID(owner: owner, sourceID: candidate.id)
            var metadata = ["codex.localProjectId": id]
            if let appearance = sourceAppearances[candidate.id],
               let color = appearance["color"] as? String, let marker = appearance["marker"] {
                metadata["appearance.color"] = color
                let bytes = try JSONSerialization.data(withJSONObject: marker, options: [.fragmentsAllowed])
                metadata["appearance.marker"] = String(decoding: bytes, as: UTF8.self)
                appearances[id] = appearance
            }
            let response = try await rpc.request("project/import", params: [
                "idempotencyKey": id, "name": candidate.name, "metadata": metadata,
                "roots": candidate.rootPaths.map { ["path": $0] }
            ])
            guard let result = try JSONSerialization.jsonObject(with: response) as? [String: Any],
                  let project = result["project"] as? [String: Any],
                  let serverID = project["id"] as? String, !serverID.isEmpty,
                  project["name"] as? String == candidate.name,
                  (project["roots"] as? [[String: String]])?.compactMap({ $0["path"] }) == candidate.rootPaths,
                  let returned = project["metadata"] as? [String: String],
                  metadata.allSatisfy({ returned[$0.key] == $0.value }),
                  let created = project["createdAt"] as? Int64, let updated = project["updatedAt"] as? Int64
            else { throw DesktopProjectCopyError.projectsCopyFailed }
            mapping[id] = serverID
            projects[id] = ["id": id, "name": candidate.name, "rootPaths": candidate.rootPaths,
                            "createdAt": milliseconds(created), "updatedAt": milliseconds(updated)]
            order.append(id)
            imported[candidate.id] = id
            let expanded = "sidebar-project-expanded-v1-codex:"
            atoms[expanded + id] = sourceAtoms[expanded + candidate.id]
        }
        pins.append(contentsOf: source.pins.compactMap { imported[$0] })
        let sidebarOrder = "unified-sidebar-project-order-v1"
        let prefix = "codex:project:"
        let sourceOrder = sourceAtoms[sidebarOrder] as? [String] ?? []
        var targetOrder = atoms[sidebarOrder] as? [String] ?? []
        targetOrder.append(contentsOf: sourceOrder.compactMap { entry in
            guard entry.hasPrefix(prefix), let id = imported[String(entry.dropFirst(prefix.count))] else { return nil }
            return prefix + id
        })
        atoms[sidebarOrder] = targetOrder
        if destination.projects.isEmpty {
            for key in ["sidebar-project-list-expanded-v1", "flat-project-sidebar-preferences-v1"] {
                if let setting = sourceAtoms[key] { atoms[key] = setting }
            }
        }
        state["local-projects"] = projects
        state["project-order"] = order
        state["pinned-project-ids"] = pins
        state["project-appearances"] = appearances
        state["electron-persisted-atom-state"] = atoms
        maps[host] = mapping
        state[mapKey] = maps

        rpc.stop()
        try requireClosed(runtime)
        guard try read(stateURL) == original else { throw DesktopProjectCopyError.projectsChanged }
        try JSONSerialization.data(withJSONObject: state).write(to: stateURL, options: .atomic)
        return ["copied": candidates.count, "missing": missing]
    }

    private static func milliseconds(_ time: Int64) -> Int64 {
        time >= 0 && time < 1_000_000_000_000 ? time * 1000 : time
    }
}
