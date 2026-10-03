# Changelog

## 0.0.60

### Changed
- Storage RPC is no longer served by `createHostServer`. New `createStorageServer` runs the `@bsv/wallet-toolbox` `StorageServer` standalone, with `monetize: false`, `maxRpcListLimit` 10,000 and `maxRpcArrayItems` 4,194,304; everything else is the toolbox default.
- `RedisSessionManager` implements the `@bsv/sdk` `AsyncSessionManager`: sessions and nonce claims live only in Redis, so any instance, host or storage server, accepts a session made on another.
- The host's OpenAPI document no longer lists `POST /`.

### Removed
- The accounts capacity gate (`accountsCapacityGate`, `BILLABLE_METHODS`, `isBillableMethod`, `ERR_INSUFFICIENT_CAPACITY`). Storage writes are not metered; `/account/status` and `/account/payment` are unchanged.
- `createWalletServer`, `createWalletRpcHandler`, `createBearerServer`, `bearerResolver`, `dispatch` and their types.
- `wrapAuthWithSessionHydration` and `RedisSessionManager.hydrate`.

## 0.0.59

### Fixed
- `getSyncChunk` responses carry byte fields as base64 when the client asks for binary (toolbox `syncChunkBinary`, as the toolbox StorageServer does). They were JSON number arrays about 3.6× larger, and large pages exceeded the auth layer's signing limit (`ERR_RESPONSE_SIGNING_FAILED`, 500), which stopped toolbox 2.14 sync and Repair Sync.
- Binary-encoded request params (`X-BSV-Binary-Request-Encoding`) are decoded before the capacity gate and dispatch.

### Changed
- Uses upstream `@bsv/auth-express-middleware` ^2.2.8 instead of the `@bopen-io` interim repack (its fix, ts-stack#368, shipped in 2.1.5). Responses over 8 MiB return 413, which toolbox clients answer with smaller sync pages; requests are accepted up to 16 MiB.
- Binary codec and sync validators come from the toolbox's own `storage/remoting` modules; `@bsv/wallet-toolbox-client` is no longer a dependency.

## 0.0.58

### Security
- RPC dispatch only calls the storage methods a toolbox client may call (matching the toolbox `StorageServer` list); previously any storage method, including `dropAllData`, `migrate` and unscoped finds, was callable by any authenticated identity. `migrate` is ignored like `destroy`.
- The `AuthId` argument is rebuilt from the authenticated identity; a client-supplied `userId` or `isActive` is replaced. `findOutputBaskets`, `findProvenTxReqs` and `updateProvenTxReqWithNewProvenTx` are served by their user-scoped `*Auth` methods, and active-storage methods require the user's active storage.
- `processSyncChunk` validates entities and incoming proofs against the chain tracker before merging.
- Request budgets on list limits (max 10,000), offsets, array sizes and `getSyncChunk` size.
- Clients receive only `WalletError` details; other errors are reported as `WERR_INTERNAL`. `DispatchContext.onError` receives the original error (logged as `rpcCause`).

### Changed
- `makeAvailable` / `getSettings` omit a `dbtype` the toolbox client does not accept (StoragePg stores `Postgres`) and advertise `syncCheckpointVersion: 1`.

## 0.0.57

### Changed
- Peer dependencies are upstream `@bsv/wallet-toolbox` and `@bsv/wallet-toolbox-client` ^2.14.4 instead of the `@bopen-io` fork. `stringifyJsonRpc` comes from `@bsv/wallet-toolbox-client`.

### Fixed
- JSON-RPC responses for methods that return nothing (e.g. `destroy`) carry `result: null`. The field was dropped, and toolbox 2.14 clients reject responses without `result` or `error`.

## 0.0.56

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
