# Changelog

## 0.0.27

### Fixed
- `sendCustomMessage` now awaits CWI handshake before posting, preventing messages lost in transit
- Removed unused `waitForReady` from `SigmaCWIResult` interface

## 0.0.26

### Added
- `createSigmaCWI()` — Sigma Identity CWI transport extracted from better-auth-plugin into the wallet package
- `createWebCWI()` — now exported alongside existing CWI factory functions
- `SigmaCWIConfig` and `SigmaCWIResult` types

### Fixed
- Lint cleanup across package
