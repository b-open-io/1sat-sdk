import AppKit
import CoreImage
import CryptoKit
import Foundation
import LocalAuthentication

// MARK: - Secure Enclave Vault (CryptoKit)
//
// This replaces the Security framework approach with CryptoKit, which:
// - Does NOT need keychain-access-groups entitlement
// - Does NOT need an .app bundle or provisioning profile
// - Does NOT need code signing
// - Works from a bare CLI binary compiled with swiftc
//
// Architecture:
//   - SE keys are P-256 KeyAgreement keys stored as opaque dataRepresentation files
//   - The dataRepresentation is encrypted by YOUR specific Secure Enclave hardware
//   - Useless on any other machine — hardware-bound
//   - Encryption: ephemeral ECDH + HKDF + AES-256-GCM
//   - Decryption: SE-internal ECDH + HKDF + AES-256-GCM (private key never leaves chip)
//   - Touch ID: LAContext gates decrypt operations
//
// Storage:
//   ~/.secure-enclave-vault/<label>.key    — SE key dataRepresentation (284 bytes, opaque)
//   ~/.secure-enclave-vault/<label>.pub    — public key (x963, for encryption without SE)

let VAULT_DIR: URL = {
    if let envDir = ProcessInfo.processInfo.environment["SE_VAULT_DIR"] {
        return URL(fileURLWithPath: envDir)
    }
    return FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".secure-enclave-vault")
}()
let HKDF_INFO = Data("se-vault-v1".utf8)

// MARK: - Label Validation

let SAFE_LABEL = try! NSRegularExpression(pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$")

func validateLabel(_ label: String) {
    let range = NSRange(label.startIndex..., in: label)
    if SAFE_LABEL.firstMatch(in: label, range: range) == nil {
        fail("INVALID_LABEL: \"\(label)\" — labels must be 1-63 chars, alphanumeric/hyphens/underscores/dots, starting with alphanumeric.")
    }
}

// MARK: - Error Types

enum SEError: Error, CustomStringConvertible {
    case notAvailable
    case keyNotFound(String)
    case biometryFailed(String)
    case biometryNotAvailable(String)
    case encryptionFailed(String)
    case decryptionFailed(String)
    case invalidData(String)

    var description: String {
        switch self {
        case .notAvailable: return "SECURE_ENCLAVE_NOT_AVAILABLE"
        case .keyNotFound(let l): return "KEY_NOT_FOUND:\(l)"
        case .biometryFailed(let m): return "BIOMETRY_FAILED:\(m)"
        case .biometryNotAvailable(let m): return "BIOMETRY_UNAVAILABLE:\(m)"
        case .encryptionFailed(let m): return "ENCRYPTION_FAILED:\(m)"
        case .decryptionFailed(let m): return "DECRYPTION_FAILED:\(m)"
        case .invalidData(let m): return "INVALID_DATA:\(m)"
        }
    }
}

// MARK: - JSON Output

struct Output: Encodable {
    let success: Bool
    let data: String?
    let error: String?
    let meta: [String: String]?
}

func emit(_ output: Output) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let data = try? encoder.encode(output),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

func ok(data: String? = nil, meta: [String: String]? = nil) {
    emit(Output(success: true, data: data, error: nil, meta: meta))
}

func fail(_ error: String) {
    emit(Output(success: false, data: nil, error: error, meta: nil))
    Foundation.exit(1)
}

// MARK: - File Helpers

func ensureVaultDir() throws {
    try FileManager.default.createDirectory(at: VAULT_DIR, withIntermediateDirectories: true)
    // Set permissions: owner only
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: VAULT_DIR.path
    )
}

func keyPath(_ label: String) -> URL {
    VAULT_DIR.appendingPathComponent("\(label).key")
}

func pubPath(_ label: String) -> URL {
    VAULT_DIR.appendingPathComponent("\(label).pub")
}

func keyExists(_ label: String) -> Bool {
    FileManager.default.fileExists(atPath: keyPath(label).path)
}

