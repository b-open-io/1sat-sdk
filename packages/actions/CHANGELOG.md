# Changelog

## 0.0.106

### Changed
- Bump `@1sat/wallet` to 0.0.55 (storage-client 507 auto-retry for backup sync).

## 0.0.96

### Fixed
- BAP identity key rotation now matches the BAP protocol spec. `publishIdentity` now declares `identity-1` as the signing key (was incorrectly declaring `identity-0`). `rotateIdentity` now correctly declares `identity-N` at sequence N (was off-by-one, declaring `identity-(N-1)`).

### Changed
- `updateProfile` now handles first-time identity creation by publishing both ID and ALIAS outputs in a single transaction when no BAP ID exists. The ID is signed by `identity-0`, and the ALIAS is signed by the newly declared `identity-1`.
- Extracted shared `buildIdOutput` helper for creating BAP ID outputs, used by `publishIdentity`, `rotateIdentity`, and `updateProfile`.

## 0.0.90

### Changed
- `sweepBsv` now builds a raw transaction and internalizes it instead of using `createAction`. The source wallet funds the entire transaction including fees. The receiving wallet records the sweep as incoming (`isOutgoing: false`) via `internalizeAction`. Fixes sweep transactions showing as "Sent" in transaction history.

## 0.0.89

### Changed
- `sendBsv21` now accepts a `recipients` array for multi-recipient token transfers in a single transaction. Replaces the previous single-recipient interface (`amount`/`address`/`counterparty`/`paymail` as top-level fields). All callers (CLI, wallet-desktop, bsv-mcp) updated.

## 0.0.82

### Fixed
- `getAipMessageBuffer` now appends the trailing `|` separator to the signed message, matching every canonical AIP validator (go-templates `validateAip`, bmap, the `@1sat/templates` internal `validateAIP`, and pre-regression bsv-bap). BAP identity and profile transactions signed by `applyBapAip` were silently rejected by every overlay validator because the signed bytes were missing the final `0x7c` that the protocol spec requires. The bug was inherited from a May 2025 regression in bsv-bap (`b1dd05d`, "fix AIP OP_RETURN signing issue", which deleted the trailing-pipe append that had been in place since the library's 2021 initial commit and survived three refactors). Verified against a 2019-era on-chain BAP identity at block 590194 that validates under the corrected format.

## 0.0.69

### Fixed
- Sweep ordinals now passes name from ORDFS metadata to tag resolution
- `resolveOrdinalTags` handles bare `origin` tag (no outpoint suffix) by using the input outpoint as the origin

## 0.0.68

### Fixed
- All actions now route `signAction` through `completeSignedAction` for abort protection. Previously `createTrackedAction` called `signAction(spends: {})` directly, which broke actions with caller-signed inputs (sweep, ordinal transfer, cancel listing, etc.) and left funding UTXOs locked on failure.
- `createTrackedAction` no longer calls `signAction` — it only handles `createAction` + output tagging.
- `executeTrackedAction` now accepts optional `inputBEEF` and signing callback, wiring them through `completeSignedAction`.

### Changed
- Action response types return `tx: number[]` (AtomicBEEF) instead of `rawtx: string`. Matches `signAction` return type. Hex conversion done inline only where needed (P2P delivery, debug logging).
- `completeSignedAction` accepts optional `inputBEEF` for actions with no external inputs.

## 0.0.62

### Added
- `registry` module — shared infrastructure for building on-chain registry packages
- `buildPackageOutputs(files, metadata, privateKey)` — builds ordinal inscription outputs with ord-fs/json manifests, MAP metadata, and AIP signatures
- `detectContentType(filePath)` — MIME type detection from file extensions
- `PackageFile`, `PackageMapMetadata`, `PackageTxOutput`, `PackageTxResult`, `PackageBroadcastResult` types
- `REGISTRY_TYPES` constant with all registry types including `registry:font` (new)
- `RegistryType`, `REGISTRY_TYPE_SET`, `MANIFEST_CONTENT_TYPE` exports
- Supports nested `ord-fs/json` subdirectory manifests for packages with directory structure
- `PackageMapMetadata.app` is generic `string` — works for any publisher (clawnet, theme-token, etc.)
- Index signature on `PackageMapMetadata` for extra MAP fields (e.g. `font.family`, `font.variable`)

### Changed
- Renamed internal `registry.ts` to `action-registry.ts` to free `src/registry/` for the new module

## 0.0.53

### Changed
- Migrated template imports from `@bopen-io/templates` to `@1sat/templates`
- Internal deps now use workspace:* for consistent types across monorepo
