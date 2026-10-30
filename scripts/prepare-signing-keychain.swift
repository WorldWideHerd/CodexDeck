// Build tooling only. This keychain holds a local signing key, never account credentials.
import Foundation
import Security

enum SigningError: Error { case security(OSStatus, Int), arguments }
func check(_ status: OSStatus, line: Int = #line) throws {
    guard status == errSecSuccess else { throw SigningError.security(status, line) }
}

func prepare() throws {
    let args = CommandLine.arguments
    guard args.count == 3 || args.count == 4 else { throw SigningError.arguments }
    let path = args[1]
    let passphrase = try String(contentsOfFile: args[2], encoding: .utf8).trimmingCharacters(in: .newlines)
    let password = Data(passphrase.utf8)
    guard !password.isEmpty else {
        throw SigningError.arguments
    }
    // A build must fail with an explanation instead of unexpectedly prompting for credentials.
    try check(SecKeychainSetUserInteractionAllowed(false))
    var keychain: SecKeychain?
    if FileManager.default.fileExists(atPath: path) {
        try check(SecKeychainOpen(path, &keychain))
    } else {
        guard args.count == 4 else { throw SigningError.arguments }
        var searchList: CFArray?
        try check(SecKeychainCopySearchList(&searchList))
        guard let searchList else { throw SigningError.arguments }
        // Creating a keychain can add it to the user's search list. Always restore that list;
        // this identity is selected explicitly, never installed as a default/trusted root.
        defer { _ = SecKeychainSetSearchList(searchList) }
        try password.withUnsafeBytes {
            try check(SecKeychainCreate(path, UInt32(password.count), $0.baseAddress, false, nil, &keychain))
        }
    }
    guard let keychain else { throw SigningError.arguments }
    try password.withUnsafeBytes {
        try check(SecKeychainUnlock(keychain, UInt32(password.count), $0.baseAddress, true))
    }
    if args.count == 4 {
        var codesign: SecTrustedApplication?
        try check(SecTrustedApplicationCreateFromPath("/usr/bin/codesign", &codesign))
        guard let codesign else { throw SigningError.arguments }
        var access: SecAccess?
        try check(SecAccessCreate("CodexDeck local signing key" as CFString, [codesign] as CFArray, &access))
        guard let access else { throw SigningError.arguments }
        let importPassword = passphrase as CFString
        var parameters = SecItemImportExportKeyParameters()
        parameters.version = UInt32(SEC_KEY_IMPORT_EXPORT_PARAMS_VERSION)
        parameters.passphrase = Unmanaged.passUnretained(importPassword)
        parameters.accessRef = Unmanaged.passUnretained(access)
        let archive = try Data(contentsOf: URL(fileURLWithPath: args[3]))
        var format = SecExternalFormat.formatPKCS12
        var type = SecExternalItemType.itemTypeAggregate
        try withExtendedLifetime((access, importPassword)) {
            try check(SecItemImport(archive as CFData, nil, &format, &type, [], &parameters, keychain, nil))
        }
    }
}

do { try prepare() }
catch {
    // Never log a password, archive contents or private key, including in errors.
    fputs("Could not prepare the isolated local signing keychain: \(error)\n", stderr)
    exit(1)
}
