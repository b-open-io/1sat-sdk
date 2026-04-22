# Storage Provider Divergence Audit

**Date:** 2026-04-21
**Scope:** Functional differences between three `StorageProvider` implementations:

- **StorageKnex** (canon) — `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageKnex.ts`
- **StorageIdb** — `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageIdb.ts`
- **StorageBunSqlite** — `/Users/davidcase/Source/1sat/1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts`

Severity legend: `CRIT` = data leak / corruption / sync failure, `HIGH` = silent wrong-result, `MED` = behavioral inconsistency without known exploit, `LOW` = latent edge case.

---

## 1. User-scope filtering on join tables (sync chunk construction)

### 1.1 `filterOutputTagMaps` dead-code user filter — CRIT

- **Knex (`getOutputTagMapsForUser`, L213–227):** Applies `WHERE EXISTS (SELECT * FROM output_tags WHERE output_tags.outputTagId = output_tags_map.outputTagId AND output_tags.userId = ?)`. Correct scope.
- **Idb (`filterOutputTagMaps`, L553–556):** Guard is `if (userId !== undefined && r.txid)` but `TableOutputTagMap` has **no `txid` column** — the condition is always false. The scope filter never runs. Every `getOutputTagMapsForUser` call returns rows across all users.
- **BunSqlite (`getOutputTagMapsForUser`, L1488–1519):** Correct `EXISTS` join matching Knex.
- **Fix direction:** Change Idb L553 to `if (userId !== undefined)` and drop the `r.txid` truthiness guard (same pattern BunSqlite uses; requires a sub-count against `output_tags` filtered by `userId`).

### 1.2 `filterTxLabelMaps` user filter — MED

- **Knex:** Same `WHERE EXISTS` pattern via `tx_labels`, correct.
- **Idb (L760):** Guard is `if (userId !== undefined)` — no `r.txid` bug here. The scope filter is structurally correct.
- **BunSqlite:** Correct `EXISTS` join.
- **Severity downgrade:** Originally suspected as a twin of 1.1 — confirmed not the same pattern. The Idb code is correct for this table.

### 1.3 `filterProvenTxReqs` / `filterProvenTxs` user scope — LOW

- **Idb:** Guards are `if (userId !== undefined && r.txid)` (L638) and `if (userId !== undefined)` (L702). The `r.txid` check on proven_tx_reqs is benign because every req has a txid, but it's a silent filter-skip risk if a malformed req lacks txid.
- **Fix direction:** Drop `r.txid` from the userId guard. txid presence is separately a data invariant; if violated it should not silently bypass user scoping.

---

## 2. `partial` filter semantics — undefined and zero values

### 2.1 `undefined` partial values — HIGH

- **Knex:** `setupQuery` does `q.where(args.partial)` unconditionally after an `Object.keys(args.partial).length > 0` check. Knex then throws `"Undefined binding(s) detected"` if any value is `undefined`. Loud failure.
- **Idb:** Every `filter*` method uses per-key `if (args.partial.X && ...)` or `if (args.partial.X !== undefined && ...)` guards. If a caller passes `{ foo: undefined }`, the check is a no-op and the filter silently over-matches.
- **BunSqlite:** `buildWhere` does `Object.keys(partial).filter((k) => partial[k] !== undefined)`. Silently drops `undefined` keys; over-matches.
- **Impact:** Callers that construct a partial with optional fields (e.g. `{ userId, txid }` where txid might be undefined) get wildly different semantics: Knex aborts, Idb/Bun return unintended rows. Known affected shape: helpers that shadow an optional outpoint field.
- **Fix direction:** Decide the canonical contract. Either (a) throw on `undefined` partial values in all three, or (b) silently skip in all three. Current Knex behavior is the de facto canon (per the task statement) — align Idb/Bun by pre-validating partials and throwing. Alternatively, normalize upstream.

### 2.2 Truthiness guards fail on zero / empty-string partials — MED

