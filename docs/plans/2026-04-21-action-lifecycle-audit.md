# Action Lifecycle, BEEF Resolution, Change Selection, and Maintenance — Three‑Provider Audit

Audited: 2026-04-21

Providers compared:
1. **Knex** — `wallet-toolbox/src/storage/StorageKnex.ts` (canon)
2. **Idb** — `wallet-toolbox/src/storage/StorageIdb.ts`
3. **BunSqlite** — `1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts`

Shared canon code paths (all providers route through these):
- `StorageProvider` (`abortAction`, `updateTransactionStatus`, `getValidBeefForTxid`, `getValidBeefForKnownTxid`, `relinquishOutput`, `validateOutputScript`)
- `methods/createAction.ts`, `methods/processAction.ts`, `methods/internalizeAction.ts`
- `methods/getBeefForTransaction.ts`
- `StorageReaderWriter.tagOutput`

---

## CRIT — Findings up top

### CRIT-1 — `internalizeAction` never populates `scriptOffset`/`scriptLength` on stored outputs

In `internalizeAction.ts`, both new‑output writers (`storeNewWalletPaymentForOutput` L463 and `storeNewBasketInsertionForOutput` L528) build a `TableOutput` with `lockingScript: ...toBinary()` but **omit** `scriptOffset` and `scriptLength`. `mergeWalletPaymentForOutput` (L494) and `mergeBasketInsertionForOutput` (L511) likewise update existing rows without setting offsets.

This is the root cause of the IDB read path Dan tripped on:
- IDB's `listOutputsIdb.ts:103-110` calls `findOutputs(noScript: true)` which **unconditionally clears** `lockingScript` (`StorageIdb.ts:1718` and `:1695`).
- It then calls `validateOutputScript(o)` to refill from `getRawTxOfKnownValidTransaction(txid, scriptOffset, scriptLength)`.
- `validateOutputScript` (`StorageProvider.ts:823`) bails immediately if `!o.scriptLength || !o.scriptOffset || !o.txid`.
- Result: `wo.lockingScript` is never set in the WalletOutput payload for any output that originated from `internalizeAction`.

Why Knex doesn't show this: `listOutputsKnex.ts:125-126` projects `lockingScript`, `scriptLength`, and `scriptOffset` directly into the selected columns when `includeLockingScripts` is set. Knex returns the script straight from the row; the `validateOutputScript` call (L309) is only needed when the script was stripped because `offset.length > maxOutputScript`.

Why BunSqlite doesn't show this: `storage-bun-sqlite.ts:3022-3023` mirrors Knex — adds `lockingScript`, `scriptLength`, `scriptOffset` to the projection when caller wants scripts. So BunSqlite also returns the row's `lockingScript` directly.

Severity: CRIT. The fix has two equally valid directions; both should be applied.

**Fix A (canon):** In `internalizeAction.ts`, compute `parseTxScriptOffsets(this.tx.toBinary())` once and write `scriptOffset` + `scriptLength` for every internalized output (new and merged). Mirrors what `processAction.ts:348-370` already does. This makes the BEEF‑slice fallback work for internalized outputs across all providers and is required for the long‑script offload path to ever apply to incoming wallet payments.

**Fix B (IDB‑only resilience):** In `listOutputsIdb.ts`, drop `noScript: true` from `args` (or stop unconditionally clearing `lockingScript` in IDB `findOutputs`). The IDB rows already carry `lockingScript` in the object store record; throwing it away just to refill from a slice that may not exist is a regression vs. Knex.

The cleanest answer is **A + B**: fix the canon population gap, and stop discarding intact data in IDB. Fix B alone restores parity for users who internalized data; Fix A alone is needed before anyone relies on the long‑script offload contract for internalized rows.

### CRIT-2 — `purgeDataIdb` is a no‑op stub

