# Orphan outputTagMap rows in Dan's IDB — analysis

**Date:** 2026-04-21
**Symptom on record:** "RPC Error: results must be unique" when adding mss1 (wallet.shruggr.cloud) as a remote backup in yours-wallet from Dan's wallet (identityKey `02e0c4688774ce2bb048032fe5d569cc42301dde6b01025759be253ba64d183fd3`).

**Data source:** `/Users/davidcase/Downloads/Archive` — backup export of Dan's IDB via `@1sat/wallet-browser` FileBackupProvider (4 msgpack chunks, identity + chain recorded in manifest). Cross-referenced with Postgres wallet DB on `ovh-n0001` (user_id=21).

## Confirmed facts

### 1. Dan's IDB matches Postgres 1:1 for every entity EXCEPT output_tags_map

| Entity | IDB | Postgres (Dan, live) | Match |
|---|---|---|---|
| transactions | 125 | 125 | ✓ |
| outputs | 296 | 296 | ✓ (all 262 with txids cross-verified by (txid, vout)) |
| outputTags | 147 | 147 | ✓ |
| outputBaskets | 8 | 8 (user-scoped) | ✓ |
| txLabels | 7 | 7 | ✓ |
| txLabelMaps | 227 | 227 | ✓ |
| **outputTagMaps** | **536** | **474** (470 live) | **+62 in IDB** |

All IDB IDs are contiguous starting at 1 (transactionIds 1–125, outputIds 1–296, outputTagIds 1–147). No gaps, no duplicates — standard IDB auto-increment behavior.

### 2. The 62 extras

**Orphan = IDB outputTagMap row whose `outputTagId` or `outputId` isn't in IDB's own corresponding store.**

