import Foundation
import Security
import LocalAuthentication

final class CredentialBroker: NSObject, CredentialBrokerProtocol {
    private let store = BrokerNativeStore()
    func read(_ service: String, account: String, reply: @escaping (Data?, Int32) -> Void) {
        guard CredentialBrokerIdentity.accepts(service: service, account: account, marker: nil) else {
            reply(nil, errSecParam); return
        }
        let (data, status) = store.read(service: service, account: account)
        reply(data, status)
    }
    func write(_ value: Data?, service: String, account: String, marker: Data?, reply: @escaping (Int32) -> Void) {
        guard CredentialBrokerIdentity.accepts(service: service, account: account, marker: marker),
              (value?.count ?? 0) <= CredentialBrokerIdentity.maximumBytes else { reply(errSecParam); return }
        reply(store.write(value, service: service, account: account, marker: marker))
    }
    func ping(_ reply: @escaping (Int32) -> Void) { reply(errSecSuccess) }
    func exportAccounts(_ accounts: [String], language: String, reply: @escaping (Data?, Int32) -> Void) {
        guard accounts.count <= 1000, Set(accounts).count == accounts.count,
              accounts.allSatisfy({ CredentialBrokerIdentity.accepts(service: "Codex Auth", account: $0, marker: nil) }) else { reply(nil, errSecParam); return }
        guard !accounts.isEmpty else { reply(Data("[]".utf8), errSecSuccess); return }
        let context = LAContext()
        let fa = language == "fa"
        context.localizedCancelTitle = fa ? "انصراف" : "Cancel"
        context.localizedFallbackTitle = fa ? "استفاده از رمز مک" : "Use Mac password"
        context.localizedReason = fa ? "اطلاعات ورود حساب‌ها برای ذخیره در فایل خروجی رمزگذاری‌شده خوانده می‌شوند." : "Read account sign-in credentials for your encrypted export."
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: context.localizedReason) { approved, error in
            defer { context.invalidate() }
            guard approved else {
                let cancelled = (error as? LAError).map { [.userCancel, .appCancel, .systemCancel].contains($0.code) } ?? false
                reply(nil, cancelled ? errSecUserCanceled : errSecAuthFailed); return
            }
            let (data, status) = self.store.exportAccounts(accounts, context: context)
            reply(data, status)
        }
    }
}

final class BrokerDelegate: NSObject, NSXPCListenerDelegate {
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard let requirement = Bundle.main.object(forInfoDictionaryKey: CredentialBrokerIdentity.clientRequirementKey) as? String,
              !requirement.isEmpty, connection.effectiveUserIdentifier == getuid() else { return false }
        connection.setCodeSigningRequirement(requirement)
        connection.exportedInterface = NSXPCInterface(with: CredentialBrokerProtocol.self)
        connection.exportedObject = CredentialBroker()
        connection.resume()
        return true
    }
}

let delegate = BrokerDelegate()
let listener = NSXPCListener.service()
listener.delegate = delegate
listener.resume()