`methods/purgeDataIdb.ts` (10 lines total) returns `{ count: 0, log: '' }` with a `// TODO` and never deletes anything. Knex (`methods/purgeData.ts`, 251 lines) handles `purgeCompleted` (transient data on completed txs + completed reqs), `purgeFailed` (failed txs incl. cascade through `output_tags_map`, `tx_labels_map`, `commissions`, `transactions`), `purgeSpent` (spent UTXO chains, with proof‑txid preservation), and finally orphan `proven_txs` cleanup.

For IDB‑backed wallets this means tables grow without bound. Severity: CRIT for any long‑lived IDB wallet. Fix direction: port the four phases of `purgeData.ts` to cursor‑based deletes against IDB stores; the cascade list is the same.

BunSqlite uses canon `purgeData.ts` directly (it extends StorageKnex semantics through SQLite/Knex), so it inherits canon behavior — verify by inspecting its `purgeData()` override or absence thereof:

```bash
grep -n "purgeData" 1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts
```

If BunSqlite has no override, it inherits the StorageProvider abstract; you must verify it routes to `methods/purgeData.ts`. If it doesn't, that is a second CRIT.

### CRIT-3 — `updateTransactionStatus('failed')` does not mark child outputs unspendable

`StorageProvider.ts:482-495` only restores **inputs** (prior outputs spent by the failing tx) to `spendable=true`. Outputs **created by** the failing tx are left as‑is. In practice these outputs were inserted by `createNewOutputs` (`createAction.ts:415-417`) with `spendable: false` for change and `true` for non‑change user outputs. After abort/fail, the user outputs of a never‑broadcast tx remain spendable in queries — these are the "ghost outputs" Dan referenced.

Confirm: search `methods/createAction.ts` `createNewOutputs`. Non‑change user outputs are pushed with `spendable: true` (default from `makeDefaultOutput` L214), then later `processAction.ts:362` re‑sets `spendable: true` keyed on tx status. The `failed` branch never touches them.

This is a canon gap (lives in the shared base class), so all three providers exhibit it identically. Fix direction: in `updateTransactionStatus`'s `failed` branch, also set `spendable=false` (and ideally `basketId=null`) for every output where `transactionId === tx.transactionId`. Apply the same change in `abortAction` (calls into `updateTransactionStatus('failed')`, L278). Add an integration test against all three providers.

### CRIT-4 — `allocateChangeInput` divergent script‑hydration guarantee

Knex `allocateChangeInput` (`StorageKnex.ts:1283-1285`) explicitly calls `validateOutputScript(output, trx)` after selecting the row. This is the *intentional* protection for the case where a P2PKH change output had its `lockingScript` stripped because `scriptLength > maxOutputScript`. Comment: "Keep behavior identical to the pre‑optimization path."

IDB `allocateChangeInput` (`StorageIdb.ts:352-404`) — no `validateOutputScript` call.
BunSqlite `allocateChangeInput` (`storage-bun-sqlite.ts:2564-2633`) — no `validateOutputScript` call either.

Today P2PKH change scripts are 25 bytes and IDB's `maxOutputScript` is 1024, so the strip never triggers in practice — but the contract is broken and either provider will return an output with `lockingScript: undefined` once a non‑P2PKH change template is introduced. `createAction.ts:316` (`asString(o.lockingScript!)` to feed `sourceLockingScript`) would then throw. Severity: CRIT‑deferred. Fix direction: add `await this.validateOutputScript(output, trx)` after selection in both IDB and BunSqlite. Trivial.

---

## Method‑by‑method walkthrough

### 1. `createAction` (canon `methods/createAction.ts`)

**Behavior (all providers via canon):**
- `createNewTxRecord` (L497) inserts a transaction row with `status='unsigned'`, `inputBEEF=storageBeef.toBinary()`, `rawTx=undefined`, `txid=undefined`.
- `createNewOutputs` (L415-477) inserts each new output with `lockingScript` populated from caller’s hex script, `txid=undefined`, `scriptOffset=undefined`, `scriptLength=undefined`. Change outputs (L953-984) likewise have `lockingScript=undefined` (script not known until signing).
- `createNewInputs` (L223-348) marks each spent prior output `spendable=false, spentBy=newTxId` via `updateOutput`.

