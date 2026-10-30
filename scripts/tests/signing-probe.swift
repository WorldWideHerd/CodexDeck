// Synthetic credentials in a temporary keychain only; used by verify-local-signing.py.
import Foundation
import Security

func check(_ status: OSStatus) {
    guard status == errSecSuccess else {
        fputs("Synthetic keychain operation failed: \(status)\n", stderr)
        exit(1)
    }
}
check(SecKeychainSetUserInteractionAllowed(false))
let args = CommandLine.arguments
let password = try Data(contentsOf: URL(fileURLWithPath: args[2]))
var keychain: SecKeychain?
if args[3] == "create" {
    var list: CFArray?
    check(SecKeychainCopySearchList(&list))
    guard let list else { exit(1) }
    password.withUnsafeBytes {
        check(SecKeychainCreate(args[1], UInt32(password.count), $0.baseAddress, false, nil, &keychain))
    }
    check(SecKeychainSetSearchList(list))
} else {
    check(SecKeychainOpen(args[1], &keychain))
}
guard let keychain else { exit(1) }
password.withUnsafeBytes { check(SecKeychainUnlock(keychain, UInt32(password.count), $0.baseAddress, true)) }
var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "CodexDeck synthetic signing continuity test",
    kSecAttrAccount as String: "synthetic", kSecAttrSynchronizable as String: false]
let synthetic = Data("synthetic-only-no-account-data".utf8)
if args[3] == "create" {
    query[kSecUseKeychain as String] = keychain
    query[kSecValueData as String] = synthetic
    check(SecItemAdd(query as CFDictionary, nil))
} else {
    query[kSecMatchSearchList as String] = [keychain]
    query[kSecReturnData as String] = true
    query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if args[3] == "deny" {
        guard [errSecInteractionNotAllowed, errSecAuthFailed].contains(status), result == nil else { exit(1) }
    } else {
        check(status)
        guard result as? Data == synthetic else { exit(1) }
    }
}
check(SecKeychainLock(keychain))
#if CHANGED
print("Changed binary passed.")
#else
print("Original binary passed.")
#endif
