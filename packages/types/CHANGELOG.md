# Changelog

## Unreleased

### Changed
- `ORD_LOCK_V2_ARTIFACT` is the canonical `OrdLockV2Batch` build (472-byte template, constructor slots at 436 and 468, SIGHASH_SINGLE purchase). It replaces the earlier v2 draft outright.

### Added
- `DEPOSIT_HOLD_TAG_PREFIX` (`hold:`), `depositHoldTag`, `depositHoldUntil`, `isDepositHeld`: a `hold:<unix ms>` tag keeps a deposit-basket output out of `sweepDeposit` until the wallet clock passes it.
- `ORDLOCK_FUNDING_TAG`, `ORDLOCK_FUNDING_KEY_PREFIX` for OrdLock v2 front-funding outputs parked in the deposit basket.

### Removed
- `ORD_LOCK_V2_TAG_PREFIX` (the draft's tag output no longer exists).

## [0.0.47]

### Added
- `ORDLOCK_TAG` (`ordlock`) v1 listing tag export.

### Changed
- `ORDLOCK_LISTING_CREATE_DISABLED` points at OrdLock v2 (`sellOrdinal`): v1 create stays deprecated, buy and cancel stay on.

## [0.0.46] - 2026-09-12

### Added
- `BSV20_BASKET` (`bsv20`) and the `p 1sat bsv20` legacy migration.

## [0.0.34] - 2026-07-15

### Added
- OrdFS stream constants: `DEFAULT_STREAM_CHUNK_SIZE`, `ORDFS_STREAM_CONTENT_TYPE`, `ORDFS_STREAM_PARAM`.

### Changed
- `MAX_INSCRIPTION_BYTES` raised to 50 MiB (single-tx non-stream cap).

## [0.0.30] - 2026-05-15

### Added
- `P1SAT_BASKET_PREFIX = 'p 1sat '` constant.

### Fixed
- `buildInputAssetLabel` strips `P1SAT_BASKET_PREFIX` from the basket suffix in the label payload. The P-basket rename gave basket names embedded spaces (`'p 1sat ordinals'`), which broke the space-delimited basket↔id split in the consumer parser. Non-P1Sat baskets pass through unstripped and drop cleanly from enrichment downstream.

## [0.0.8] - 2026-03-03

### Added
- `OPNS_BASKET` constant (`'opns'`) for OpNS ordinal basket routing

## [0.0.7] - 2026-03-03

### Changed
- Make MAP type flexible: `app` and `type` fields are now optional
- Add `opns` to `ActionCategory` union type

## [0.0.4] - 2026-02-05

### Added
- `SyncProgress` interface for tracking owner sync phases (`fetch`, `ingest`, `done`, `error`) with total/processed counts, owner, height, and error fields