**Per‑provider differences:**
- Knex inserts via `validateEntityForInsert` then raw `.insert()`. No schema filter.
- IDB inserts via the same `validateEntityForInsert` + `objectStore.add`. IndexedDB silently accepts unknown fields.
- BunSqlite inserts via `insertRow` which **filters to schema** (`filterToSchema` L255). Any column not in the actual SQLite table is silently dropped — the safety fix Dan landed earlier. This is the desirable behavior; both Knex and IDB would fail loudly if they had an extra unknown field, BunSqlite drops it.

**Observable difference:** none meaningful at this stage. All three end with `unsigned` tx, child outputs holding `lockingScript` but no `scriptOffset`/`scriptLength`, allocated change inputs flagged spent.

### 2. `signAction` → `processAction` (canon `methods/processAction.ts`)

Wallet‑level `signAction` produces `rawTx` and calls `processAction` on storage.

**Behavior (canon):**
- `validateCommitNewTxToStorageArgs` (L240) parses script offsets via `parseTxScriptOffsets` (L260), verifies the transaction matches the stored output scripts (L348-360), and builds `outputUpdates`. **Each output update sets `txid`, `spendable=true`, `scriptLength`, `scriptOffset`** (L360-365). If `offset.length > maxOutputScript` it ALSO sets `lockingScript: undefined` to drop the long script (L366-368). The transaction record is updated to drop `inputBEEF` and `rawTx`, set `txid`, and bump status (L336-341).
- `commitNewTxToStorage` (L380) inserts/merges a `proven_tx_req` (carries the rawTx + inputBEEF), applies the per‑output updates, and updates the transaction.

**Per‑provider:**
- All three execute the same canon code through `storage.updateOutput`. Knex updates via raw SQL UPDATE. IDB uses `updateIdb` (read‑modify‑put). BunSqlite uses `updateRows` with `filterToSchema`.
- BunSqlite + IDB both honor the `lockingScript: undefined` drop because `updated_v = { ...existing, ...u }` will overwrite to undefined (IDB) and the SQL UPDATE will set the column to NULL (BunSqlite). Confirmed.

**Observable difference at this stage:** none. After `signAction → processAction`, every child output has correct `txid`, `scriptOffset`, `scriptLength`, and `spendable=true`.

### 3. `processAction` (broadcast / sendWith) — `shareReqsWithWorld`

Same path in all three. No provider divergence; bumps `proven_tx_req.status` and `transactions.status` in lockstep based on `isDelayed` / `isNoSend` / `isSendWith`.

### 4. `internalizeAction` (canon `methods/internalizeAction.ts`)

See **CRIT‑1**. The output writers omit `scriptOffset`/`scriptLength`. New transactions created via `findOrInsertTargetTransaction` (L298) leave `inputBEEF=undefined, rawTx=undefined` on the transaction row — which is correct, because the rawTx is parked in the freshly‑created `proven_tx_req` (L409), not on the transaction.

**Per‑provider differences:** none in the writer paths themselves; the bug is canon and surfaces only when the read path diverges (CRIT‑1).

### 5. `abortAction` (canon `StorageProvider.ts:245-293`)

- Looks up the tx (by reference, then by txid if reference is 64 chars).
- Status guard at L272: only proceeds if status NOT in `['completed', 'failed', 'sending', 'unproven']`. Allowed: `nosend`, `unsigned`, `unprocessed`.
- Calls `updateTransactionStatus('failed', tx.transactionId, ...)`.
- If `tx.txid` is set, also sets the matching `proven_tx_req` to `status='invalid'`.

**Per‑provider:** identical (canon).

