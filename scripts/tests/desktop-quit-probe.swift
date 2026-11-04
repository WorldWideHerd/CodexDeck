import Foundation

@main
struct DesktopQuitProbe {
    @MainActor
    static func main() async throws {
        typealias Identity = OriginalDesktopRuntime.ProcessIdentity
        func process(_ pid: Int32, _ parent: Int32, _ uid: UInt32 = 501) -> Identity {
            Identity(pid: pid, parent: parent, uid: uid, seconds: Int(pid), microseconds: 0)
        }
        let root = process(100, 1)
        let child = process(101, 100)
        let grandchild = process(102, 101)
        let otherAccount = process(200, 1)
        let unrelated = process(201, 200)
        let otherUser = process(103, 100, 502)
        let children = OriginalDesktopRuntime.descendants(of: [100],
            in: [grandchild, unrelated, otherUser, child, otherAccount, root], uid: 501)
        precondition(Set(children.map(\.pid)) == [101, 102], "Only original instance descendants are selected")

        var prompts = 0
        var signals: [Int32] = []
        try await OriginalDesktopRuntime.forceQuitIfNeeded(running: { [] }, confirm: {
            prompts += 1; return true
        }, stop: { signals.append($0.pid) })
        precondition(prompts == 0 && signals.isEmpty, "Normal quit needs no force confirmation")

        do {
            try await OriginalDesktopRuntime.forceQuitIfNeeded(running: { [root, child] }, confirm: {
                prompts += 1; return false
            }, stop: { signals.append($0.pid) })
            preconditionFailure("Cancel must abort account switching")
        } catch DesktopAuthorizationError.cancelled { }
        precondition(prompts == 1 && signals.isEmpty, "Cancel must never send a signal")

        var scans = 0
        try await OriginalDesktopRuntime.forceQuitIfNeeded(running: {
            scans += 1
            switch scans {
            case 1, 2: return [root, child]
            case 3: return [grandchild] // background task survives its parent
            default: return []
            }
        }, confirm: { prompts += 1; return true }, stop: { signals.append($0.pid) })
        precondition(prompts == 2 && Set(signals) == [100, 101, 102], "Approval closes the entire tracked tree")

        do {
            try await OriginalDesktopRuntime.forceQuitIfNeeded(running: { [root] }, confirm: { true }, stop: { _ in
                throw DesktopSwitchError.quit
            })
            preconditionFailure("Signal errors must prevent credential changes")
        } catch DesktopSwitchError.quit { }
        print("Desktop quit checks passed: isolation, normal quit, cancellation, approval, surviving tasks, signal failure")
    }
}
