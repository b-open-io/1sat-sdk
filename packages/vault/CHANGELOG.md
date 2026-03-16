# Changelog

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
