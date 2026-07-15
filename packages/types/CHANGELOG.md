# Changelog

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