// MARK: - Touch ID

func authenticateWithTouchID(reason: String) async throws {
    let context = LAContext()
    context.localizedFallbackTitle = ""
    context.touchIDAuthenticationAllowableReuseDuration = 30

    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
        throw SEError.biometryNotAvailable(error?.localizedDescription ?? "Not available")
    }

    do {
        let success = try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        )
        if !success { throw SEError.biometryFailed("Not successful") }
    } catch let e as LAError {
        switch e.code {
        case .userCancel: throw SEError.biometryFailed("User cancelled")
        case .biometryNotAvailable: throw SEError.biometryNotAvailable("Hardware not available")
        case .biometryNotEnrolled: throw SEError.biometryNotAvailable("Not enrolled")
        default: throw SEError.biometryFailed(e.localizedDescription)
        }
    }
}

// MARK: - Key Management

func generateKey(label: String) throws -> (priv: SecureEnclave.P256.KeyAgreement.PrivateKey, pub: P256.KeyAgreement.PublicKey) {
    try ensureVaultDir()

    let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey()
    let publicKey = privateKey.publicKey

    // Save SE key data representation (opaque, hardware-bound)
    let keyData = privateKey.dataRepresentation
    try keyData.write(to: keyPath(label))
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: keyPath(label).path)

    // Save public key (x963 format, for encryption without needing SE)
    let pubData = publicKey.x963Representation
    try pubData.write(to: pubPath(label))

    return (privateKey, publicKey)
}

func loadPrivateKey(label: String) throws -> SecureEnclave.P256.KeyAgreement.PrivateKey {
    guard keyExists(label) else { throw SEError.keyNotFound(label) }
    let data = try Data(contentsOf: keyPath(label))
    return try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: data)
}

func loadPublicKey(label: String) throws -> P256.KeyAgreement.PublicKey {
    let pubFile = pubPath(label)
    guard FileManager.default.fileExists(atPath: pubFile.path) else {
        throw SEError.keyNotFound(label)
    }
    let data = try Data(contentsOf: pubFile)
    return try P256.KeyAgreement.PublicKey(x963Representation: data)
}

func deleteKey(label: String) throws {
    let fm = FileManager.default
    if fm.fileExists(atPath: keyPath(label).path) {
        try fm.removeItem(at: keyPath(label))
    }
    if fm.fileExists(atPath: pubPath(label).path) {
        try fm.removeItem(at: pubPath(label))
    }
}

func listKeys() throws -> [(label: String, pubKeyHex: String)] {
    try ensureVaultDir()
    let files = try FileManager.default.contentsOfDirectory(atPath: VAULT_DIR.path)
    return files
        .filter { $0.hasSuffix(".key") }
        .compactMap { filename -> (String, String)? in
            let label = String(filename.dropLast(4))
            guard let pubData = try? Data(contentsOf: pubPath(label)) else { return nil }
            let hex = pubData.map { String(format: "%02x", $0) }.joined()
            return (label, hex)
        }
}

// MARK: - Encryption (uses public key only — no SE or Touch ID needed)
//
// Format: ephemeralPub (65 bytes, x963) + nonce (12) + ciphertext + tag (16)
// Total overhead: 65 + 12 + 16 = 93 bytes

func encryptWithPublicKey(publicKey: P256.KeyAgreement.PublicKey, plaintext: String) throws -> Data {
    guard let plaintextData = plaintext.data(using: .utf8) else {
        throw SEError.invalidData("Could not encode plaintext as UTF-8")
    }

    // Generate ephemeral key pair for ECDH
    let ephemeral = P256.KeyAgreement.PrivateKey()

    // ECDH: ephemeral.private + SE.public → shared secret
    let shared = try ephemeral.sharedSecretFromKeyAgreement(with: publicKey)

    // HKDF: shared secret → AES-256 key
    let symmetricKey = shared.hkdfDerivedSymmetricKey(
        using: SHA256.self,
        salt: Data(),
        sharedInfo: HKDF_INFO,
        outputByteCount: 32
    )

    // AES-256-GCM encrypt
    let sealed = try AES.GCM.seal(plaintextData, using: symmetricKey)
    guard let combined = sealed.combined else {
        throw SEError.encryptionFailed("Failed to get combined sealed box")
    }

    // Pack: ephemeral public key (65 bytes) + sealed box (nonce + ciphertext + tag)
    var result = Data()
    result.append(ephemeral.publicKey.x963Representation) // 65 bytes
    result.append(combined) // 12 (nonce) + ciphertext + 16 (tag)
    return result
}