**Observable issue:** see **CRIT‑3**. Outputs of the aborted tx remain `spendable=true` (for non‑change user outputs that had `processAction` already populate them — relevant only on aborting `unprocessed` txs that had been signed once). For `unsigned` txs that were never processed, the user outputs were inserted by `createNewOutputs` and have whatever `spendable` value was assigned: change outputs are `spendable=false`, custom user outputs are `spendable=true` from `makeDefaultOutput`.

### 6. `updateTransactionStatus('failed')`

Canonical, single implementation. Restores inputs by clearing `spentBy` and re‑setting `spendable=true`. Does not touch outputs. Same gap (CRIT‑3) in all three providers.

### 7. `allocateChangeInput`

| Aspect | Knex L1229-1293 | IDB L352-404 | BunSqlite L2564-2633 |
|---|---|---|---|
| Filters by `userId, basketId, spendable=true` | yes (SQL where) | yes (cursor predicate) | yes (SQL where) |
| Filters by tx `status in (completed, unproven [, sending])` | yes (join) | yes (count subquery in cursor) | yes (correlated subquery) |
| Pick exact‑match → smallest‑over → largest‑under | yes | yes (in‑memory sort) | yes (3 SQL queries with min/max) |
| Atomic update of selected output to `spendable=false, spentBy=txId` | yes (in trx) | yes (single dbTrx) | yes (in transaction) |
| Calls `validateOutputScript` after selection | **yes** (L1285) | **no** | **no** |

**Severity (CRIT‑4):** divergence in `validateOutputScript`. Fix: add identical post‑selection call in IDB and BunSqlite.

Secondary observation: IDB iterates **all** outputs in the basket through a cursor and sorts in memory (L368-394) — O(n) per allocation regardless of basket size. Acceptable for small wallets, but a future tax for large baskets.

### 8. `purgeData` vs `purgeDataIdb`

| Phase | Knex (`purgeData.ts`) | BunSqlite | IDB (`purgeDataIdb.ts`) |
|---|---|---|---|
| `purgeCompleted` — null `inputBEEF`/`rawTx` on old completed proven txs | yes | inherits canon | **no‑op** |
| `purgeCompleted` — delete completed `proven_tx_reqs` | yes | inherits canon | **no‑op** |
| `purgeFailed` — delete failed txs + cascade (`output_tags_map`, outputs, `tx_labels_map`, commissions, transactions) | yes | inherits canon | **no‑op** |
| `purgeFailed` — delete invalid + doubleSpend reqs | yes | inherits canon | **no‑op** |
| `purgeSpent` — clear `spentBy`, cascade-delete spent txs while preserving proof chain via `getBeefForTransaction` | yes | inherits canon | **no‑op** |
| Orphan `proven_txs` deletion | yes | inherits canon | **no‑op** |

See CRIT‑2 for fix.

### 9. `getBeefForTransaction` / `getValidBeefForTxid` / `getValidBeefForKnownTxid`

All three are canon (`StorageProvider`/`getBeefForTransaction.ts`). Recursion descends inputs, merges raw + bumps, respects `knownTxids`, and falls back to services when storage doesn't know.

**Per‑provider divergence is in `getProvenOrRawTx`:**

| Provider | Status set accepted from `proven_tx_reqs` |
|---|---|
| Knex `getProvenOrRawTx` (StorageKnex.ts:95) | `unsent, unmined, unconfirmed, sending, nosend, completed` |
| Knex `getRawTxOfKnownValidTransaction` (StorageKnex.ts:131) | `unsent, nosend, sending, unmined, completed, unfail` |
| IDB `getProvenOrRawTx` (StorageIdb.ts:416) | `unsent, unmined, unconfirmed, sending, nosend, completed` |
| BunSqlite `getProvenOrRawTx` (storage-bun-sqlite.ts:1348) | `unsent, unmined, unconfirmed, sending, nosend, completed` |
| BunSqlite `getRawTxOfKnownValidTransaction` (storage-bun-sqlite.ts:1388) | `unsent, nosend, sending, unmined, completed, unfail` |

