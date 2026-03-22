# Changelog

## 0.0.1

### Added
- `SecureEnclaveProvider` — implements `VaultProvider` from `@1sat/vault` using Apple CryptoKit Secure Enclave (P-256 ECIES + Touch ID)
- `showDepositWindow(address, amountSats?)` — native macOS window with QR code for receiving BSV deposits
- `signalDepositReceived(pid)` — dismiss deposit window when funds confirmed
- `isMacOS()` / `assertMacOS()` — platform detection utilities
- Swift `enclave` binary compiled via `postinstall` (no code signing or entitlements required)
