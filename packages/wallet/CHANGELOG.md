# Changelog

## 0.0.61

### Added
- `handleCWIRequest` channel-agnostic receiver core. Validates the action against the `CWIEventName` allowlist and forwards `(params, originator)` to the corresponding `WalletInterface` method.
- `createChromeCWIReceiver`, `createWebCWIReceiver`, `createSigmaCWIReceiver` — wallet-side adapters mirroring the existing senders. Each extracts originator from its channel's trusted source (envelope field for Chrome, `MessageEvent.origin` for iframe).
- Runtime `CWIEventName` allowlist: `CWI_EVENT_NAMES` (frozen Set) and `isCWIEventName` (type guard).
- Shared envelope types: `CWIRequest`, `CWIResponse`, `CWIRequestMessage`, `CWIResponseMessage`. Previously duplicated in `web.ts`, `sigma.ts`, and `@1sat/connect`.

### Changed
- `web.ts` and `sigma.ts` now import `CWIRequestMessage` / `CWIResponseMessage` from `./types` instead of redeclaring them.

## 0.0.58

### Added
- `StorageClientAutoRetryConfig.storage` (optional `WalletStorageManager`). When supplied, after a successful storage payment the wrapper immediately calls `storage.syncToWriter(auth, client)` to re-sync this one backup, instead of waiting for the next `BackupSync` monitor tick. Factory wires this automatically.

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