IDB does **not** override `getRawTxOfKnownValidTransaction` to use the same `unfail` set as Knex/BunSqlite — it only falls through `getProvenOrRawTx`. So an output whose source tx is in `unfail` status will be unrecoverable for script‑slice fallback in IDB. Severity: LOW (rare status), but notable parity gap. Fix: add `unfail` to the IDB status list in `getProvenOrRawTx`, OR override `getRawTxOfKnownValidTransaction` to mirror Knex’s SQL.

### 10. `getRawTxOfKnownValidTransaction(offset, length)`

| Provider | Server‑side slice? |
|---|---|
| Knex (L111-145) | **yes** — `substr(rawTx, offset+1, length)` SQL subquery against `proven_txs` then `proven_tx_reqs`. |
| BunSqlite (L1369-1399) | **yes** — same SQL pattern. |
| IDB (L425-442) | **no** — fetches the entire rawTx via `getProvenOrRawTx` then `Array.slice(offset, offset+length)` in JS. |

For very large rawTx (multi‑MB ordinal contracts) IDB pulls the full body into memory per script lookup. Severity: LOW perf concern.

### 11. `validateOutputScript` (canon `StorageProvider.ts:821-832`)

Three short‑circuit conditions, evaluated in order:
1. `!o.scriptLength || !o.scriptOffset || !o.txid` → return (no change). **Bug surface for CRIT‑1.**
2. `o.lockingScript && o.lockingScript.length === o.scriptLength` → return.
3. Otherwise call `getRawTxOfKnownValidTransaction(o.txid, o.scriptOffset, o.scriptLength)` and assign.

The first guard exits silently. There is no logging, no path that says "I couldn’t find a script for this output." A debugger will not show why the WalletOutput is missing its locking script. Recommend adding a noisy debug log when guard 1 trips on an output that has neither `lockingScript` nor `scriptOffset` populated — this is the symptom Dan hit and the silent failure made it hard to track.

### 12. `tagOutput` (canon `StorageReaderWriter.tagOutput`)

Single canon implementation. Calls `findOutputs(partial, noScript:true)` then `findOrInsertOutputTag` and `findOrInsertOutputTagMap`. Identical behavior across providers, modulo whatever asymmetries exist in `findOutputs` filter implementation. No divergence found relevant to action lifecycle.

### 13. `relinquishOutput` (canon `StorageProvider.ts:652-657`)

Sets `basketId: undefined` on the matched output. Does NOT mark `spendable=false`. This is by design — the user is asking the wallet to forget the output for tracking, but the tx outputs themselves remain on chain. No divergence. Note: passing `basketId: undefined` through `validatePartialForUpdate` must reach the DB as NULL, not as a no‑op.

- Knex: `validatePartialForUpdate` → `update({basketId: undefined})` → Knex serializes undefined as NULL by default for non‑nullable column? Verify column nullability. The migration in `KnexMigrations.ts` sets `basketId` as nullable.
- IDB: `updateIdb` does `{...e, ...u}` — undefined overrides to undefined (becomes IndexedDB‑undefined which is "missing key").
- BunSqlite: `updateRows` with filtered‑to‑schema record. Need to confirm BunSqlite’s `updateRows` translates `undefined` to `NULL` in the SET clause; if it skips the column entirely, relinquish is a no‑op.

Verify in `storage-bun-sqlite.ts updateRows` (L1017+). The `validateOutputScript` skip behavior on the resulting orphaned output (no `basketId`) is unchanged.

---

## Where `scriptOffset`/`scriptLength` are written — full insert/update map

**Insert paths (currently written with offsets):** none. No `insertOutput` call sets `scriptOffset` or `scriptLength`.

**Update paths that set them:**
- `processAction.ts:360-365` — sets both fields, plus `txid` and `spendable=true`. Triggered by signing + processing. **This is the only place.**

