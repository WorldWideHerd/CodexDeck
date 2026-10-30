import Foundation
import Security

guard let requirement = Bundle.main.object(forInfoDictionaryKey: CredentialBrokerIdentity.requirementKey) as? String else { exit(3) }
let connection = NSXPCConnection(serviceName: CredentialBrokerIdentity.service)
connection.remoteObjectInterface = NSXPCInterface(with: CredentialBrokerProtocol.self)
connection.setCodeSigningRequirement(requirement)
connection.resume()
var status: Int32 = errSecNotAvailable
guard let proxy = connection.synchronousRemoteObjectProxyWithErrorHandler({ _ in status = errSecNotAvailable }) as? CredentialBrokerProtocol else { exit(4) }
proxy.ping { status = $0 }
if status == errSecSuccess {
    var rejected: Int32 = 0
    var leaked: Data?
    proxy.read("Unrelated application", account: "cli|0123456789abcdef") { leaked = $0; rejected = $1 }
    guard rejected == errSecParam, leaked == nil else { exit(5) }
    proxy.write(Data(count: CredentialBrokerIdentity.maximumBytes + 1), service: "Codex Auth",
                account: "cli|0123456789abcdef", marker: nil) { rejected = $0 }
    guard rejected == errSecParam else { exit(6) }
    proxy.exportAccounts(["invalid"], language: "en") { leaked = $0; rejected = $1 }
    guard rejected == errSecParam, leaked == nil else { exit(7) }
    proxy.exportAccounts([], language: "en") { leaked = $0; rejected = $1 }
    guard rejected == errSecSuccess, leaked == Data("[]".utf8) else { exit(8) }
}
connection.invalidate()
#if CHANGED
print("Changed client health check:", status)
#else
print("Original client health check:", status)
#endif
exit(status == errSecSuccess ? 0 : 2)
