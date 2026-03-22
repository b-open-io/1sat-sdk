# Changelog

## 0.0.6

### Breaking Changes
- **Provider-based architecture**: `protectSecret`, `unlockSecret`, `removeSecret`, `listSecrets` are no longer direct exports. Use `createVault(provider, storage)` factory instead.
- `configureVault`, `checkAvailability`, `encrypt`, `decrypt`, `generateKey`, `deleteKey`, `listKeys` removed from this package. Use `@1sat/wallet-mac` for macOS Secure Enclave operations.
- `isSupported`, `assertSupported` removed. Platform detection is now the provider's responsibility.
- `showDepositWindow`, `signalDepositReceived` moved to `@1sat/wallet-mac`.

### Added
- `VaultProvider` interface for per-platform implementations
- `VaultStorage` interface for pluggable storage backends
- `FileVaultStorage` — default filesystem-backed storage
- `createVault(provider, storage)` factory function
- `Vault` interface type

### Removed
- All macOS Secure Enclave code (moved to `@1sat/wallet-mac`)
- `HelperResult`, `SEAvailability` types (macOS-specific)

## 0.0.5

### Added
- **Native deposit window**: `showDepositWindow(address, amountSats?)` shows a macOS window with QR code, copyable address, estimated cost, and Copy/Cancel buttons
- `signalDepositReceived(pid)` dismisses the deposit window when funds are confirmed
- App name passed to Touch ID prompt via `decrypt` command — shows "{appName} wants to access your wallet" instead of generic text
- `checkAvailability()` returns SE and biometry status

### Changed
- Touch ID `localizedReason` uses configured app name when available

## 0.0.4

### Added
- `configureVault({ name })` to brand error messages with consumer app name
- `VaultConfig` type exported from package root

### Changed
- All error messages use configurable name prefix instead of hardcoded `@1sat/vault`
- Replaced internal `se-helper` references with `Secure Enclave helper` in user-facing messages

## 0.0.3

### Added
- `SE_VAULT_DIR` environment variable support in Swift binary (matches TypeScript behavior)
- Label validation in Swift binary (generate, encrypt, decrypt, delete commands)
- Comprehensive README with API reference, usage examples, and portability warning

### Fixed
- Full public key hex stored in vault.json and list output (was truncated to 40 chars)
- Swift binary now reads vault directory from `SE_VAULT_DIR` env var instead of hardcoded path

## 0.0.2

### Added
- Auto-compile Swift binary on first use if postinstall was skipped (bun cache workaround)
- Label validation to prevent path traversal attacks
- Plaintext passed via stdin instead of CLI args (not visible in `ps`)
- stderr captured and included in error messages

### Fixed
- Non-null assertions replaced with explicit data checks

## 0.0.1

### Added
- Initial release
- CryptoKit Secure Enclave P-256 key management (no entitlements, no signing needed)
- ECIES encryption (ephemeral ECDH + HKDF-SHA256 + AES-256-GCM)
- Touch ID biometric gating via LAContext
- High-level vault API: `protectSecret`, `unlockSecret`, `removeSecret`, `listSecrets`
- Low-level enclave API: `generateKey`, `encrypt`, `decrypt`, `deleteKey`, `listKeys`
- Platform detection: `isSupported()`, `assertSupported()`
- Configurable vault directory via `SE_VAULT_DIR` env var
