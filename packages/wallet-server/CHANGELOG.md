# Changelog

## Unreleased

### Changed
- The BRC-100 router no longer decides what an app may do. `SENSITIVE_METHODS`, the `approvalPolicy` / `isOriginTrusted` hooks, their `BRC100ApprovalPolicy` / `BRC100ApprovalRequest` / `BRC100TrustCheck` types and the `brc100_sensitive` event are removed, along with the auto-approve path taken when no policy was configured. The router now derives the origin, calls `wallet.call(method, args, origin)` and relays the result; serve a `WalletPermissionsManager` (or `@1sat/wallet`'s `LocalWalletPermissionsManager`) as the wallet so permissions are checked per originator and grant. A permission denial comes back as 400 `{ error }` and is logged through `onEvent` (with the manager's `code` when present).
- The router relays a wallet's error message to the app unchanged. `1sat serve wallet-api` uses that to answer an ungranted call with the `1sat permissions grant …` command that would allow it, so an agent driving an app reads the fix out of the app's own error output instead of waiting on a prompt that never comes.
- New `adminOriginator` router option: a request whose derived origin normalizes to the wallet's admin originator is rejected with 400 before dispatch, so the originator that bypasses permission checks cannot be claimed over HTTP.
- BRC-100 router derives the caller's origin from the `Origin` header only. The `Originator` and `X-1Sat-Origin` fallbacks are removed: browsers set `Origin` and pages cannot change it, while the other two are ordinary headers any page can set. Requests without an `Origin` header (or with the opaque `null`) are rejected with 400. Node clients on the SDK's `HTTPWalletJSON` already send `Origin: http://<originator>`; other local apps set `Origin` the same way.

## 0.0.48

### Changed
- Picks up `@1sat/wallet@0.0.106`.

## 0.0.41

### Fixed
- JSON-RPC responses are serialized with the toolbox's `stringifyJsonRpc` instead of bare `JSON.stringify`/`res.json`. Since wallet-toolbox 2.4.2, storage `createAction` returns `inputBeef` as a `Uint8Array`, which plain JSON renders as `{"0":..,"1":..}`. `StorageClient` cannot decode that back to bytes, so `signAction` threw `Serialized BEEF must start with 4022206465 or 4022206466 but starts with 0` — after `processAction` had already broadcast the transaction. Also affected `sourceTransaction` and the action-batch `inputBeef` fields.
- The `X-BSV-Binary-Encoding` request header is now honored and echoed on the response. Callers that advertise `base64` get tagged binary (~2.6x smaller for a typical BEEF); callers that don't get `number[]`, as before.

## 0.0.13

### Added
- Structured logging via `evlog`. Adds `evlog` as a runtime dependency and installs the `evlog/express` middleware on the Express app, so every request emits one wide event with method, route, status, and duration. Lifecycle events (`server_listening`, `server_shutdown`), dispatch enrichment (rpc method, identityKey, rpc errors), monitor lifecycle (`monitor_starting`, `monitor_started`, `monitor_stopped`), and accounts events (`capacity_exceeded`, `capacity_gate_error`, `auto_internalize_failed`) are all structured. Default destination is stdout (NDJSON), captured by whatever supervisor runs the process. Replaces ad-hoc `console.error` calls in the accounts capacity gate.
