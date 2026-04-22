# Changelog

## 0.0.57

### Changed
- `installStorageClientPaymentAutoRetry`: on 507, fire the payment fire-and-forget via `setTimeout(0)` and re-throw the original error. No more inline retry of the sync op. Eliminates the deadlock that occurred when `wallet.createAction` (invoked by AuthFetch's 402 handler) tried to acquire the writer lock already held by `WalletStorageManager.runAsSync`. Next sync cycle succeeds after the deferred payment completes.

## 0.0.56

### Changed
- `installStorageClientPaymentAutoRetry` now delivers the storage payment via `POST {endpointUrl}/account/payment`. The server's 402 response drives `AuthFetch`'s built-in payment handling, removing the in-band `/account/status` + `buildAndBroadcastPayment` step. Config simplified to `{ client, wallet }`.

## 0.0.55

### Added
- `installStorageClientPaymentAutoRetry` — wraps `processSyncChunk` on a StorageClient with the same 507 auto-retry pattern as the wallet-level installer, so backup-sync writes can trigger the storage payment flow when the remote is over capacity.

### Changed
- `factory.ts` captures the unwrapped `wallet.createAction` and installs the storage-client retry wrapper on every connected remote (active and backup).

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
