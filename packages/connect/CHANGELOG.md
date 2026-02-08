# Changelog

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
