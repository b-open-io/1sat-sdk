# Changelog

## [0.0.4] - 2026-02-05

### Changed
- **Breaking:** `OwnerClient.getTxos()` converted from JSON request (`Promise<IndexedOutput[]>`) to SSE stream returning an unsubscribe function. Streams sync progress events before delivering TXO results individually.

### Added
- `getTxos()` now accepts `onSync`, `onTxo`, `onDone`, `onError` callbacks for real-time sync progress and streamed results
- `getTxosIterator()` async generator yielding typed `TxoStreamEvent` discriminated union events
- `TxoStreamEvent` exported type for typed event handling
- `Last-Event-ID` support for reconnection without re-syncing
