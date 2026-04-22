# Changelog

## [0.0.45] - 2026-04-22

### Changed
- Bump `@1sat/wallet` to 0.0.58 (immediate targeted re-sync after storage payment).

## [0.0.44] - 2026-04-22

### Changed
- Bump `@1sat/wallet` to 0.0.57 (fire-and-forget storage payment on sync 507 to avoid sync-lock deadlock).

## [0.0.43] - 2026-04-22

### Changed
- Bump `@1sat/wallet` to 0.0.56 (storage payment via `/account/payment` 402 flow).

## [0.0.42] - 2026-04-22

### Changed
- Bump `@1sat/wallet` to 0.0.55 (storage-client 507 auto-retry for backup sync).

## [0.0.18] - 2026-03-19

### Fixed
- `connectSigmaWallet` now awaits `sendCustomMessage` to ensure `SET_IDENTITY` is delivered after CWI handshake

## [0.0.13] - 2026-03-18

### Added
- `signRequest(wallet, requestPath, body?, scheme?)` — BRC-77 request signing using any WalletInterface
- `initiateSigmaOAuth(config)` — PKCE OAuth flow to Sigma Identity (redirects browser)
- `completeSigmaOAuth(searchParams, serverCallbackUrl)` — exchange OAuth code for identity
- `isSigmaCallback(searchParams)` — detect Sigma OAuth callback parameters
- `reconnectSigma(config, bapId)` — reconnect to Sigma CWI iframe after OAuth
- `SigmaProviderConfig` type extending WalletProviderConfig with `clientId` and `callbackURL`

### Changed
- Sigma provider factory now initiates OAuth redirect instead of directly creating CWI iframe

## [0.0.12] - 2026-03-18

### Added
- `connectWallet()` — BRC-100 wallet auto-detection with configurable provider fallback chain
- `getAvailableProviders()` — enumerate available wallet providers for selection UI
- `WalletProviderConfig`, `ConnectWalletConfig`, `ConnectWalletResult`, `AvailableProvider` types
- Provider registry supporting `onesat` (1satwallet.com iframe), `sigma` (Sigma Identity), and custom providers
- Auto-detection tries `WalletClient("auto")` first (finds `window.CWI` from Yours Wallet v4 or any BRC-100 extension)

### Fixed
- Lint cleanup

## [0.0.9] - 2026-03-06

### Changed
- Removed `EmbedTransport` and `createEmbedTransport` from public exports (replaced by `createWebCWI` from `@1sat/wallet`)

## [0.0.7] - 2026-02-08

### Fixed
- Guard cross-origin property access in message handlers to prevent `SecurityError` when browsers or extensions dispatch messages from cross-origin Window proxies
- Wrap `event.origin`, `event.data`, `event.source` access in try/catch in `EmbedTransport.handleMessage` and `OneSatBrowserProvider.handleMessage`
- Wrap `iframe.contentWindow` access in new `getIframeWindow()` helper to avoid throwing on cross-origin iframes
- Wrap property access in `isValidMessage()` to handle payloads with throwing getters

## [0.0.6] - 2026-02-07

### Added
- Challenge param for `connect()` enabling single-popup auth (connect + BSM sign in one user gesture)
- CWI transport layer with embed/redirect fallback for BRC-100 wallet operations