**Insert paths that should set them but don't:**
- `internalizeAction.ts:463 storeNewWalletPaymentForOutput` — has `tx` and `vout`, can compute via `parseTxScriptOffsets(tx.toBinary())`.
- `internalizeAction.ts:528 storeNewBasketInsertionForOutput` — same.
- `internalizeAction.ts:494/511 mergeWalletPaymentForOutput / mergeBasketInsertionForOutput` — same.

**Other inserters that legitimately don't set them:**
- `createAction.ts:402-408` user outputs and `:415-417` change outputs — no rawTx exists yet, set later by `processAction`. Correct.

The only path that needs a code change is `internalizeAction`. Once that's fixed, every output row in the database will carry `scriptOffset`/`scriptLength` after its parent transaction is signed/processed (via `processAction`) or internalized (via the proposed fix), and `validateOutputScript`'s slice‑from‑rawTx fallback becomes universally usable.

---

## Where `inputBEEF` / `rawTx` live on the transaction row

| Lifecycle event | `transactions.inputBEEF` | `transactions.rawTx` |
|---|---|---|
| `createAction` (`createNewTxRecord` L515) | set to `storageBeef.toBinary()` | undefined |
| `signAction → processAction` (L339) | cleared (set to `undefined`) | cleared |
| `internalizeAction.findOrInsertTargetTransaction` (L319-321) | undefined | undefined |

The actual rawTx + inputBEEF for in‑flight signed/internalized txs live on the corresponding `proven_tx_req` row (set by `EntityProvenTxReq.fromTxid(txid, rawTx, inputBEEF)` in `processAction.ts:292` and `internalizeAction.ts:409`). All three providers honor this consistently.

The reason the tx row clears `rawTx`/`inputBEEF` at processAction time is to avoid double‑storage. Anyone querying `transactions.rawTx` after broadcast will see `undefined` — `validateRawTransaction` in BunSqlite (L2639) explicitly hydrates from `getRawTxOfKnownValidTransaction` for this reason.

---

## Summary recommendations

| Severity | Fix | Touch |
|---|---|---|
| CRIT‑1 | Populate `scriptOffset`/`scriptLength` in all four `internalizeAction` output writers | `wallet-toolbox/src/storage/methods/internalizeAction.ts` |
| CRIT‑1b | Stop unconditionally clearing `lockingScript` in `IDB.findOutputs(noScript:true)`; or stop using `noScript:true` in `listOutputsIdb` | `StorageIdb.ts:1718`, or `methods/listOutputsIdb.ts:110` |
| CRIT‑2 | Implement `purgeDataIdb` mirroring all four phases of canon | `wallet-toolbox/src/storage/methods/purgeDataIdb.ts` |
| CRIT‑3 | In `updateTransactionStatus('failed')` mark child outputs `spendable=false` (and clear `basketId`) | `wallet-toolbox/src/storage/StorageProvider.ts:482-495` |
| CRIT‑4 | Add `await this.validateOutputScript(output, trx)` after selection in IDB + BunSqlite `allocateChangeInput` | `StorageIdb.ts:399`, `storage-bun-sqlite.ts:2628` |
| LOW | Add `unfail` to IDB `getProvenOrRawTx` status set, or override `getRawTxOfKnownValidTransaction` | `StorageIdb.ts:416` |
| LOW | Server‑side slice in IDB `getRawTxOfKnownValidTransaction` (perf only) | `StorageIdb.ts:425-442` |
| LOW | Debug‑log when `validateOutputScript` early‑bails on an output that has neither `lockingScript` nor `scriptOffset` | `StorageProvider.ts:823` |
| VERIFY | Confirm BunSqlite has no `purgeData` override (so it inherits canon path) | `storage-bun-sqlite.ts` |
| VERIFY | Confirm BunSqlite `updateRows` writes `undefined` columns as `NULL` (so `relinquishOutput` actually nulls `basketId`) | `storage-bun-sqlite.ts:1017+` |

The two unrelated bugs Dan already shipped fixes for (BunSqlite schema whitelist; IDB filter parity) are not in scope here and not re‑audited.