- **Idb `filterTransactions` L1857–1869:** Most fields use `if (args.partial.X && r.X !== args.partial.X)`. Auto-increment IDs (1-based) are safe. But `lockTime === 0`, `version === 0`, `provenTxId === 0`, `description === ""` all bypass filtering.
- **Idb `filterOutputs` L1585–1604:** Same pattern. `spentBy === 0` would bypass (N/A in practice since transactionId starts at 1), but also `derivationPrefix === ""` or `customInstructions === ""` bypass the filter.
- **Idb `filterOutputTagMaps` L547–548, `filterTxLabelMaps` L754–755, `filterProvenTxReqs` L624–634, `filterProvenTxs` L693–700:** Same truthiness pattern on IDs and strings.
- **Knex:** Passes everything to `q.where(args.partial)` — zero/empty-string match exactly as expected.
- **BunSqlite:** `buildWhere` generates `col = ?` for any non-undefined value including `0` and `""`, so it matches Knex.
- **Fix direction:** Replace `if (args.partial.X && ...)` with `if (args.partial.X !== undefined && ...)` throughout Idb `filter*` bodies. (Some fields like `satoshis`, `spendable`, `change`, `isDeleted` already use `!== undefined` — the drift is the numeric-ID and string fields.)

### 2.3 Idb `filterOutputs` + empty `txStatus` array — HIGH

- **Knex / BunSqlite:** Check `args.txStatus && args.txStatus.length > 0` before applying the `IN (...)` subquery. Empty array is a no-op.
- **Idb (`filterOutputs` L1609, L1628):** Applies the filter whenever `args.txStatus !== undefined`. When `args.txStatus = []`, it calls `countTransactions({ status: [] })`. In `filterTransactions` L1855, `if (args.status && !args.status.includes(...)) continue` — since `[]` is truthy, every row is skipped. `countTransactions` returns 0, `filterOutputs` skips every output.
- **Observable impact:** Any caller that normalizes `txStatus` to `[]` instead of `undefined` gets zero rows on Idb but all rows on Knex/Bun.
- **Fix direction:** Guard with `if (args.txStatus && args.txStatus.length > 0)` in `filterOutputs`.

### 2.4 `findCommissions.partial.lockingScript` — consistent

All three providers throw `WERR_INVALID_PARAMETER` on `partial.lockingScript`. OK. Same for `findOutputs.partial.lockingScript`, `findProvenTxs.partial.rawTx`/`merklePath`, `findProvenTxReqs.partial.rawTx`/`inputBEEF`, `findTransactions.partial.rawTx`/`inputBEEF`.

---

## 3. Update return value semantics

### 3.1 Idb update methods always return 1 — MED

- **Knex:** Returns the SQL `UPDATE ... WHERE` affected-row count (so bulk update on N ids returns N).
- **BunSqlite:** Returns `changes()` count from bun:sqlite — matches Knex.
- **Idb (`updateIdb` L1040, `updateIdbKey` L1078):** Always returns `1`. For bulk updates over an id array it still returns `1`. Any caller that compares the return count to the input length will false-positive on Idb.
- **Impact:** `updateTransactionsStatus` in the base class doesn't check return counts, so low-risk for existing code. Anything new asserting counts would drift.
- **Fix direction:** Return `ids.length` when looping, propagate actual put-success count.

### 3.2 Empty `updateRows` set is a no-op in BunSqlite — LOW

- **BunSqlite (`updateRows` L1032):** `if (setClauses.length === 0) return 0` before issuing SQL. Even `validatePartialForUpdate` always injects `updated_at`, so normally a non-empty set. But passing `{ created_at: undefined }` after `filterToSchema` could yield empty and skip the update.
- **Knex:** Still runs the UPDATE (knex throws on empty update). Idb: always writes a row via `put`, so updated_at advances.
- **Fix direction:** Ensure `validatePartialForUpdate` always writes `updated_at` and that filter passes through.

---

## 4. Schema / migration drift

### 4.1 `outputs.outputDescription` and `spendingDescription`

- **Knex canon (KnexMigrations.ts L375, L383):** `outputDescription VARCHAR(300)` nullable; `spendingDescription VARCHAR(255)` nullable.
- **BunSqlite (L427, L435):** `outputDescription TEXT` nullable; `spendingDescription TEXT` nullable. Type semantics equivalent in SQLite.
- **Idb:** Untyped JS objects, no schema constraint.
- **Compatibility:** Functionally equivalent. OK.

### 4.2 `proven_tx_reqs.rawTx` nullability — schema drift

- **Knex (L285):** `rawTx BLOB NOT NULL`.
- **BunSqlite (L311):** `rawTx BLOB NOT NULL`. Match.
- **Idb:** JS, no constraint. OK.

### 4.3 `commissions.lockingScript` nullability — match

All three: `NOT NULL`. OK.

### 4.4 Indexes

