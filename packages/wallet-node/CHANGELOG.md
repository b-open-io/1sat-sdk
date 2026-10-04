# Changelog

## 0.0.84

### Fixed
- The monitor never completed a merkle proof: `OneSatServices` returned an ESM `MerklePath`, which the CommonJS wallet-toolbox rejects. `createNodeWallet` now passes the toolbox's CommonJS `@bsv/sdk` (`toolboxSdk`) to `createWalletCore`.
- `StorageBunSqlite.purgeData` (`purgeSpent`) builds its `Beef` from the toolbox's SDK, so it passes the toolbox's `instanceof Beef` check.

### Changed
- `@bsv/wallet-toolbox` alias: `@bopen-io/wallet-toolbox@2.14.6` (binary BEEF over negotiated binary JSON; BRC-177 anchor surplus as fee).

## 0.0.82

### Changed
- `StorageKnexPg` (the wallet-toolbox `StorageKnex` on a Postgres knex) replaces `StoragePg`. `storage.provider: 'pg'` options: `poolConfig` is now `pool`. Existing StoragePg databases need `scripts/migrations/2026-10-01-storagepg-to-storageknex.sql` before first start.

## 0.0.81

### Added
- Migrations (StoragePg and StorageBunSqlite): BRC-177 `noSendExpiry*` columns on `transactions`; `wasBroadcast` / `rebroadcastAttempts` on `proven_tx_reqs`; monitor, funding-selection and sync-source indexes (built `CONCURRENTLY` on Postgres); SQLite listOutputs/createAction indexes.
- `2026-09-30-001`: removes duplicate `sync_states` rows per `(userId, storageIdentityKey)` (keeping the oldest) and adds a unique index. Toolbox 2.14 fails sync for a user with duplicates.
- `2026-09-30-002`: re-files outputs from legacy `p 1sat …` baskets (and `ordinals`) into `1sat`, `bsv21`, `opns`, `lock`, `sigma`, `bsocial` for every user in one transaction, bumping `updated_at` so the change syncs.

### Fixed
- Transaction status updates, aborts and broadcast bookkeeping failed on toolbox 2.14 (`no such column: transactions.noSendExpiryMode`).

## 0.0.80

### Changed
- Peer dependency is upstream `@bsv/wallet-toolbox` ^2.14.4 instead of the `@bopen-io` fork. Storage backends import from the toolbox's public entry points instead of `out/src/**` file paths.

## 0.0.73

### Fixed
- Accept Node `Buffer` values as SQLite blob bindings under current Bun type definitions.

### Changed
- Picks up `@1sat/wallet@0.0.106`.
