# Address Sync Refactor

Replaces the existing AddressSyncManager/Fetcher/Processor infrastructure with a single `syncAddresses` action.

## Problem

The current address sync has three classes (AddressSyncFetcher, AddressSyncProcessor, AddressSyncManager), a full queue system with statuses/claiming/batching, and an EventSource dependency. This was built for high-throughput continuous processing. In practice, most payments arrive via `createAction`/`internalizeAction`, not external address delivery. Volume through address sync is ~1 tx/day.

## Design

### New action: `syncAddresses`

```typescript
syncAddresses.execute(ctx, {
  prefix: 'mcp',       // BRC-29 derivation prefix
  startIndex: 0,       // first address index
  count: 1,            // number of addresses to derive
  onProgress?: (p) => void  // optional SSE progress callback
})
// Returns: { processed: number, failed: number, lastScore: number }
```

Internally:
1. Derive addresses via BRC-29 (same logic as `deriveDepositAddresses`)
2. Get identity key for storage namespace
3. Open processed-tx store (SQLite or IDB based on environment)
4. Load `lastScore` from store
5. Get current block height from wallet
6. Fetch sync stream from `services.owner.sync(addresses, lastScore)` via streaming `fetch`
7. For each `SyncOutput` received:
   - Extract txid from outpoint
   - Skip if txid already in processed-tx store
   - Fetch BEEF via `services.beef.getBeef(txid)`
   - Run indexer pipeline to classify outputs (baskets, tags)
   - Call `wallet.internalizeAction()` with classified outputs
   - Mark txid as processed in store
8. Update `lastScore` — only advance for outputs where `currentHeight - Math.floor(score) >= 6` (reorg safety)
9. Return summary

### Processed-tx store

Simple interface — replaces the full queue:

```typescript
interface ProcessedTxStore {
  has(txid: string): Promise<boolean>
  add(txid: string): Promise<void>
  getLastScore(): Promise<number>
  setLastScore(score: number): Promise<void>
  close(): Promise<void>
}
```

Two implementations:
- `ProcessedTxStoreIdb` — browser (IndexedDB)
- `ProcessedTxStoreSqlite` — Node/Bun (SQLite)

Storage location:
- `ctx.dataDir` set → SQLite at `${ctx.dataDir}/sync-${identityKey}.db`
- `ctx.dataDir` not set + browser → IDB keyed by identity key
- `ctx.dataDir` not set + Node/Bun → SQLite at `${process.cwd()}/sync-${identityKey}.db`

### `OneSatContext` change

Add optional `dataDir` field for actions that need local persistence:

```typescript
export interface OneSatContext {
  // ... existing fields
  dataDir?: string
}
```

### `OwnerClient` change

Replace EventSource-based `sync()` with `fetch` + streaming body parser. Same SSE endpoint on the server, parsed client-side via `ReadableStream`. Works in Bun, Node, and browsers without `EventSource` polyfills.

Keep the method signature compatible with progress callbacks for consumers that show sync status in UI.

### Indexer pipeline

The 7 indexers (Fund, Inscription, Bsv21, Origin, OpNS, Sigma, Map) move from `AddressSyncProcessor` into the action or a shared utility. They classify outputs into baskets/tags for `internalizeAction`.

## Files changed

### `@1sat/actions` (packages/actions/)
- `src/types.ts` — add `dataDir?: string` to `OneSatContext`, add `'sync'` to `ActionCategory`
- `src/sync/index.ts` — new `syncAddresses` action
- `src/sync/ProcessedTxStore.ts` — store interface
- `src/sync/ProcessedTxStoreIdb.ts` — browser implementation
- `src/sync/ProcessedTxStoreSqlite.ts` — Node/Bun implementation
- `src/sync/parseTransaction.ts` — indexer pipeline extracted from AddressSyncProcessor
- `src/index.ts` — export new action

### `@1sat/client` (packages/client/)
- `src/services/OwnerClient.ts` — replace `sync()` EventSource with `fetch` streaming, add `onProgress` callback

### `@1sat/wallet` (packages/wallet/)
- Delete `src/address-sync/AddressSyncFetcher.ts` (logic moves to action)
- Delete `src/address-sync/AddressSyncProcessor.ts` (logic moves to action)
- Delete `src/address-sync/AddressSyncManager.ts` (replaced by action)
- Keep `src/address-sync/AddressManager.ts` (still used by consumers for address lookup)
- Keep `src/address-sync/AddressSyncQueueIdb.ts` — DELETE (replaced by ProcessedTxStoreIdb)
- Keep `src/address-sync/AddressSyncQueueSqlite.ts` — DELETE (replaced by ProcessedTxStoreSqlite)
- Update `src/address-sync/index.ts` — remove deleted exports
- Keep indexers in `src/indexers/` — imported by the action

### `yours-wallet`
- `src/initWallet.ts` — remove AddressSyncProcessor, call `syncAddresses.execute()` from service worker
- `src/initSyncContext.ts` — simplify or remove (address derivation now inside the action)
- `src/contexts/providers/ServiceProvider.tsx` — remove AddressSyncFetcher, send message to service worker to trigger sync

### `1sat-website`
- `providers/hooks/use-sync-engine.ts` — replace fetcher+processor with `syncAddresses.execute()` on mount + optional `setInterval`

### `bsv-mcp`
- `tools/wallet/refreshUtxos.ts` — call `syncAddresses.execute(ctx, { prefix: 'mcp', count: 1 })`
- `tools/wallet/getAddress.ts` — call `deriveDepositAddresses.execute(ctx, { prefix: 'mcp' })` and return address

## Dependency note

The `syncAddresses` action imports indexers from `@1sat/wallet`. Both are at the same level in the dependency graph (`actions/wallet`), so this is a clean import. Indexers stay in `@1sat/wallet` to minimize changes. Can extract to a dedicated package later if more consumers appear.

Note: `@1sat/core` is dead code — duplicate script templates with old-pattern APIs, zero consumers. Actions use `@bopen-io/templates` instead. Core can be deleted in a future cleanup.

## Consumer migration summary

| Consumer | Before | After |
|----------|--------|-------|
| yours-wallet (service worker) | `AddressSyncProcessor.start()` loop | `syncAddresses.execute(ctx, { prefix: 'yours', count: 5 })` |
| yours-wallet (popup) | `AddressSyncFetcher.fetch()` via SSE | Send message to service worker |
| 1sat-website | `AddressSyncFetcher` + `AddressSyncProcessor` in React hook | `syncAddresses.execute()` in hook + `setInterval` |
| bsv-mcp | Not wired | `syncAddresses.execute(ctx, { prefix: 'mcp', count: 1 })` in `refreshUtxos` |

## Not changing

- Server-side `/owner/sync` endpoint — stays as-is (SSE, lazy indexing, pagination)
- `AddressManager` class — still useful for address lookup by consumers
- `@1sat/types` address-sync types — `AddressDerivation`, `BRC29_PROTOCOL_ID` stay
- Queue types (`AddressSyncQueueStorage`, etc.) — deleted, replaced by simpler `ProcessedTxStore`
