# Sync Path Audit — Knex / Idb / BunSqlite

Date: 2026-04-21
Scope: TS wallet-toolbox sync chunk pipeline across the three TS storage providers.
Canon: [StorageKnex](../../wallet-toolbox/src/storage/StorageKnex.ts).
Other implementations:
- [StorageIdb](../../wallet-toolbox/src/storage/StorageIdb.ts)
- [StorageBunSqlite](../../packages/wallet-node/src/storage-bun-sqlite.ts)

## 1. Shared sync code (provider-agnostic)

### 1.1 Sender — `getSyncChunk`

[getSyncChunk](../../wallet-toolbox/src/storage/methods/getSyncChunk.ts#L24-L273) walks 12 entity chunkers in this order:

1. `provenTx` (via [getProvenTxsForUser](../../wallet-toolbox/src/storage/StorageKnex.ts#L164))
2. `outputBasket` — generic `findOutputBaskets({partial:{userId},since,paged})`
3. `outputTag`, 4. `txLabel` — same generic shape
5. `transaction`, 6. `output`, 9. `certificate`, 10. `certificateField`, 11. `commission` — generic
7. `txLabelMap` (via [getTxLabelMapsForUser](../../wallet-toolbox/src/storage/StorageKnex.ts#L208))
8. `outputTagMap` (via [getOutputTagMapsForUser](../../wallet-toolbox/src/storage/StorageKnex.ts#L229))
12. `provenTxReq` (via [getProvenTxReqsForUser](../../wallet-toolbox/src/storage/StorageKnex.ts#L187))

The five `*ForUser` helpers exist because their tables either lack a `userId` column (`provenTx`, `provenTxReq`) or are join tables (`tx_labels_map`, `output_tags_map`) where user scope must be derived via a related table. Everything else uses the generic find with `partial:{userId:args.userId}` — this is what the prior audit referenced when it noted that `filterOutputTagMaps` no longer leaks across accounts: prior code had a path where the user-scope was dead because `partial.userId` was being silently dropped before reaching the cursor.

### 1.2 The `since` filter is `>=`, not `>`

`getSyncChunk` writes `since: args.since` into every chunker call. All three providers translate this into `updated_at >= since` ([StorageKnex.setupQuery](../../wallet-toolbox/src/storage/StorageKnex.ts#L516), [StorageIdb cursors](../../wallet-toolbox/src/storage/StorageIdb.ts#L1528), [StorageBunSqlite.selectQuery](../../packages/wallet-node/src/storage-bun-sqlite.ts#L908)).

Combined with the `processSyncChunk` cursor advance (`this.when = maxUpdated_at`, see [EntitySyncState.processSyncChunk](../../wallet-toolbox/src/storage/schema/entities/EntitySyncState.ts#L379)), the next request will include rows whose `updated_at` exactly equals the previous chunk's max. The `MergeEntity.merge` loop then falls through to `mergeFind` and either `mergeExisting` (which requires `ei.updated_at > this.updated_at`, see e.g. [EntityTransaction.mergeExisting](../../wallet-toolbox/src/storage/schema/entities/EntityTransaction.ts#L271)) or no-op. So the `>=` plus per-row LWW guard yields correct convergence even at the boundary, at the cost of re-merging the boundary rows once. **Severity: low** — observable as duplicated work, not data loss.

If a sender ever returns a row with `updated_at === undefined`, [checkEntityValues](../../wallet-toolbox/src/storage/methods/getSyncChunk.ts#L287) throws via `checkIsDate`. So a `null` or `undefined` updated_at is fail-fast at the sender.

### 1.3 Pagination — `paged.limit` and `paged.offset`

Sender computes `limit = Math.min(itemCount, Math.max(10, args.maxItems / a.maxDivider))` per chunker call ([getSyncChunk](../../wallet-toolbox/src/storage/methods/getSyncChunk.ts#L240)). The 10-item floor is important: even tiny remaining budgets still try at least 10 rows. `offset` starts at the per-entity `count` value carried in the previous `EntitySyncMap.count`.

| Provider | Limit semantics | Offset semantics |
|---|---|---|
| Knex | `q.limit(args.paged.limit); q.offset(args.paged.offset || 0)` ([line 564-565](../../wallet-toolbox/src/storage/StorageKnex.ts#L564-L565)) | Raw SQL OFFSET — DB sorts by primary key by default. |
| Idb | `if (args.paged?.limit && count >= args.paged.limit) break` (see [filterOutputBaskets](../../wallet-toolbox/src/storage/StorageIdb.ts#L1555)) | Walks cursor and increments `skipped` until `>= offset`. |
| BunSqlite | `LIMIT ?` always when paged, `OFFSET ?` only `if (args.paged.offset)` (see [selectQuery](../../packages/wallet-node/src/storage-bun-sqlite.ts#L927-L933)) | OFFSET 0 is omitted — equivalent to OFFSET 0 in SQLite. |

**Observable difference (severity: medium):** Knex and BunSqlite perform LIMIT/OFFSET in SQL. SQLite/MySQL guarantee a consistent row order only if `ORDER BY` is specified. **Neither Knex `setupQuery` nor BunSqlite `selectQuery` specify ORDER BY for sync paths** (only when `args.orderDescending` is set, which `getSyncChunk` never does). For a stable sync chunk you rely on the engine returning rows in insertion / rowid order. SQLite happens to do that for tables without explicit ORDER BY, but MySQL/Postgres do not guarantee it. Idb walks the natural store order, which is keyPath-ascending — also stable in practice.

If two sync chunks for the same `since` are issued and SQL order is unstable, the same row can be both skipped and re-counted, breaking convergence within a session. Fix direction: add an explicit `ORDER BY <pk>` clause to both Knex and BunSqlite generic finders for `getSyncChunk` callers.

### 1.4 `processSyncChunk` (receiver)

[EntitySyncState.processSyncChunk](../../wallet-toolbox/src/storage/schema/entities/EntitySyncState.ts#L323-L388) builds 12 [MergeEntity](../../wallet-toolbox/src/storage/schema/entities/MergeEntity.ts#L11) instances in the same dependency order as the sender, plus user (handled out-of-band first). For each:

1. Sets `esm.maxUpdated_at = max(prev, ei.updated_at)`.
2. Calls entity's `mergeFind` to look up locally-existing row (mostly via natural keys, never via foreign primary id).
3. If found → `mergeExisting`; else → `mergeNew`.
4. If entity has its own primary id (`eiId > -1`), records `idMap[eiId] = eo.id`.

Important: `MergeEntity.updateSyncMap` ([line 32-35](../../wallet-toolbox/src/storage/schema/entities/MergeEntity.ts#L32)) refuses to overwrite an existing mapping with a different value. So a duplicate incoming entity in the same chunk that resolves to the same local id is a silent no-op; one resolving to a different local id is a hard `WERR_INTERNAL` — that should never occur in a well-formed chunk.

After all entities, `processSyncChunk` advances `this.when = maxUpdated_at` ONLY if every entity returned an empty array (`done = true`). Otherwise it leaves `when` alone and only updates per-entity `count` offsets — meaning the next chunk is for the same `since` window but at a higher offset. **Cross-chunk idMap persistence** is provided by `EntitySyncState.syncMap` itself, which is serialized to `sync_states.syncMap` and reloaded on every iteration via `EntitySyncState.fromStorage` (see [WalletStorageManager.syncFromReader](../../wallet-toolbox/src/storage/WalletStorageManager.ts#L688-L702)).

## 2. Per-entity audit

### 2.1 EntityProvenTx

[mergeFind](../../wallet-toolbox/src/storage/schema/entities/EntityProvenTx.ts#L192) keys on `txid` (no userId — provenTx is shared). [mergeExisting](../../wallet-toolbox/src/storage/schema/entities/EntityProvenTx.ts#L213) is a no-op (proven txs are immutable). [mergeNew](../../wallet-toolbox/src/storage/schema/entities/EntityProvenTx.ts#L207) inserts and notes `TODO: validate`.

**Gap:** the mergeNew comment is correct that incoming provenTx data is trusted. A malicious sender could push a fake merkle proof. Out of scope for this audit but worth flagging.

### 2.2 EntityProvenTxReq

[mergeFind](../../wallet-toolbox/src/storage/schema/entities/EntityProvenTxReq.ts#L467) keys on `txid` only (no userId — req is shared the same way provenTx is, even though only relevant via `transactions` join). [mergeExisting](../../wallet-toolbox/src/storage/schema/entities/EntityProvenTxReq.ts#L541) merges history + notify and unconditionally calls `updateProvenTxReq` (returns false meaning "not counted as updated", but writes happen anyway — minor `updates` counter underreporting).

**provenTxId resolution path:** [mergeNew line 523](../../wallet-toolbox/src/storage/schema/entities/EntityProvenTxReq.ts#L523) does `if (this.provenTxId) this.provenTxId = syncMap.provenTx.idMap[this.provenTxId]`. If the upstream provenTx was sent in an *earlier* chunk, `syncMap` is loaded from storage at the start of every chunk so the mapping is present. If it was *never* sent (genuinely unmapped), `idMap[id]` is `undefined` and the local provenTxId becomes `undefined` — silent loss of the linkage. Severity: medium. The local req row is created with no provenTx FK, the local monitor will eventually try to re-prove it on its own (status='unknown'). Not a corruption, but quietly degrades to re-prove.

### 2.3 EntityTransaction

[mergeFind](../../wallet-toolbox/src/storage/schema/entities/EntityTransaction.ts#L236) keys on `(reference, userId)` — correct user scope. [mergeExisting](../../wallet-toolbox/src/storage/schema/entities/EntityTransaction.ts#L263) gates on `ei.updated_at > this.updated_at` (LWW). Updates resolve `provenTxId` via syncMap.

**Same provenTxId-orphan case:** at [line 282](../../wallet-toolbox/src/storage/schema/entities/EntityTransaction.ts#L282), `ei.provenTxId ? syncMap.provenTx.idMap[ei.provenTxId] : undefined` — if the foreign provenTxId is set but missing from idMap, this writes `undefined` to local `provenTxId`. The transaction record loses the proof linkage. Same severity as the req case.

### 2.4 EntityOutput

[mergeFind](../../wallet-toolbox/src/storage/schema/entities/EntityOutput.ts#L231) keys on `(userId, transactionId, vout)` where `transactionId` is the *mapped* local id. Critical correctness point: this works only if the parent transaction was sent in the same or an earlier chunk and its mapping is in `syncMap.transaction.idMap`. The chunker order in [getSyncChunk](../../wallet-toolbox/src/storage/methods/getSyncChunk.ts#L121-L137) puts `transaction` before `output`, so within a single chunk this is fine. Across chunks, the syncMap persistence covers it.

If an output's parent transactionId is not in idMap, `transactionId` becomes `undefined` and the lookup returns nothing → falls into `mergeNew`, which then writes `undefined` for transactionId via [line 256](../../wallet-toolbox/src/storage/schema/entities/EntityOutput.ts#L256). The row will be rejected by NOT NULL constraints in Knex/SQLite, but Idb has no schema-level NOT NULL, so an orphan output may be silently inserted. Severity: high for IDB.

### 2.5 EntityOutputBasket / EntityOutputTag / EntityTxLabel

All key on `(name|tag|label, userId)` ([OutputBasket](../../wallet-toolbox/src/storage/schema/entities/EntityOutputBasket.ts#L105), [OutputTag](../../wallet-toolbox/src/storage/schema/entities/EntityOutputTag.ts#L84), [TxLabel](../../wallet-toolbox/src/storage/schema/entities/EntityTxLabel.ts#L84)). All use LWW `mergeExisting`. Consistent and safe.

OutputBasket `mergeExisting` (line 134) updates `isDeleted` — equality check at [line 89](../../wallet-toolbox/src/storage/schema/entities/EntityOutputBasket.ts#L89) does NOT include `isDeleted`. Asymmetry: `equals()` will report rows as equal even though `mergeExisting` would have updated `isDeleted`. `equals` is only used by tests and verification helpers, not by the live merge path, so this is benign in production but is a latent bug if tests rely on `equals` to catch sync drift. Severity: low.

### 2.6 EntityOutputTagMap / EntityTxLabelMap

Both are pure join tables with no own id. [mergeFind for OutputTagMap](../../wallet-toolbox/src/storage/schema/entities/EntityOutputTagMap.ts#L79) and [TxLabelMap](../../wallet-toolbox/src/storage/schema/entities/EntityTxLabelMap.ts#L79) key on the resolved `(outputId, outputTagId)` / `(transactionId, txLabelId)` pair. Both return `eiId: -1` to signal MergeEntity not to update an idMap.

**Orphan map row scenario (representative #3 and #4):** if either parent id is missing from the relevant idMap, the resolved value is `undefined`. The find then becomes `partial: { outputId: undefined, outputTagId: undefined }` — except all three providers' `assertNoUndefinedInPartial` ([Idb line 526](../../wallet-toolbox/src/storage/StorageIdb.ts#L518), [BunSqlite buildWhere line 803](../../packages/wallet-node/src/storage-bun-sqlite.ts#L803)) now throw `WERR_INVALID_PARAMETER`. Knex still passes `partial: {outputId: undefined, outputTagId: undefined}` to `setupQuery` which calls `q.where(args.partial)` — Knex itself silently drops undefined keys, returning **all rows**, then `verifyOneOrNone` throws if multiple results exist or returns one arbitrary row.

**Severity: high.** Idb and BunSqlite reject orphan map rows loudly; Knex still tolerates them and may either silently match a wrong row or throw a confusing "Result must be unique" error. The fix is to add an explicit `if (!outputId || !outputTagId)` guard at the top of each map's `mergeFind` that returns `found:false, eo: <newly constructed>` only when both ids are valid, and otherwise skip (log + drop) the orphan. The same applies to `EntityCertificateField.mergeFind` for unmapped `certificateId`.

### 2.7 EntityCertificate / EntityCertificateField

Cert: key on `(serialNumber, certifier, userId)` — robust natural key. CertField: key on `(certificateId, userId, fieldName)` where certificateId is mapped. Same orphan risk as 2.6 if cert was not sent in an earlier chunk.

### 2.8 EntityCommission

[mergeFind](../../wallet-toolbox/src/storage/schema/entities/EntityCommission.ts#L109) keys on `(transactionId, userId)` where transactionId is mapped. Same orphan risk as 2.6.

### 2.9 EntityUser

Special handling at top of `processSyncChunk` ([line 354-363](../../wallet-toolbox/src/storage/schema/entities/EntitySyncState.ts#L354)). Never inserted by sync (`mergeNew` throws). `mergeExisting` updates `activeStorage` if remote is newer OR local has none. Note `syncFromReader` overwrites `chunk.user.activeStorage` to local before merging ([line 695](../../wallet-toolbox/src/storage/WalletStorageManager.ts#L695)) — so reader-direction syncs cannot change activeStorage.

## 3. Provider-specific differences in the `getXForUser` helpers

### 3.1 `getProvenTxsForUser`

| Provider | Mechanism |
|---|---|
| Knex | `WHERE EXISTS (SELECT * FROM transactions WHERE proven_txs.provenTxId = transactions.provenTxId AND transactions.userId = ?)` ([line 147-163](../../wallet-toolbox/src/storage/StorageKnex.ts#L147)). Single SQL query. |
| BunSqlite | Same SQL via `EXISTS` subquery ([line 1405-1432](../../packages/wallet-node/src/storage-bun-sqlite.ts#L1405)). Equivalent. |
| Idb | Cursor walks every `proven_txs` row, then for each calls `countTransactions({partial:{userId, provenTxId}})` ([line 730-733](../../wallet-toolbox/src/storage/StorageIdb.ts#L730)). N+1 query pattern over a shared table. |

**Observable difference:** in IDB, with two accounts sharing the same provenTx (legitimate — provenTxs are global by txid), the count check inside `filterProvenTxs` uses `partial:{userId, provenTxId:r.provenTxId}` and is therefore correctly user-scoped. The result is the same as Knex/BunSqlite, just slow.

**Latent bug in IDB filterProvenTxs:** [line 731](../../wallet-toolbox/src/storage/StorageIdb.ts#L731) declares `const count = await this.countTransactions(...)` inside the cursor loop, **shadowing the outer `let count = 0`** at [line 697](../../wallet-toolbox/src/storage/StorageIdb.ts#L697). The outer `count` is what enforces `paged.limit`. Since the inner is a `const` in a new block scope, the outer is unaffected — the bug does not actually break pagination. But it's confusing and one rename refactor away from being broken. Severity: low (style/maintainability).

### 3.2 `getProvenTxReqsForUser`

Same pattern, joining `proven_tx_reqs.txid = transactions.txid AND transactions.userId = ?`. Knex and BunSqlite use SQL EXISTS; IDB does N+1 via `countTransactions({partial:{userId, txid}})` at [line 663-666](../../wallet-toolbox/src/storage/StorageIdb.ts#L663). Behaviorally equivalent.

The prior fix `&& r.txid` guard for filterProvenTxReqs is in IDB ([the cursor loop checks all partial keys including txid](../../wallet-toolbox/src/storage/StorageIdb.ts#L656)). Knex relies on FK consistency. BunSqlite SQL only joins on txid, no null guard — but a reqs row with NULL txid would never be requested for sync anyway.

### 3.3 `getTxLabelMapsForUser` / `getOutputTagMapsForUser`

All three use the same `EXISTS` (SQL) or `countX` (Idb) shape against the parent `tx_labels` / `output_tags` table. Identical user scope, identical paged/since semantics.

**Note on the prior fix:** `filterOutputTagMaps` in [StorageIdb.ts line 575-578](../../wallet-toolbox/src/storage/StorageIdb.ts#L575) does the userId check via `countOutputTags({partial:{userId, outputTagId:r.outputTagId}})`. The check is currently in place; that's the fix that was tracked.

### 3.4 Soft-deleted rows in sync chunks

None of the `getXForUser` helpers nor the generic `findX` family filter on `isDeleted=false`. Soft-deleted rows are included in sync chunks. The receiver's `mergeExisting` then propagates the `isDeleted=true` flag (verified for [OutputBasket](../../wallet-toolbox/src/storage/schema/entities/EntityOutputBasket.ts#L146), [OutputTag](../../wallet-toolbox/src/storage/schema/entities/EntityOutputTag.ts#L114), [TxLabel](../../wallet-toolbox/src/storage/schema/entities/EntityTxLabel.ts#L114), [TxLabelMap](../../wallet-toolbox/src/storage/schema/entities/EntityTxLabelMap.ts#L116), [OutputTagMap](../../wallet-toolbox/src/storage/schema/entities/EntityOutputTagMap.ts#L116), [Certificate](../../wallet-toolbox/src/storage/schema/entities/EntityCertificate.ts#L181)). This is correct behavior.

The Go wallet-toolbox `.Unscoped()` call mentioned in the prompt is the GORM equivalent of "include soft-deleted rows" — TS providers don't apply soft-delete filtering at the find layer in the first place, so no equivalent is needed.

## 4. count vs find filter consistency

`mergeFind` uses `findX` which always returns at most one row per natural key (then `verifyOneOrNone` throws if multiple). The `countX` methods that back the `*ForUser` helpers in IDB run the same `filterX` function with the same partial — verified by inspection at [countOutputTags](../../wallet-toolbox/src/storage/StorageIdb.ts#L2142), [countTxLabels](../../wallet-toolbox/src/storage/StorageIdb.ts#L2168), [countTransactions](../../wallet-toolbox/src/storage/StorageIdb.ts#L2156). BunSqlite countX uses the same `selectQuery` + COUNT(*) variant. Knex countX uses the same `setupQuery` + count('*'). All three preserve filter consistency between find and count.

## 5. Cross-runtime field-name / format differences

| Field | TS shape | Concern |
|---|---|---|
| `created_at` / `updated_at` | `Date` instance | Knex returns native Date (mysql) or string (sqlite) — both providers use `validateDate` to normalize. Bun SQLite stores as ISO string and parses to Date in `validateEntity`. JSON wire (between TS sender and TS receiver) goes through `Date.parse`, no field name issue. |
| `rawTx` / `merklePath` / `lockingScript` | `number[]` | All providers store as Buffer/Blob. Wire format is `number[]`. Verified consistent via `arraysEqual` checks in equals methods. |
| Booleans | `0/1` in SQL, `boolean` in JS | All providers normalize via `validateEntity` `booleanFields` parameter. Consistent. |
| `inputBEEF` / `notify` / `history` | optional `number[]` / JSON string | EntityProvenTxReq has `apiHistory`/`apiNotify` round-trip via JSON.parse/stringify. Consistent. |
| `userId` (FK) | int | Idb stores as integer keyPath. Knex uses BIGINT. BunSqlite uses INTEGER. No mismatch. |

A Go-wallet-toolbox sender (canonical Go reference) should produce the same shape modulo: snake_case-vs-camelCase (Go uses snake_case JSON tags but the field-by-field map matches), and `time.Time` JSON encoding (RFC3339 with timezone). Receivers will parse via `new Date(...)` which handles RFC3339 fine. No known wire-level incompatibilities for the standard chunk shape.

## 6. Severity-ranked findings

| # | Finding | Severity | Fix direction |
|---|---|---|---|
| 1 | Unmapped foreign id (provenTxId, transactionId for output/commission, certificateId for certificateField) silently becomes `undefined` in `mergeNew`/`mergeExisting`, and for join tables hits `verifyOneOrNone` paths inconsistently across providers (Knex tolerates, Idb/BunSqlite throw). | High | Add explicit unmapped-id guard at the top of each `mergeNew`/`mergeFind` that involves syncMap-resolved FKs. Drop the row + log; do not insert orphan. Critical for IDB which has no NOT NULL FK enforcement. |
| 2 | `getXForUser` SQL queries (Knex + BunSqlite) lack `ORDER BY` for paginated chunks. Result order across calls is engine-defined. | Medium | Add `ORDER BY <pk>` to `setupQuery` and `selectQuery` whenever `paged` is set, regardless of `orderDescending`. |
| 3 | `EntityProvenTxReq.mergeExisting` always calls `updateProvenTxReq` even when nothing changed, then returns `false`, causing the `updates` counter to under-report. | Low | Compare history/notify before update; only write when changed; return true on actual write. |
| 4 | `EntityOutputBasket.equals` does not check `isDeleted` even though `mergeExisting` updates it. | Low | Add `isDeleted` to the equals comparison. |
| 5 | IDB `filterProvenTxs` reuses `count` identifier in inner scope ([StorageIdb.ts L731](../../wallet-toolbox/src/storage/StorageIdb.ts#L731)). Currently harmless, future refactor hazard. | Low | Rename inner to `txCount`. |
| 6 | `since` filter is `>=` not `>`, so boundary rows are re-merged on each cursor advance. | Low | Either accept the redundant work or change to `>` and accept that rows updated within the same millisecond as the `when` advance are skipped (the lesser evil is the current behavior). |
| 7 | `processSyncChunk` clears per-entity `count` only when `done=true`. If `getSyncChunk` ever returns zero items for entity X but more for entity Y in the same chunk, the X offset is preserved across the cycle, which matches sender expectations (since `done` only flips when ALL entities are empty). Verified correct. | None | — |
| 8 | EntityProvenTx.mergeNew accepts unvalidated proof data from a peer. | Out of scope | Validate merklePath against rawTx + known block headers before insert. |

## 7. Representative scenario verdicts

1. **Multi-account IDB shared auto-increment store.** Safe. All `getXForUser` helpers correctly count via parent table user-scope. Shared provenTx/provenTxReq are intentional.
2. **A's chunk to a server holding B's data.** Safe at sender (everything user-scoped). At receiver, `mergeFind` is `(natural-key, userId=B)`-scoped, so A's incoming row matched against B's local row will not collide. BUT receiver sets `userId = this.userId` in mergeNew — assumes the server's syncFromReader/syncToWriter loop initializes `EntitySyncState.userId` correctly. Verified at [line 67-70 of EntitySyncState](../../wallet-toolbox/src/storage/schema/entities/EntitySyncState.ts#L67) — uses identityKey from auth.
3. **Orphan output_tags_map row.** As above (#1 severity high). Fix needed.
4. **Orphan tx_labels_map row.** Same.
5. **Cross-chunk provenTxId.** Safe. syncMap is reloaded from sync_states each chunk.
6. **Truly-unmapped provenTxId.** Silently nulled out. See #1.
7. **Soft-deleted row in sync chunk.** Sent and merged correctly; isDeleted flag propagates.
8. **`since` boundary.** `>=` means boundary rows re-evaluate. LWW guard makes this a no-op. Safe.
9. **paged.limit/offset across providers.** Behavioral risk #2 (ordering). Fix recommended.
10. **Go ↔ TS wire compatibility.** No known field-name issues. Date format compatible.
11. **mergeFind multi-row.** `verifyOneOrNone` throws in all three. Symmetric.
12. **Parent exists with different updated_at.** LWW handled per-entity in `mergeExisting`.
13. **Older incoming updated_at.** All providers' `mergeExisting` short-circuit; no write.

## 8. Recommendations summary

1. **Add unmapped-id guards** in every `mergeNew` and `mergeFind` that resolves a foreign id via syncMap. This is the highest-impact correctness fix and the one most likely to cause real data corruption in IDB today.
2. **Add `ORDER BY <pk>`** to `setupQuery` (Knex) and `selectQuery` (BunSqlite) whenever `paged` is set. Idb already iterates in keyPath order.
3. **Audit equality methods** for parity with `mergeExisting` field lists. `EntityOutputBasket` is one example; review the rest.
4. Rename inner `count` in `filterProvenTxs`.
5. Long-term: validate `EntityProvenTx` insertions against block headers before accepting from a peer.

The previously cited fixes (`filterOutputTagMaps` user scope, `filterProvenTxReqs && r.txid`, `assertNoUndefinedInPartial` everywhere) all check out and remain in place. The remaining sharp edges are all in the receiver-side merge logic for foreign-id resolution, not in the chunk construction or filter layers.