- **Knex adds:** `output_tags_map(outputId)`, `tx_labels_map(transactionId)`, `sync_states(status)`, `sync_states(refNum)`, `proven_tx_reqs(status)`, `proven_tx_reqs(batch)`, `transactions(status)`.
- **BunSqlite:** Has the same set plus `monitor_events(event)`, `proven_txs(blockHash)`, `outputs(spendable)`, `transactions(txid)`, `proven_tx_reqs(txid)`, `transactions(userId)`, `outputs(userId)` (later migrations).
- **Idb:** Declares indexes in `onupgradeneeded` for `userId`, `status`, `txid`, `transactionId`, `provenTxId`, `reference`, `basketId`, `spentBy`, `outputId`, `outputTagId`, `transactionId_vout_userId`, `tag_userId`, `status_userId`, `batch`.
- **Impact:** BunSqlite and Idb have additional indexes for faster cursor/lookup paths. No functional difference. The `outputs_userId` index in BunSqlite matters for Idb parity where `filterOutputs` opens a cursor on `userId`.
- **Fix direction:** None required, but BunSqlite's extra indexes are in post-initial migrations — confirm they apply on existing DBs via IF NOT EXISTS.

### 4.5 Nullability pattern in BunSqlite `insertRow` — LOW

- **BunSqlite (`insertRow` L976):** `const filteredKeys = Object.keys(scoped).filter((k) => scoped[k] != null)`. Filters out **both** `null` and `undefined`. Columns that the caller explicitly sets to `null` are silently dropped from the INSERT, relying on schema DEFAULT or NULL.
- **Knex:** `validateEntityForInsert` rewrites `undefined -> null` and passes through null — knex binds them explicitly.
- **Idb:** Object-store `add` preserves nulls as-is.
- **Impact:** For columns with `NOT NULL DEFAULT ...` in BunSqlite, a caller setting the field to `null` gets the DEFAULT. Knex would attempt to insert null (fails). In practice no caller does this for NOT NULL columns, but the drift means different error behavior.
- **Fix direction:** BunSqlite should include explicit NULL columns (filter only `undefined`, keep `null`). Low priority.

---

## 5. `purgeData` — implementation parity

- **Knex (`methods/purgeData.ts`):** Full implementation with `purgeCompleted`, `purgeFailed`, `purgeSpent`, and orphan `proven_txs` cleanup.
- **BunSqlite (L3205–3368):** Mirrors the Knex flow including spent-beef walk, orphan proven_txs delete. Equivalent.
- **Idb (`methods/purgeDataIdb`):** Separate implementation file. Not reviewed in full here; worth a follow-up parity check for `purgeSpent` BEEF walk, which uses `getBeefForTransaction` — needs confirmation that Idb's variant preserves the same pruning criteria.
- **Fix direction:** Check `purgeDataIdb.ts` separately; confirm spentBy orphan cleanup and completed-request deletion semantics match.

---

## 6. Transaction semantics

- **Knex (`transaction` L914):** If a `trx` is passed, reuses it; else delegates to `knex.transaction`. Nested `trx` calls reuse the outer scope. Rollback on thrown error.
- **Idb (`transaction` L1186):** If `trx` passed, reuses. Else opens an IDB transaction over **all** stores (`this.allStores`) in `readwrite`. On error, `tx.abort()` + throw. Works, but opening a transaction over every store serializes all unrelated writes during any `transaction()` call.
- **BunSqlite (`transaction` L733):** Uses nested `SAVEPOINT sp_<ts>_<rand>` with `RELEASE`/`ROLLBACK TO SAVEPOINT` on throw. Supports nested because each call creates a unique savepoint name.
- **Divergence:** Idb opens a global RW lock for every transaction scope — parity-functional but potential contention. Knex/Bun are per-table (SQLite global lock but short-lived).
- **Impact:** All three are functionally transactional. No correctness drift for single-threaded use. Perf note only.

---

## 7. `processSyncChunk` override

None of the three providers override `processSyncChunk`; they all use the base-class `StorageProvider.processSyncChunk` (line 624). Inheritance chain verified. The **inputs** to sync-chunk construction — notably `getOutputTagMapsForUser` and `getTxLabelMapsForUser` — are where drift lives (see §1.1).

---

## 8. `listActions` / `listOutputs` spec-op helpers