// MARK: - Decryption (uses SE private key — private key NEVER LEAVES the chip)

func decryptWithSEKey(privateKey: SecureEnclave.P256.KeyAgreement.PrivateKey, ciphertext: Data) throws -> String {
    guard ciphertext.count > 65 + 12 + 16 else {
        throw SEError.invalidData("Ciphertext too short")
    }

    // Unpack: ephemeral public key + sealed box
    let ephemeralPubData = ciphertext.prefix(65)
    let sealedData = ciphertext.dropFirst(65)

    let ephemeralPub = try P256.KeyAgreement.PublicKey(x963Representation: ephemeralPubData)

    // ECDH: SE.private + ephemeral.public → shared secret
    // THIS HAPPENS INSIDE THE SECURE ENCLAVE — private key never leaves
    let shared = try privateKey.sharedSecretFromKeyAgreement(with: ephemeralPub)

    // HKDF: same derivation as encryption
    let symmetricKey = shared.hkdfDerivedSymmetricKey(
        using: SHA256.self,
        salt: Data(),
        sharedInfo: HKDF_INFO,
        outputByteCount: 32
    )

    // AES-256-GCM decrypt
    let sealedBox = try AES.GCM.SealedBox(combined: sealedData)
    let decrypted = try AES.GCM.open(sealedBox, using: symmetricKey)

    guard let plaintext = String(data: decrypted, encoding: .utf8) else {
        throw SEError.decryptionFailed("Decrypted data is not valid UTF-8")
    }
    return plaintext
}

// MARK: - Deposit Window

class DepositWindowController: NSObject, NSWindowDelegate {
    let window: NSWindow
    let statusField: NSTextField

    init(address: String, amount: String?) {
        // Generate QR code
        let qrImage = Self.generateQR(from: "bitcoin:\(address)")

        // Window size
        let width: CGFloat = 360
        let height: CGFloat = amount != nil ? 460 : 440

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Deposit BSV"
        window.center()
        window.isReleasedWhenClosed = false
        window.level = .floating

        let content = NSView(frame: NSRect(x: 0, y: 0, width: width, height: height))

        // QR code image
        let imageView = NSImageView(frame: NSRect(x: (width - 200) / 2, y: height - 230, width: 200, height: 200))
        imageView.image = qrImage
        imageView.imageScaling = .scaleProportionallyUpOrDown
        content.addSubview(imageView)

        // Address label
        let addrLabel = NSTextField(wrappingLabelWithString: address)
        addrLabel.frame = NSRect(x: 20, y: height - 270, width: width - 40, height: 30)
        addrLabel.alignment = .center
        addrLabel.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        addrLabel.isSelectable = true
        content.addSubview(addrLabel)

        // Amount label (if provided)
        if let amount = amount {
            let amountLabel = NSTextField(labelWithString: "Estimated cost: \(amount) sats")
            amountLabel.frame = NSRect(x: 20, y: height - 300, width: width - 40, height: 20)
            amountLabel.alignment = .center
            amountLabel.font = NSFont.systemFont(ofSize: 12)
            amountLabel.textColor = .secondaryLabelColor
            content.addSubview(amountLabel)
        }

        // Status field
        statusField = NSTextField(labelWithString: "Waiting for deposit...")
        statusField.frame = NSRect(x: 20, y: 70, width: width - 40, height: 20)
        statusField.alignment = .center
        statusField.font = NSFont.systemFont(ofSize: 12)
        statusField.textColor = .secondaryLabelColor
        content.addSubview(statusField)

        // Copy button
        let copyBtn = NSButton(frame: NSRect(x: (width - 240) / 2, y: 25, width: 110, height: 32))
        copyBtn.title = "Copy Address"
        copyBtn.bezelStyle = .rounded
        copyBtn.target = nil
        copyBtn.action = #selector(Self.copyAddress(_:))
        copyBtn.tag = 1
        content.addSubview(copyBtn)

        // Cancel button
        let cancelBtn = NSButton(frame: NSRect(x: (width - 240) / 2 + 130, y: 25, width: 110, height: 32))
        cancelBtn.title = "Cancel"
        cancelBtn.bezelStyle = .rounded
        cancelBtn.target = nil
        cancelBtn.action = #selector(Self.cancelDeposit(_:))
        content.addSubview(cancelBtn)

        window.contentView = content

        // Store address for copy
        window.representedFilename = address

        super.init()
        window.delegate = self
        copyBtn.target = self
        cancelBtn.target = self
    }

