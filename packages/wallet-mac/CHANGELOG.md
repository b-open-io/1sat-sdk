# Changelog

## 0.0.5

### Fixed
- `SecureEnclaveProvider` now resolves the `enclave` binary at its npm-installed location (`<package>/swift/enclave`, relative to the module). Previously it only checked `process.argv0/../enclave` and a dev sibling path, so npm consumers (e.g. `bitcoin-backup`, `bsv-bap`) hit "Secure Enclave binary not found" even though the postinstall built it. The missing-binary case now falls back to the canonical package path so the auto-compile step can build it there.

## 0.0.1

### Added
- `SecureEnclaveProvider` — implements `VaultProvider` from `@1sat/vault` using Apple CryptoKit Secure Enclave (P-256 ECIES + Touch ID)
- `showDepositWindow(address, amountSats?)` — native macOS window with QR code for receiving BSV deposits
- `signalDepositReceived(pid)` — dismiss deposit window when funds confirmed
- `isMacOS()` / `assertMacOS()` — platform detection utilities
- Swift `enclave` binary compiled via `postinstall` (no code signing or entitlements required)
