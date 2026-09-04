# Changelog

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