- **Knex:** Uses `getLabelToSpecOp` / `getListOutputsSpecOp` via external method files (`methods/listActions.ts`, `methods/listOutputs.ts`).
- **BunSqlite:** Imports `getLabelToSpecOp` and `getListOutputsSpecOp` directly from the wallet-toolbox publish (L47–48). Uses the same helpers inline within its own method body. Spec-op behavior is equivalent: spec-op interception, label filter, `setStatusFilter`, `postProcess`. The CTE-based label count matches the Knex `HAVING COUNT(*)` approach.
- **Idb:** Uses the same helpers; its `listActions`/`listOutputs` implementations perform cursor-based filtering. Not exhaustively checked here but the spec-op call signatures match.
- **Finding:** Spec-op resolution is consistent. The three share helper imports.
- **Risk:** Since BunSqlite imports `getLabelToSpecOp` from the compiled `@bsv/wallet-toolbox/out` path, a wallet-toolbox version mismatch could yield mismatched spec-op sets. Pin or bundle.

---

## 9. `findOutputs` script validation

- **Knex (L725–729):** When `!args.noScript`, loops results and calls `validateOutputScript(o, trx)`.
- **BunSqlite (L2129):** Same.
- **Idb (L1657):** Same, plus `o.lockingScript = undefined` when `noScript=true` (explicit wipe).
- **Knex/Bun:** Don't explicitly clear `lockingScript` when `noScript=true`; they use a column-subset SELECT that excludes it.
- **Impact:** Semantically equivalent — row returned without script.

---

## 10. `findOutputsByOutpoints` / base-class helpers

Base class uses `findOutputs({ partial: { userId, txid, vout } })`. This hits §2.1 directly — if any of `userId/txid/vout` is `undefined` (malformed outpoint), Knex throws, Idb/Bun silently return adjacent rows. Callers are expected to validate outpoints upstream, but this is a CRIT risk amplifier for any caller that forgets.

---

## 11. Mixed findings — additional notable drifts

- **`validatePartialForUpdate` dates:** All three set `updated_at = new Date()` when not provided. Match.
- **`validateEntityForInsert` boolean coercion:** Knex/Bun coerce to 0/1 integer; Idb coerces to `!!value` boolean. Both acceptable given schema encoding (SQLite boolean = int, Idb = JS bool).
- **`insertMonitorEvent`:** All three support `id === 0 → auto-increment`. Match.
- **`updateSyncState`:** All three apply `['when']` as a date field and `['init']` as a boolean field. Match.
- **`countChangeInputs`:** Knex uses composite where + subquery for tx status. BunSqlite has inline raw SQL (L2449). Idb implements in its own path. Should match semantics; spot-check recommended if change-selection ever drifts.
- **`allocateChangeInput`:** Non-trivial. Out of scope here; deserves its own parity audit since it drives change selection and direct outpoint locking.
- **`adminStats`:** Knex returns full MySQL stats. BunSqlite throws `NOT_IMPLEMENTED`. Idb throws `Error('intentionally not implemented for personal storage')`. Divergence is intentional per-runtime.

---

## Priority fix list

1. **CRIT** — Idb `filterOutputTagMaps` L553: drop `&& r.txid` from user-scope guard; add user-scope sub-count against `output_tags`. Fixes cross-account leakage in sync chunks.
2. **HIGH** — Align `undefined` partial-value handling across all three (§2.1). Recommend: pre-validate in `setupQuery`/`buildWhere`/Idb filters and either throw uniformly or drop uniformly. Current mixed behavior causes Idb/Bun to silently over-match where Knex would throw.
3. **HIGH** — Idb `filterOutputs` empty `txStatus` array handling (§2.3). One-line guard change.
4. **MED** — Idb truthiness guards on IDs/strings (§2.2). Sweep-replace `if (args.partial.X && ...)` with `if (args.partial.X !== undefined && ...)` across all `filter*` methods.
5. **MED** — Idb update methods return actual row count (§3.1). Needed before any caller depends on `updated === input.length`.
6. **MED** — Audit `purgeDataIdb` against canonical `purgeData` (§5). Separate pass required.
7. **LOW** — Idb proven_tx_reqs user-scope: drop `r.txid` guard (§1.3). Defense in depth.
8. **LOW** — BunSqlite `insertRow` preserve explicit `null` (§4.5). Low-exploit.

---

## Files referenced

- `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageProvider.ts`
- `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageKnex.ts`
- `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageIdb.ts`
- `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageReaderWriter.ts`
- `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/schema/KnexMigrations.ts`
- `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/methods/purgeData.ts`
- `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/methods/purgeDataIdb.ts` (not read in depth)
- `/Users/davidcase/Source/1sat/1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts`