    @objc func copyAddress(_ sender: Any) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(window.representedFilename, forType: .string)
        statusField.stringValue = "Address copied!"
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.statusField.stringValue = "Waiting for deposit..."
        }
    }

    @objc func cancelDeposit(_ sender: Any) {
        NSApplication.shared.terminate(nil)
    }

    func windowWillClose(_ notification: Notification) {
        NSApplication.shared.terminate(nil)
    }

    func show() {
        window.makeKeyAndOrderFront(nil)
    }

    func setFunded() {
        statusField.stringValue = "Deposit received!"
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            NSApplication.shared.terminate(nil)
        }
    }

    static func generateQR(from string: String) -> NSImage {
        let data = string.data(using: .utf8)!
        let filter = CIFilter(name: "CIQRCodeGenerator")!
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")

        let transform = CGAffineTransform(scaleX: 10, y: 10)
        guard let ciImage = filter.outputImage?.transformed(by: transform) else {
            return NSImage(size: NSSize(width: 200, height: 200))
        }

        let rep = NSCIImageRep(ciImage: ciImage)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }
}

func runDepositWindow(address: String, amount: String?) {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)

    let controller = DepositWindowController(address: address, amount: amount)
    controller.show()

    app.activate(ignoringOtherApps: true)

    // Listen for SIGUSR1 to indicate funds received
    signal(SIGUSR1) { _ in
        DispatchQueue.main.async {
            // Print success and exit
            let json = #"{"success":true,"data":"funded"}"#
            FileHandle.standardOutput.write(json.data(using: .utf8)!)
            FileHandle.standardOutput.write("\n".data(using: .utf8)!)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    app.run()

    // If we get here, user cancelled
    let json = #"{"success":false,"error":"User cancelled deposit"}"#
    print(json)
}

// MARK: - Main

@main
struct App {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 2 else {
            fail("Usage: enclave <check|generate|encrypt|decrypt|delete|list> [args...]")
            return
        }

        let command = args[1]

        do {
            switch command {

            case "check":
                let seAvailable = SecureEnclave.isAvailable
                let context = LAContext()
                var error: NSError?
                let bioAvailable = context.canEvaluatePolicy(
                    .deviceOwnerAuthenticationWithBiometrics, error: &error
                )
                let bioType: String
                switch context.biometryType {
                case .touchID: bioType = "TouchID"
                case .faceID: bioType = "FaceID"
                case .opticID: bioType = "OpticID"
                case .none: bioType = "None"
                @unknown default: bioType = "Unknown"
                }

                ok(meta: [
                    "secureEnclave": seAvailable ? "true" : "false",
                    "biometryType": bioType,
                    "biometryAvailable": bioAvailable ? "true" : "false",
                    "vaultDir": VAULT_DIR.path,
                ])

            case "generate":
                guard args.count >= 3 else { fail("Usage: enclave generate <label>"); return }
                guard SecureEnclave.isAvailable else { fail("SECURE_ENCLAVE_NOT_AVAILABLE"); return }

                let label = args[2]
                validateLabel(label)
                let (_, pubKey) = try generateKey(label: label)
                let pubHex = pubKey.x963Representation.map { String(format: "%02x", $0) }.joined()

                ok(data: pubHex, meta: [
                    "label": label,
                    "keyType": "P-256 (secp256r1)",
                    "storage": "SecureEnclave + file",
                    "keyFile": keyPath(label).path,
                ])

            case "encrypt":
                guard args.count >= 3 else { fail("Usage: enclave encrypt <label> (plaintext via stdin)"); return }
                let label = args[2]
                validateLabel(label)
                // Read plaintext from stdin, not CLI args (args visible in ps)
                let plaintext: String
                if args.count >= 4 {
                    plaintext = args[3]
                } else {
                    guard let stdinData = FileHandle.standardInput.availableData as Data?,
                          let stdinStr = String(data: stdinData, encoding: .utf8),
                          !stdinStr.isEmpty else {
                        fail("No plaintext provided. Pipe via stdin or pass as 4th arg."); return
                    }
                    plaintext = stdinStr.trimmingCharacters(in: .newlines)
                }

                // Encryption uses PUBLIC key only — no SE access, no Touch ID
                let pubKey = try loadPublicKey(label: label)
                let encrypted = try encryptWithPublicKey(publicKey: pubKey, plaintext: plaintext)
                let b64 = encrypted.base64EncodedString()

                ok(data: b64, meta: [
                    "label": label,
                    "algorithm": "ECIES (ECDH-P256 + HKDF-SHA256 + AES-256-GCM)",
                    "bytes": "\(encrypted.count)",
                    "touchIdRequired": "false",
                ])

            case "decrypt":
                guard args.count >= 4 else { fail("Usage: enclave decrypt <label> <ciphertext_base64> [app_name]"); return }
                let label = args[2]
                validateLabel(label)
                let b64 = args[3]
                let appName = args.count >= 5 ? args[4] : nil

                guard let ciphertext = Data(base64Encoded: b64) else {
                    fail("Invalid base64 ciphertext"); return
                }

                // Touch ID gate — authenticate before accessing SE key
                let reason = appName != nil
                    ? "\(appName!) wants to access your wallet"
                    : "Unlock key \"\(label)\""
                try await authenticateWithTouchID(reason: reason)

                // Decryption uses SE PRIVATE key — ECDH happens inside the chip
                let privKey = try loadPrivateKey(label: label)
                let plaintext = try decryptWithSEKey(privateKey: privKey, ciphertext: ciphertext)

                ok(data: plaintext, meta: [
                    "label": label,
                    "touchIdRequired": "true",
                    "secureEnclaveUsed": "true",
                ])

            case "delete":
                guard args.count >= 3 else { fail("Usage: enclave delete <label>"); return }
                validateLabel(args[2])
                try deleteKey(label: args[2])
                ok(meta: ["label": args[2]])

            case "list":
                let keys = try listKeys()
                if keys.isEmpty {
                    ok(data: "[]", meta: ["count": "0"])
                } else {
                    let items = keys.map { #"{"label":"\#($0.label)","publicKey":"\#($0.pubKeyHex)"}"# }
                    ok(data: "[\(items.joined(separator: ","))]", meta: ["count": "\(keys.count)"])
                }

            case "deposit":
                guard args.count >= 3 else { fail("Usage: enclave deposit <address> [amount_sats]"); return }
                let address = args[2]
                let amount = args.count >= 4 ? args[3] : nil
                runDepositWindow(address: address, amount: amount)
                // If runDepositWindow returns, user cancelled (exit code handled by NSApp.terminate)
                return

            default:
                fail("Unknown command: \(command). Use: check, generate, encrypt, decrypt, delete, list, deposit")
            }
        } catch {
            fail("\(error)")
        }
    }
}
