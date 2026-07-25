# Changelog

## 0.0.192

### Removed
- Deprecated ordinal/OpNS/BSV21 action aliases (`getOrdinals`, `listOrdinal`, `transferOrdinals`, `cancelListing`, `purchaseOrdinal`, and OpNS/token counterparts). Use the canonical names only.

### Changed
- Depends on `@1sat/wallet@0.0.98` (no boot backup race; BackupSync via monitor).

## 0.0.191

### Added
- `loadBasketOutput` / `loadBasketOutputBeef` / `ordinalSeedTags` helpers (id-first load + tag carry).
- `listLocks` (UTXO list with ids); `buyOpns` (file purchase into OPNS basket).
- `buyOrdinal` optional `inputBEEF` + `filing` override.
- `unlockBsv({ ids? })` — specific locks or all matured.

### Changed
- **Renames** (old names kept as deprecated aliases):
  - OpNS: `listOpns`, `registerOpns`, `deregisterOpns`, `sellOpns`, `sendOpns`, `cancelOpnsListing`
  - Ordinals: `listOrdinals`, `sendOrdinals`, `sellOrdinal`, `cancelOrdinalListing`, `buyOrdinal`
  - BSV21: `listBsv21`, `buyBsv21`
- `sellOpns` / `sellOrdinal`: optional `payAddress` (default P1SAT keyID `1sat 0`).
- `internalizeOpns` stamps `opns`, `type:application/op-ns`, `origin:`, `name:`, `id:`.
- OpNS/ordinals self-spends **carry tags** + fixed basket; no `resolveOrdinalTags` for owned filing.
- Sigma single inscribe: inscription is normal send + `sendWith` anchor (not noSend).
- `sendBsv21` baskets self destinations with token tags.
- List defaults: metadata/tags on; BEEF off unless requested.

### Removed
- `resolveBeef` and `extractIdTag`. `loadBasketOutputBeef(wallet, basket, id)` makes
  the same lookup from a bare id and returns the row with its BEEF; `readAssetIdTag`
  from `@1sat/types` reads the id off a tags array.

## 0.0.190

### Added
- `internalizeOpns` — file a foreign OpNS mint AtomicBEEF into the wallet with basket, `name:`, and `id:` tags.
- `getOpnsNames` supports listOutputs-shaped filters (`tags`, `tagQueryMode`, `names` sugar, `include*`).

### Changed
- `getOpnsNames` is metadata-only by default (no BEEF). Pass `include: 'entire transactions'` when batch BEEF is required.

## 0.0.184

### Added
- OrdFS multi-tx stream inscription path (`stream` / `streamChunkSize` on inscribe).
- Stream and inscription outputs tagged with content hash (`sha256:<hash>`).

### Changed
- Single-tx inscription cap follows `@1sat/types` `MAX_INSCRIPTION_BYTES` (50 MiB); larger content requires stream opt-in.

## 0.0.160

### Changed
- Republish to bundle `@1sat/types@0.0.30` (`buildInputAssetLabel` payload now strips `P1SAT_BASKET_PREFIX` so basket↔id parsing in the 1Sat permission module works for the P-prefixed asset baskets).

## 0.0.129

### Fixed
- `syncCosignDeliveries` now unwraps the messagebox-server's `{message: <inner>}` storage envelope and decrypts manually using `wallet.decrypt` with `protocolID: [1, 'messagebox']`, `keyID: '1'`, `counterparty: <sender>`. `MessageBoxClient.listMessages`'s built-in decryption only matches `encryptedMessage` at the top level of the parsed body, so the nested envelope was being passed through verbatim.

## 0.0.128

### Fixed
- `syncCosignDeliveries` now uses `@bsv/p2p` `MessageBoxClient` for `listMessages` / `acknowledgeMessage`. The raw `AuthFetch` calls in 0.0.126/0.0.127 returned the encrypted-body envelope (`{encryptedMessage}` ciphertext under BRC-2 ECDH/AES-256-GCM) verbatim, so parsing the cleartext fields failed. `MessageBoxClient` decrypts using the wallet, matching what the sender used to encrypt.

### Changed
- `@bsv/p2p` added as a runtime dependency.

## 0.0.127

### Fixed
- `syncCosignDeliveries`: defensive checks on the parsed message body. Logs the body's keys when a message arrives so unexpected/legacy messages in the inbox produce useful diagnostics instead of an opaque `Cannot read properties of undefined (reading 'slice')`.

## 0.0.126

### Added
- `syncCosignDeliveries` action — pulls cosign-wrapped BSV21 deliveries from a MessageBox slot (default: `cosign_token_inbox` on `messagebox.1sat.app`) and internalizes each into the wallet's `bsv21` basket using the supplied `customInstructions` verbatim. Intended for one-shot calls on UI mount or wallet init, not polling.

## 0.0.113

### Added
- `pickNewestAlias` helper under `src/identity/` for deterministic selection of the most recent BAP profile when multiple ALIAS outputs exist at the same address.

### Changed
- BAP profile selection in `updateProfile` / `getProfile` is now deterministic via a `publishedAt` MAP tag ordering rule, replacing the prior first-match behaviour that could return different profiles across runs.
- `completeSignedAction` inspects `sendWithResults` / `notDelayedResults` returned by `signAction` and surfaces broadcast failures instead of returning a txid when the server reports an unsuccessful outcome. The try/catch around the pre-signAction work remains (so script-verification / BEEF-build errors still abort), but the post-signAction catch was dropped — the server already transitions rejected txs to `failed`, so an extra abort just generated noise.

## 0.0.111

### Removed
- `sendBsv21` paymail recipient branch. The path always returned `paymail-not-yet-implemented`, and the standard paymail P2P destination flow returns P2PKH scripts for BSV sats — there is no ecosystem spec for paymail-delivered BSV21 token outputs. `SendBsv21Recipient.paymail` dropped from the input schema and interface.

## 0.0.109

### Changed
- Bump `@1sat/wallet` to 0.0.58 (immediate targeted re-sync after storage payment).

## 0.0.108

### Changed
- Bump `@1sat/wallet` to 0.0.57 (fire-and-forget storage payment on sync 507).

## 0.0.107

### Changed
- Bump `@1sat/wallet` to 0.0.56 (storage payment via `/account/payment` 402 flow).

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