- **45 unique orphan outputTagIds**: 148–192 (contiguous block immediately above IDB's valid range 1–147).
- **17 unique orphan outputIds**: {299, 307, 309–312, 315–316, 321, 323–326, 329, 331, 333, 345}.
- 54 of 62 have `isDeleted=false` (supposedly live references).
- created_at range: 2026-04-07 to 2026-04-16.

### 3. The orphan IDs correspond to Postgres-native values

**outputIds:**

- 10 of the 17 are **Dan's own** outputs in Postgres (user_id=21): 299, 307, 309, 310, 311, 326, 329, 331, 333, 345.
- 7 belong to **user_id=24** in Postgres: 312, 315, 316, 321, 323, 324, 325.
- All 17 are live (no `deleted_at`).
- Some of these Postgres outputs share a txid with Dan's own outputs (different vouts on the same transaction — e.g., txid `cbabb0366a...` has user 21's output at vout 1 and user 24's outputs at vouts 0, 1, 2).

**outputTagIds:** Checked against `bsv_numeric_id_lookups` (Go server's synthetic numeric id table). Only **8 of 45** map to anything; those 8 are:
- 165 = `21.originator localhost:5173`
- 166 = `21.privileged false`
- 167 = `21.protocolname identity key retrieval`
- 168 = `21.protocolsecuritylevel 1`
- 176 = `21.protocolname message signing`
- 188 = `21.protocolname yours-test`
- 189 = `21.protocolsecuritylevel 2`
- 190 = `21.counterparty self`

The other 37 values (148–164, 169–175, 177–187, 191–192) fall across **different Postgres tables**: `bsv_output_baskets`, `bsv_known_txes`, `bsv_labels`, with many values not existing at all in `bsv_numeric_id_lookups`.

### 4. Verdict on "missing vs extra"

These 62 rows are **extra, not missing-that-should-be-there**. The 474 live bsv_output_tags rows in Postgres for user 21 match Dan's 474 valid (non-orphan) IDB outputTagMap rows exactly.

## Ruled-out mechanisms

### Go sync via wallet-toolbox's standard pipeline (EntityOutputTagMap.mergeNew)

`EntityOutputTagMap.mergeNew` (wallet-toolbox/src/storage/schema/entities/EntityOutputTagMap.ts:101-105) translates incoming IDs via syncMap:

```ts
this.outputId = syncMap.output.idMap[this.outputId]
this.outputTagId = syncMap.outputTag.idMap[this.outputTagId]
```

If both translations succeed, IDB row has local IDs. If either fails (returns undefined), IDB's composite keyPath `['outputTagId', 'outputId']` would reject the insert (IDB doesn't allow undefined in keyPath).

**Verified**: EntityOutputTagMap.ts history shows translation has always been applied. No version regression.

### IDB physical delete leaving orphan maps

StorageIdb has **zero `.delete()` calls** anywhere (confirmed via grep). All "deletions" are soft-deletes (isDeleted=true). Therefore output_tags auto-increment never went higher than 147 in Dan's IDB, and 148–192 were never assigned as outputTag IDs in IDB.

### yours-wallet local wallet actions (createAction / tagOutput)

- `createAction.ts:470` calls `insertOutputTagMap` with `verifyId(o.outputId)` — local ID from a fresh insertOutput.
- `StorageReaderWriter.findOrInsertOutputTagMap` takes `(outputId, outputTagId)` but all in-tree callers supply local IDs via `verifyId` of a prior `findOutputs` / `findOrInsertOutputTag` result.

No in-tree path passes Postgres-native IDs.

### Go sync chunker for output_tags sending wrong IDs

Inspected `go-wallet-toolbox/pkg/internal/storage/repo/syncrepo/sync_tag_map.go`:

```go
return &wdk.TableOutputTagMap{
    OutputID:    model.OutputID,    // raw bsv_outputs.id (Postgres PK — large, sparse)
    OutputTagID: model.NumID,       // num_id from numeric_id_lookups
    IsDeleted:   deleted,
}
```

`FindChunk` scopes the JOIN: `JOIN numeric_id_lookups ON table_name='bsv_tags' AND string_id='<user>.<tag>'`. So Go does **not** send num_ids from other tables — only valid bsv_tags num_ids.

Yet IDB has orphans with num_ids that belong to **bsv_output_baskets, bsv_known_txes, bsv_labels**. That can't come from `sync_tag_map.go` as it stands today.

## Remaining candidates for the mechanism

### A. Historical wallet-toolbox / go-wallet-toolbox bug (no longer present)

The orphan dates (2026-04-07 to 2026-04-16) would point at whatever code was deployed at that time. Candidates to git-log against in that window:

- go-wallet-toolbox `pkg/internal/storage/repo/syncrepo/label_tag_map_commons.go` — the `FindChunk` JOIN filter.
- go-wallet-toolbox `pkg/storage/internal/sync/chunker_tags.go` — chunker order / composition.
- wallet-toolbox-mobile `StorageIdb` pre-Jan-21 fix (`a5ed74cd`) — filter truthiness checks.

Checked: current `label_tag_map_commons.go` and `numeric_id.go` haven't been touched in the window. The `a5ed74cd` IDB filter fix predates the orphan window by >2 months, so the fixed code was already deployed.

### B. A separate ingestion path we haven't found yet

Something is writing to IDB's `output_tags_map` store **without** going through `EntityOutputTagMap.mergeNew`. Could be:
- A restore/import that bypasses the normal sync path.
- A dev/test tool that wrote raw Postgres-sourced data.
- A bug in a RPC method that stores chunk entities directly.

Worth looking at: any path in yours-wallet's `WalletBackupService.ts` that INGESTS chunks (reverse direction from what we looked at).

### C. Multi-user state mixup in a prior sync

User 24's output IDs showing up in Dan's outputTagMap rows is the hardest thing to explain. Go's `FindTagsMapForSync` filters by `tag_user_id = userID`, so user 24's output_tags should never have been sent to Dan. And Postgres confirms: no cross-user `bsv_output_tags` rows exist (`tag_user_id` always equals output's `user_id`).

But IDB has 7 such rows. Either:
- A previous deployment of go-wallet-toolbox didn't have the `relationUserIDColumn = userID` filter, or had a different scope.
- Dan's IDB at some point contained user 24's data entirely and got partially cleaned.

## Open questions (require more info)

1. **Does Dan have a second identity that mapped to user 24 ever?** If Dan's wallet once created identity-1 (BAP rotation) and that derived a different identityKey briefly, Go could have provisioned user 24 for the same person. Worth checking bsv_users on Postgres for related identity activity in the window.

2. **What version of wallet-toolbox-mobile / go-wallet-toolbox was deployed at api.1sat.app during 2026-04-07 → 2026-04-16?** Git log the relevant files in both repos with `--since`/`--until` filters on those dates plus a few surrounding weeks; look specifically for label_tag_map_commons.go changes.

3. **Does yours-wallet's `WalletBackupService` have an import path?** If users imported a backup file that contained orphan rows, the rows would land in IDB as-is. Worth tracing.

4. **Did Dan's wallet run against a staging/test postgres at any point?** The 37 "no-such-num_id" values (148–192 minus Dan's 8 tag num_ids) suggest the data came from a postgres with a different `bsv_numeric_id_lookups` state.

## Immediate actionable findings (bugs, no fixes proposed)

### Bug 1: `filterOutputTagMaps` has dead-code user filter

File: `wallet-toolbox/src/storage/StorageIdb.ts:553`

```ts
if (userId !== undefined && r.txid) {
    const count = await this.countOutputTags({ partial: { userId, outputTagId: r.outputTagId }, trx: dbTrx })
    if (count === 0) continue
}
```

`TableOutputTagMap` has no `txid` field. `r.txid` is always undefined → block never runs → `getOutputTagMapsForUser` returns ALL rows regardless of user. This is why the backup includes all 536 outputTagMap rows (including the 62 orphans). Same pattern probably exists in `filterTxLabelMaps`.

**Status:** user says don't fix yet — noting as a latent bug.

### Bug 2: `storage-bun-sqlite` dynamic column builder trusts any key (ALREADY FIXED this session)

File: `1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts`

Fixed in this session by introspecting schema and dropping unknown keys. This is what surfaces the current "results must be unique" — mss1 accepts the 62 orphan outputTagMaps over RPC but `EntityOutputTagMap.mergeFind` can't map them and hits the same undefined-partial bug.

### Bug 3: Composite-key queries on IDB and storage-bun-sqlite silently over-match on undefined partial values

- StorageIdb `filterOutputTagMaps:547-548` — uses `if (args.partial.outputTagId && …)` truthiness. Partially fixed in `a5ed74cd` for some fields but line 547-548 wasn't part of that fix.
- storage-bun-sqlite `buildWhere` — strips undefined keys, converting `{a: undefined, b: 5}` into `WHERE b=5`. Same flaw.
- StorageKnex — Knex throws "Undefined binding(s) detected" which is loud and correct.

**Pattern:** `EntityOutputTagMap.mergeFind` trusts that syncMap translation succeeds before calling `findOutputTagMaps(partial)`. When idMap is empty or missing an entry, it passes undefined through, and both IDB and bun-sqlite over-match. Knex would have errored loudly.

Proper fix (not yet landed per user instruction): add a guard in `mergeFind` to throw with the unmapped source id, matching Knex's loud-error behavior.

## What this doesn't yet explain

The mechanism that wrote the 62 orphan rows into Dan's IDB. All current-tree code paths we've inspected either:
- Translate IDs correctly (mergeNew),
- Use local IDs only (createAction, findOrInsertOutputTagMap via tagOutput),
- Would reject undefined keypath values at IDB-insert time.

### Cross-checked against Postgres with the "are these real pairs?" test

Queried Postgres for all orphan (outputTagId, outputId) combinations, including the 8 where the outputTagId **does** resolve to a real Dan tag num_id (165, 166, 167, 168, 176, 188, 189, 190):

```sql
SELECT ot.output_id, ot.tag_name, ot.tag_user_id, nil.num_id
FROM bsv_output_tags ot
JOIN bsv_numeric_id_lookups nil ON nil.table_name='bsv_tags' 
    AND nil.string_id = CONCAT(ot.tag_user_id, '.', ot.tag_name)
WHERE nil.num_id IN (...8 valid tag num_ids...)
  AND ot.output_id IN (...17 orphan output_ids...);
```

**Zero rows.** Not a single orphan (tag, output) pair exists in Postgres — even the pairs where both components individually resolve to real Postgres entities.

So these 62 rows are **synthetic combinations** that never existed anywhere. Something generated a (tag num_id × output id) product and wrote it into Dan's IDB.

### Ingestion path traced — goes through mergeNew

`WalletBackupService.importPendingWalletData` (yours-wallet/src/backup/WalletBackupService.ts:441) calls `storage.syncFromReader(identityKey, reader)`. That calls `WalletStorageManager.syncFromReader` which loops calling `writer.processSyncChunk(args, chunk)` — same path that applies idMap translation via `EntitySyncState.processSyncChunk` → `MergeEntity.merge` → `EntityOutputTagMap.mergeNew`. **No raw-write ingestion path exists in the current tree.**

### go-wallet-toolbox history — no bug found in sync scope

Traced full history of:
- `pkg/internal/storage/repo/syncrepo/label_tag_map_commons.go` (5 revisions, original: abf9c6e8, Jul 2025)
- `pkg/internal/storage/repo/syncrepo/numeric_id.go` (6 revisions)
- `pkg/internal/storage/repo/syncrepo/sync_tag_map.go`

All revisions since inception filter the numeric_id_lookup JOIN by `num.table_name = ?` bound to the subject table (`bsv_tags` for tag maps). No historical version of this code could have sent cross-table num_ids.

### RESOLVED — multi-account IDB + broken user filter

Dan's yours-wallet had **multiple accounts in the same IndexedDB database**. IndexedDB auto-increment is **global per object store** — it does *not* restart per-user. So with Account A at userId=1 and Account B at a different userId in the same IDB:

- `output_tags` object store assigns IDs continuing past Account A's max: Account A gets 1–147, Account B continues at 148+.
- `outputs` object store does the same: Account A gets 1–296, Account B continues at 297+.

When `WalletBackupService` exports a single identityKey, it filters each entity by `userId`. That works correctly for `transactions`, `outputs`, `outputTags`, etc. — they all have a `userId` field.

**But `TableOutputTagMap` has no `userId` field.** The filter has to be done by joining through the parent `outputs` or `outputTags`. That join is attempted in `filterOutputTagMaps` at line 553:

```ts
if (userId !== undefined && r.txid) {
    const count = await this.countOutputTags({ partial: { userId, outputTagId: r.outputTagId }, trx: dbTrx })
    if (count === 0) continue
}
```

`r` is a `TableOutputTagMap`. **`TableOutputTagMap` has no `txid` field** — it only has `created_at`, `updated_at`, `outputTagId`, `outputId`, `isDeleted`. So `r.txid` is always `undefined`, the whole block is dead code, and no user filter is applied.

Consequence: `getOutputTagMapsForUser` returns **all** output_tags_map rows across **all** accounts in the IDB, even when called with a specific userId.

Evidence from the data:
- IDB valid outputTagMap rows = 474 (matches Dan's Postgres bsv_output_tags count on ovh-n0001).
- IDB total outputTagMap rows = 536 (includes 62 from Account B).
- 62 orphans reference outputTagIds 148–192 (contiguous — Account B's outputTag auto-increment continuation) and outputIds 297+ (Account B's output auto-increment continuation).
- The fact that Account B's num_id pattern doesn't match user 24 or anyone specific on any server confirms these are IDB-local auto-increment values, not Postgres-native IDs. Any observed overlap with Postgres IDs (e.g., orphan outputId 323 matching a Postgres row) is coincidence from two independent sequential-integer namespaces overlapping.

Confirmed by the user that yours-wallet did store multiple accounts; user also pointed us at the rack server's `bsv_wallet.sqlite`, which contains Dan at user_id=10 with a different data profile (157 outputs, 10 tags, 23 output_tags_map) — different from both the IDB counts and ovh-n0001 counts. Rack may be where Account B's data lives or may be yet another storage Dan synced with. Either way, the orphans in the backup are Account B's local-IDB rows.

### How this causes "Result must be unique" on mss1

When yours-wallet adds mss1 as a backup and syncs:

1. `getSyncChunk` calls `getOutputTagMapsForUser(userId=<Dan>)` — returns ALL 536 rows (due to broken filter).
2. Only Dan's transactions / outputs / outputTags / baskets are in the chunk (those filters work).
3. mss1's `processSyncChunk` → `EntitySyncState` builds idMaps only for Dan's entities (output IDs 1–296, outputTag IDs 1–147).
4. When Account B's 62 outputTagMap rows get processed, `syncMap.output.idMap[297]` and `syncMap.outputTag.idMap[148]` are undefined.
5. `EntityOutputTagMap.mergeFind` → `findOutputTagMaps({partial: {outputId: undefined, outputTagId: undefined}})`.
6. storage-bun-sqlite's `buildWhere` strips undefined → query returns all rows inserted so far → `verifyOneOrNone` throws "Result must be unique".

This matches the observed error 1:1.

### The fix direction

Primary fix is in `wallet-toolbox` `StorageIdb.filterOutputTagMaps:553`: replace the dead `r.txid` check with an actual user-scope filter. Same pattern likely needs checking in `filterTxLabelMaps` (tx_labels_map has no userId field either, so it probably has the same bug). The symmetric fixes should gate rows against userId via a join-through-parent pattern.

Secondary: `EntityOutputTagMap.mergeFind` and peers should throw explicitly when idMap is missing an entry, instead of silently passing undefined to findX — this surfaces the mapping gap loudly regardless of which storage provider is on the receiving end.

Tertiary (already landed this session): storage-bun-sqlite schema whitelist. This prevents foreign-field SQL errors but doesn't fix the mapping issue. Still useful hardening.

### Remaining candidate mechanism (now resolved above, kept for history)

Given none of:
- Current code paths
- Restoration paths
- go-wallet-toolbox git history
- Documented sync paths

…can produce these 62 orphan rows with cross-table num_ids and non-existent pair combinations, the most plausible remaining mechanisms are:

1. **A yet-undiscovered code path in yours-wallet or @1sat/wallet-browser that writes raw chunk data to IDB stores.** Worth a comprehensive grep across `/Users/davidcase/Source/1sat/yours-wallet`, `1sat-sdk/packages/wallet-browser`, and `@1sat/wallet-toolbox-mobile` for any direct IDB write that bypasses the entity layer.

2. **Historical runtime behavior not captured in git**: perhaps a dev/debug tool that was run locally against Dan's IDB and then not committed, or a manually-authored test fixture that ended up in production data.

3. **A yours-wallet-specific sync driver we haven't identified** that pre-processes Go chunks differently — maybe something that splits chunks by entity type and writes each type directly to its own IDB store without translation. This would explain cross-table num_ids ending up in output_tags_map: if the driver is iterating over "everything Go sent, including baskets, known_tx, labels" and writing it all to a single store by mistake, we'd see exactly this pattern.

### Distinct findable bugs identified this session

1. **IDB `filterOutputTagMaps` has dead-code user filter** (`wallet-toolbox/src/storage/StorageIdb.ts:553`): `r.txid` check always false; user filter never applies. This doesn't cause the orphans but lets `getOutputTagMapsForUser` return all rows regardless of user context.

2. **Asymmetry between StorageKnex and StorageIdb/StorageBunSqlite on undefined partial values**: Knex throws, Idb/bun-sqlite silently over-match. `EntityOutputTagMap.mergeFind` assumes Knex semantics and passes undefined through to findX when idMap is missing an entry. On Idb/bun-sqlite, this produces the misleading "Result must be unique" error instead of a clear "Undefined binding" error. Fix direction: reject undefined in partial at the storage-provider level.

3. **Dynamic column builder in storage-bun-sqlite trusts any key** (ALREADY FIXED this session in commit `3e2d780` / `wallet-node@0.0.34` / `cli@0.0.37`).

## Next diagnostic step worth running

Query `bsv_output_tags` on Postgres WITH `Unscoped()` semantics (i.e., show soft-deleted):

```sql
SELECT output_id, tag_name, tag_user_id, deleted_at 
FROM bsv_output_tags
WHERE tag_user_id = 21 
  AND deleted_at IS NOT NULL;
```

If Postgres has *soft-deleted* bsv_output_tags rows, `FindChunk` *does* return them (`.Unscoped()`), and they arrive at yours-wallet. If those soft-deleted rows include combinations that don't exist as hard rows, *that* could seed the orphan pattern — combined with some downstream TS issue where the soft-deleted flag gets lost in transit.

Also worth: grep Dan's IDB `sync_states` entries (should be in chunk-0000 under settings/syncStates) to see all storages Dan has ever synced with. If there's a second server beyond ovh-n0001, the orphans may have come from it.

Time-bounded conclusion: the orphans are real, they're extras not missing data, and they did not come through any currently-reviewed code path with idMap translation intact. Fixing the symptom (via a whitelist or diagnostic throw in mergeFind) unblocks sync, but finding the generator requires more context than we have in this session.

