import Foundation
import Security
import LocalAuthentication

let account = "cli|0123456789abcdef"
let payload = Data("synthetic-credential".utf8)
let marker = Data("recovery-v1".utf8)
var reads = 0
var updates = 0
var additions = 0
let store = BrokerNativeStore(copyMatching: { query, result in
    let query = query as NSDictionary
    precondition(query[kSecAttrService] as? String == "Codex Auth")
    precondition(query[kSecAttrAccount] as? String == account)
    precondition(query[kSecReturnData] as? Bool == true)
    reads += 1
    result?.pointee = payload as CFData
    return errSecSuccess
}, update: { query, attributes in
    let attributes = attributes as NSDictionary
    precondition(attributes[kSecValueData] as? Data == payload)
    precondition(attributes[kSecAttrAccess] == nil, "An update must preserve the existing ACL")
    if (query as NSDictionary)[kSecAttrService] as? String == "Codex Usage Desktop Switch" {
        precondition(attributes[kSecAttrGeneric] as? Data == marker, "Backup state and secret must be updated together")
    }
    updates += 1
    return errSecSuccess
}, add: { _ in additions += 1; return errSecSuccess }, remove: { _ in errSecItemNotFound })
let (data, status) = store.read(service: "Codex Auth", account: account)
precondition(data == payload && status == errSecSuccess && reads == 1)
precondition(store.write(payload, service: "Codex Auth", account: account, marker: nil) == errSecSuccess)
precondition(store.write(payload, service: "Codex Usage Desktop Switch", account: account, marker: marker) == errSecSuccess)
precondition(updates == 2 && additions == 0)
precondition(store.write(nil, service: "Codex Auth", account: account, marker: nil) == errSecSuccess)

let oversized = BrokerNativeStore(copyMatching: { _, result in
    result?.pointee = Data(count: CredentialBrokerIdentity.maximumBytes + 1) as CFData
    return errSecSuccess
})
let rejected = oversized.read(service: "Codex Auth", account: account)
precondition(rejected.0 == nil && rejected.1 == errSecDecode)

let missing = BrokerNativeStore(update: { _, _ in errSecItemNotFound }, add: { query in
    let fields = query as NSDictionary
    precondition(fields[kSecValueData] as? Data == payload)
    precondition(fields[kSecAttrGeneric] as? Data == marker)
    precondition(fields[kSecAttrAccessible] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
    additions += 1
    return errSecSuccess
})
precondition(missing.write(payload, service: "Codex Usage Desktop Switch", account: account, marker: marker) == errSecSuccess)
precondition(additions == 1)
print("PASS: broker read, size limit, ACL preservation, atomic backup marker, creation and deletion. Native calls mocked; no credentials accessed.")

let context = LAContext()
defer { context.invalidate() }
var batchReads = 0
let secondAccount = "cli|fedcba9876543210"
let batchStore = BrokerNativeStore(copyMatching: { query, result in
    let fields = query as NSDictionary
    precondition(fields[kSecUseAuthenticationContext] as? LAContext === context, "All export reads must share the authenticated context")
    precondition(fields[kSecAttrService] as? String == "Codex Auth")
    batchReads += 1
    if fields[kSecAttrAccount] as? String == secondAccount { return errSecItemNotFound }
    result?.pointee = payload as CFData
    return errSecSuccess
})
let batch = batchStore.exportAccounts([account, secondAccount], context: context)
precondition(batch.1 == errSecSuccess && batchReads == 2)
let batchValues = try JSONDecoder().decode([Data?].self, from: batch.0!)
precondition(batchValues.count == 2 && batchValues[0] == payload && batchValues[1] == nil)
for invalid in [[account, account], ["invalid"], Array(repeating: account, count: 1001)] {
    precondition(batchStore.exportAccounts(invalid, context: context).1 == errSecParam)
}
precondition(batchReads == 2, "Invalid requests must never read credentials")
var deniedReads = 0
let denied = BrokerNativeStore(copyMatching: { _, _ in deniedReads += 1; return errSecUserCanceled })
let cancelled = denied.exportAccounts([account, secondAccount], context: context)
precondition(cancelled.0 == nil && cancelled.1 == errSecUserCanceled && deniedReads == 1, "Cancellation must stop the batch without partial output")
print("PASS: shared export context, ordered results, missing accounts, request validation and immediate cancellation. No authentication prompts or real credentials used.")
