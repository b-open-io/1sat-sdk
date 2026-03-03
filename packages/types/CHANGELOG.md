# Changelog

## [0.0.7] - 2026-03-03

### Changed
- Make MAP type flexible: `app` and `type` fields are now optional
- Add `opns` to `ActionCategory` union type

## [0.0.4] - 2026-02-05

### Added
- `SyncProgress` interface for tracking owner sync phases (`fetch`, `ingest`, `done`, `error`) with total/processed counts, owner, height, and error fields
