# Changelog

## Unreleased

### Documentation
- Added a collection-overlay skill covering the shipped SIGMA admission rules,
  topics, optional routes, mint-only semantics, and SDK compatibility checks.
- Routed collection API questions out of the general stack reference so hosted
  deployment claims are not inferred from library defaults.
- Corrected the public README's portable skill names and synchronized generated
  package skills while preserving the authored MintFlow and test-app skills.
- Corrected MintFlow's collection guidance so proposed SDK helpers remain
  clearly labeled and SIGMA is not misrepresented as root-owner authority.

## [0.0.26] - 2026-04-23

### Fixed
- `OneSatServices.postBeef` no longer silently treats unknown arcade transaction statuses as success. Success (`MINED`, `SEEN_ON_NETWORK`, `ACCEPTED_BY_NETWORK`) and in-flight (`QUEUED`, `RECEIVED`, `STORED`, `ANNOUNCED_TO_NETWORK`, `REQUESTED_BY_NETWORK`, `SENT_TO_NETWORK`) are whitelisted; everything else (`REJECTED`, `DOUBLE_SPEND_ATTEMPTED`, `SERVICE_ERROR`, `SEEN_IN_ORPHAN_MEMPOOL`, typos) returns an error with the arcade status and extraInfo attached.

## [0.0.4] - 2026-02-05

### Changed
- **Breaking:** `OwnerClient.getTxos()` converted from JSON request (`Promise<IndexedOutput[]>`) to SSE stream returning an unsubscribe function. Streams sync progress events before delivering TXO results individually.

### Added
- `getTxos()` now accepts `onSync`, `onTxo`, `onDone`, `onError` callbacks for real-time sync progress and streamed results
- `getTxosIterator()` async generator yielding typed `TxoStreamEvent` discriminated union events
- `TxoStreamEvent` exported type for typed event handling
- `Last-Event-ID` support for reconnection without re-syncing
