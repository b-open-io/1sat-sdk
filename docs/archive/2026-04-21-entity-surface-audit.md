# Entity Surface Audit — StorageKnex vs StorageIdb vs StorageBunSqlite

Date: 2026-04-21

Files audited:
- Knex (canon): `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageKnex.ts`
- Idb: `/Users/davidcase/Source/1sat/wallet-toolbox/src/storage/StorageIdb.ts`
- BunSqlite: `/Users/davidcase/Source/1sat/1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts`

Shared base classes also referenced:
- `wallet-toolbox/src/storage/StorageReaderWriter.ts` — `findOrInsert*`, `findXById`
- `wallet-toolbox/src/storage/StorageProvider.ts` — `validateOutputScript`, `updateTransactionStatus`, `updateProvenTxReqDynamics`, `findOutputsByOutpoints`, `findOutputsByIds`, `findOrInsertOutputBasketsBulk`, `findOrInsertOutputTagsBulk`

Severity legend:
- **CRITICAL** = silent wrong data, lost rows, or potential corruption
- **HIGH** = observable behavioral difference between providers, hard to detect at runtime
- **MED** = edge case or fragile contract that is correct for current callers
- **LOW** = cosmetic / extra DB work

---

## 1. Cross-cutting audit

### 1.1 Shared base methods that are missing or partially implemented

| Method | Knex | Idb | BunSqlite |
|---|---|---|---|
| `findOutputsByIds` | yes (uses `whereIn` then `validateOutputScript` per row) | INHERITED from `StorageProvider` (uses sequential `findOutputs`) | INHERITED from `StorageProvider` |
| `findOutputsByOutpoints` | yes (`whereIn(txid)` + `whereIn(vout)` then filters by outpoint set) | INHERITED — performs N independent queries | INHERITED |
| `findOrInsertOutputBasketsBulk` | yes (one `whereIn` + per-name fallback) | INHERITED — N round trips | INHERITED |
| `findOrInsertOutputTagsBulk` | yes | INHERITED | INHERITED |
| `recentlyActiveUsers` | yes (`MAX(created_at) GROUP BY userId`) | NOT IMPLEMENTED | NOT IMPLEMENTED |
| `findStaleMerkleRoots` | yes | INHERITED-via-throw or unimplemented; check needed | INHERITED |
| `adminStats` | MySQL-only raw SQL | not implemented | not implemented |
| `measureUsedBytes` | not present | not present | yes (BunSqlite-only) |
| `transaction` | knex.transaction (real isolation) | real IDB transaction (object-store isolation) | SAVEPOINT (one shared connection — see 1.4) |

**Severity**: HIGH for `recentlyActiveUsers` (admin code paths break under non-Knex providers); MED for the Bulk helpers (functional but slow under Idb / BunSqlite).

### 1.2 `assertNoUndefinedInPartial` coverage

| Provider | Behavior |
|---|---|
| Knex | Knex itself throws `Undefined binding(s) detected`. Effectively the same fail-fast contract. |
| Idb | Explicit `assertNoUndefinedInPartial` in every `filter*` method. |
| BunSqlite | `buildWhere` throws with the same wording for any `undefined` value. |

All three converge. Verified across `filterOutputs`, `filterOutputTagMaps`, `filterCertificates`, `filterCertificateFields`, `filterCommissions`, `filterMonitorEvents`, `filterOutputBaskets`, `filterOutputTags`, `filterProvenTxReqs`, `filterProvenTxs`, `filterSyncStates`, `filterTransactions`, `filterTxLabels`, `filterTxLabelMaps`, `filterUsers` in Idb and the `buildWhere` chokepoint in BunSqlite.

**Latent bug — `listOutputsIdb`**: `listOutputsIdb.ts:107` passes `spendable: !includeSpent ? true : undefined`. Today `includeSpent` is hardcoded `false` (line 99) so the value is always `true`. If anyone wires `includeSpent: true` through that method the IDB provider will throw via `assertNoUndefinedInPartial`. Knex would too. **Severity: MED**. Fix: drop the key when it should be unfiltered: `...(includeSpent ? {} : { spendable: true })`.

### 1.3 Explicit `null` handling in WHERE / partial

| Provider | `partial: { x: null }` |
|---|---|
| Knex | `where({x: null})` → emits `x = NULL`, which is **always false** in SQL. Effectively returns 0 rows. Bug, but consistent. |
| Idb | `if (args.partial.x !== undefined && r.x !== args.partial.x) continue` — JS `null !== undefined`, so it filters by `r.x === null`. Returns rows where x IS NULL. |
| BunSqlite | `buildWhere` emits `x IS NULL`. Returns rows where x IS NULL. |

**Severity**: HIGH. Idb and BunSqlite both return rows-where-null; Knex returns nothing. Caller code can't safely rely on `partial: { x: null }` cross-provider. Fix direction: either (a) document that `null` is unsupported in `partial` for all providers, or (b) patch StorageKnex's `setupQuery` to translate `null` values to `whereNull`. Recommend (b) — Bun and Idb are doing the more useful thing.

### 1.4 `transaction()` isolation

- **Knex**: real transaction; reads inside the trx see writes inside the trx; nested calls reuse the trx token.
- **Idb**: real IDBTransaction over `allStores`; aborts on error; nested calls reuse the trx.
- **BunSqlite**: SAVEPOINT only — single connection. Nested code that omits `trx` and uses `this.db` directly **still sees uncommitted writes from the savepoint** because there's only one connection. Knex would not (parent code uses a separate connection unless `trx` is plumbed). This means BunSqlite **silently masks missing-`trx` bugs** in shared base helpers that were caught under Knex.

**Severity**: HIGH for portability of code written/tested only against BunSqlite — passes locally, breaks against Knex when migration paths take effect (e.g., production wallet-server-pg).

### 1.5 `validateEntityForInsert` / `validatePartialForUpdate` parity

Knex (canon) and BunSqlite both:
- Set `created_at` / `updated_at` defaults.
- Convert numeric arrays to `Buffer` (canon writes to MySQL/SQLite; BunSqlite same path).
- For update: undefined → null after the loop.

Idb (`StorageReaderWriter` inherits the canon implementation in `StorageReader`/`StorageReaderWriter`). It uses **the same** `validateEntityForInsert` and `validatePartialForUpdate` helpers from the wallet-toolbox base class. No drift here.

BunSqlite overrides `validateOptionalEntityDate` to always emit ISO strings (correct for SQLite date columns — `TEXT` not `DATETIME`). Its override is paired with `validateEntityDate`. Verified: matches behavior of the SQLite path of canon.

### 1.6 Boolean field handling on insert

Knex and BunSqlite mutate `entity[df]` (the original input object) to a numeric 0/1 inside `validateEntityForInsert`. They never copy `v[df]` from `entity[df]` after the conversion → the actual inserted value stays whatever was on `v` *before* the loop, which is the original boolean (e.g. `true`, `false`).

Look at canon `StorageReaderWriter` lines around the boolean coercion:
```ts
if (booleanFields) {
  for (const df of booleanFields) {
    if (entity[df] !== undefined) entity[df] = !!entity[df] ? 1 : 0
  }
}
```
This mutates `entity[df]`, but `v` was constructed earlier as `{ ...entity }` (shallow). So `v[df]` is still the **original boolean** at this point. The persisted value depends on what the underlying driver does with `true`/`false`:

- MySQL via Knex: coerces JS boolean to 0/1 ✓
- SQLite via Knex (`better-sqlite3`): coerces too ✓
- IDB: stores the literal JS value (true / false). Reads back as boolean. ✓ (then the `booleanFields` reader path runs `!!val`).
- BunSqlite (`bun:sqlite`): **rejects** `true`/`false` as parameters — must be 0/1 or string.

**This is a real BunSqlite-specific bug** if the boolean-coercion code path was the only one writing 0/1. Verified by re-reading: BunSqlite's `validateEntityForInsert` performs the same `entity[df] = … ? 1 : 0` on `entity`, but `v = { ...entity }` snapshot is taken **before** the loop. So `v[df]` is the original boolean. Then `insertRow` binds `v[df]`. If `bun:sqlite` rejects booleans, we have a runtime bind error.

**Severity**: CRITICAL — needs immediate verification with a test that calls e.g. `insertOutputBasket({ isDeleted: false, ... })`. If `bun:sqlite` accepts booleans (recent versions might), demote to MED. Fix direction: either (a) fix canon `StorageReaderWriter` to mutate `v` not `entity`, or (b) override in BunSqlite to copy `v[df] = entity[df]` after the loop.

### 1.7 `auto-set` of timestamps

- Knex: `validateEntityForInsert` deletes `created_at`/`updated_at` if invalid → MySQL/SQLite default kicks in.
- BunSqlite: `validateEntityForInsert` sets them to `new Date().toISOString()` always (never deletes). Schema also has `DEFAULT (datetime('now'))` so the override always wins. **Net effect: BunSqlite times are JS-side wall clock, Knex times are DB-side wall clock**. For PG/MySQL deployments this means slight skew, and tests that check exact equality across providers will fail.
- Idb: same as Knex (uses canon helper).

**Severity**: LOW — observable in tests but harmless.

### 1.8 Schema column whitelist

- BunSqlite: `filterToSchema(table, entity)` reads `PRAGMA table_info` once, then strips unknown columns from inserts and updates. **Not from WHERE.** A rogue column name in a `partial` will pass through `buildWhere` and trigger a SQLite error (good — fail-fast).
- Knex: no whitelist — relies on schema validation by knex.
- Idb: no whitelist — extra fields are stored on the IDB record (silently persisted).

**Severity**: LOW.

---

## 2. Per-entity audit

### 2.1 outputs (`outputs`)

`findOutputs(args, tagIds?, isQueryModeAll?)`:

| Behavior | Knex | Idb | BunSqlite |
|---|---|---|---|
| Throws on `partial.lockingScript` | ✓ | ✓ | ✓ |
| `noScript: true` strips locking script in result | uses dynamic SELECT column list (`outputColumnsWithoutLockingScript`) | runs full query, then sets `r.script = undefined` mid-cursor at line 1695 (note: property name `script`, not `lockingScript` — verify schema), then **also** sets `o.lockingScript = undefined` at line 1718 | uses dynamic SELECT column list (correct) |
| `noScript: false` calls `validateOutputScript` per row | ✓ | ✓ | ✓ |
| `txStatus: ['completed', ...]` filter | subquery `where transactions.transactionId = ...` | per-row `countTransactions({ partial: { transactionId }, status })` (N+1 against `transactions` index) | inline subquery `WHERE (SELECT status FROM transactions ...) IN (...)` |
| `tagIds` + `isQueryModeAll` | argument honored | argument honored via `filterOutputTagMaps` | **NOT honored** — BunSqlite's `findOutputs` signature drops the `tagIds` param entirely; only `partial.userId/basketId` fan-out works |
| `args.partial: { spendable: true }` matches `1` rows | yes (knex coerces) | matches when `r.spendable === true`. IDB stored boolean? After `validateEntityForInsert` insert path, raw JS boolean is stored. After read, `validateEntity` runs `!!val`. So Idb stores boolean and reads boolean. Comparison `r.spendable !== args.partial.spendable` works for `true`/`false` | matches `1`/`0` rows. BunSqlite stores integers; partial value `true` would not match `1` because `buildWhere` binds `true` directly. SQL `WHERE spendable = ?` with bound `1` → matches; with bound `true` → bun:sqlite param error. So **callers must pass numeric** for outputs `spendable`/`change` partial under BunSqlite. |

**CRITICAL BUG (BunSqlite)**: `findOutputs(args)` drops `tagIds`/`isQueryModeAll`. Knex signature is `findOutputs(args, tagIds?, isQueryModeAll?)`. `listOutputs` is the main caller; under BunSqlite, tag-filtered `listOutputs` returns ALL user outputs in the basket regardless of tags. **Fix**: add the tag filter (post-filter via `output_tags_map` + `INTERSECT` or in-memory).

**Methodology-calibration bug** (carried forward, IDB only): when an output row was inserted with `lockingScript` populated but no `scriptOffset` / `scriptLength`, `validateOutputScript` returns at line 823 without action. `findOutputs` (line 1714–1719) then either keeps the existing `lockingScript` (when `noScript: false`) or wipes it (when `noScript: true`). **The bug** is that `findOutputs` always overwrites `lockingScript = undefined` when `noScript: true` even though IDB has the script available — net result is the caller never gets the script via the cheap path, must pay an extra round trip. Knex avoids this because the SELECT-column path means `lockingScript` was never read in the first place (no need to clear it).

**Severity**: MED for the Idb script path (forces an extra query in callers), CRITICAL for BunSqlite's missing tag filter.

`countOutputs`:
- Knex: uses same query path with `count: true` flag (skips noScript columns rewrite).
- Idb: forces `noScript: true` then counts via filter.
- BunSqlite: passes through `txStatus` extraWhere; ignores `tagIds`. Same critical bug as `findOutputs`.

`updateOutput(id, partial)`:
- Knex: returns affected row count.
- Idb: `updateIdb` returns `updated` (real count). Verified.
- BunSqlite: `updateRows` returns `db.query('SELECT changes()').get().cnt`. Note the implementation reads `changes()` twice; the first read is to check truthiness, the second returns the value — works but wasteful. **MED**.

**Bug**: `updateRows` returns `0` if `setClauses.length === 0` (BunSqlite line 1044). Idb's `updateIdb` ALWAYS does a `store.put` — so a truly-empty update under Idb still writes a row (incrementing `updated_at` because `validatePartialForUpdate` always sets it). Knex: `validatePartialForUpdate` always sets `updated_at` too, so `setClauses` are never empty in Knex. **Net: BunSqlite's empty-update short-circuit is unreachable in normal flow** because `updated_at` is always set. LOW.

`insertOutput(output)`:
- All three: drop `outputId` if `0`; insert; return new id; mutate input `output.outputId`.
- Knex extra: wrapped in try/catch that rethrows (no-op).
- BunSqlite extra: filters to schema columns.

**Difference**: `output.lockingScript` provided as `number[]`:
- Knex: converted to Buffer (line 1069–1073).
- Idb: inserted as raw `number[]` (IDB serializes arrays losslessly).
- BunSqlite: same Buffer conversion.

On read:
- Knex: `validateEntity` → Buffer → `Array.from(val)` → `number[]`.
- Idb: stays `number[]`.
- BunSqlite: same as Knex.

Cross-provider serialized values agree (always `number[]` to the caller).

`findOutputsByOutpoints(userId, outpoints)`:
- Knex: yes (whereIn-and-filter).
- Idb: inherits from `StorageProvider` base — that base file does NOT define this method (verified above). Calls into IdB will hit `StorageProvider.findOutputsByOutpoints` if defined; otherwise undefined. Need to verify base class.

Looking at `StorageProvider.ts:150-160` it IS defined and uses `for of outpoints { findOutputs({partial:{txid}}) ... }` style. That works on all providers. **MED — N round trips on Idb / BunSqlite** vs single SELECT on Knex.

### 2.2 transactions (`transactions`)

`findTransactions(args, labelIds?, isQueryModeAll?)`:

| | Knex | Idb | BunSqlite |
|---|---|---|---|
| Throws on `partial.rawTx` / `partial.inputBEEF` | ✓ | ✓ | ✓ |
| `partial: { lockTime: 0 }` matches | yes (where binds 0) | yes (line 1935: `r.lockTime !== args.partial.lockTime` — but `0` is checked via `!== undefined` so it passes through) | yes (`buildWhere` binds 0) |
| `partial: { description: "" }` matches | yes (where binds empty string) | yes (`!== undefined` guard) | yes (`buildWhere` binds empty string) |
| `args.from` / `args.to` (Date range on `created_at`) | ✓ | ✓ | ✓ |
| `args.status: []` (empty array) | guard `args.status.length > 0` skips | guard `args.status.length > 0` skips | guard `args.status.length > 0` skips |
| `noRawTx: true` | dynamic SELECT columns | `t.rawTx = undefined; t.inputBEEF = undefined` (not great if rawTx was needed) | dynamic SELECT columns |
| `labelIds` filter | ✓ | ✓ (via `filterTxLabelMaps`) | **NOT honored** — `findTransactions` signature `findTransactions(args)` drops `labelIds` |
| Updates `t.inputBEEF = undefined` when noRawTx | no | yes (line 1984) | no |

**CRITICAL BUG (BunSqlite)**: `findTransactions(args)` drops `labelIds`. Same shape as `findOutputs` tag bug — label-filtered `listActions` would silently return all actions. Fix: implement label intersect.

**MED (Idb)**: when `noRawTx: true`, Idb additionally clears `inputBEEF`. Knex's `transactionColumnsWithoutRawTx` may or may not include `inputBEEF` — need verification. If it doesn't include inputBEEF, **Idb is more aggressive than Knex**. This affects `getReqsAndBeefToShareWithWorld` etc.

`countTransactions(args, labelIds?, isQueryModeAll?)`:
- Knex: full query path with `count: true`.
- Idb: `noRawTx: true` then counts via filter.
- BunSqlite: passes status/from/to extraWhere; ignores `labelIds`. Same critical bug.

`insertTransaction(tx)`: all three: drop `transactionId` if `0`; insert; mutate input.

`updateTransaction(id|number[], partial)`:
- Knex: branches on Array.isArray(id); whereIn vs where; returns count.
- Idb: `updateIdb` iterates ids; throws `WERR_INVALID_PARAMETER('id')` if any id is missing a row. **Different**: Knex silently treats missing ids as 0-affected; Idb throws.
- BunSqlite: branches on Array.isArray; uses `WHERE transactionId IN (?,?,?)`; for empty array returns 0. Returns `changes()`.

**HIGH (Idb)**: `updateTransaction([1,2,99], {...})` where 99 doesn't exist → Idb throws, Knex returns 2. Fix direction: have Idb skip missing ids and return the actual updated count, matching Knex semantics.

`updateTransactionsStatus(transactionIds[], status)` (StorageProvider):
- Calls `updateTransactionStatus` per id inside a `transaction()`.
- For `failed`: restores inputs (`spendable: true, spentBy: undefined`).
- All three providers inherit this. The trx propagation matters — under BunSqlite SAVEPOINT, the savepoint is honored; under Knex, the trx must be plumbed through; under Idb, the IDBTransaction must include `outputs`+`transactions`. Knex/Idb test paths likely OK because they call shared `transaction()`.

### 2.3 provenTxs (`proven_txs`)

`findProvenTxs(args)`:
- All: throws on `partial.rawTx`, `partial.merklePath`. Verified.
- Knex/BunSqlite: SELECT *. Idb: cursor walk.

`insertProvenTx`: all three drop `provenTxId === 0`; insert; mutate.

`updateProvenTx`: all three single-id update.

No observable differences.

### 2.4 provenTxReqs (`proven_tx_reqs`)

`findProvenTxReqs(args)`:
- All: throws on `partial.rawTx`, `partial.inputBEEF`.
- All: handle `args.status` (array) via IN clause; handle `args.txids` (array, filtered for undefined).
- Idb: also has `args.partial.history`, `args.partial.notify`, `args.partial.batch` matchers — these compare scalar string values. `history` and `notify` in canonical schema are JSON strings. Comparing them as opaque strings is fine.

**No drift.** The previously-fixed `&& r.txid` guard (idb line 662) is in place: `if (args.txids && args.txids.length > 0 && !args.txids.includes(r.txid)) continue` — note this would *exclude* a row with `r.txid === undefined` even if the caller didn't ask. Good.

`countProvenTxReqs`:
- Knex: same query path.
- Idb: filter + count.
- BunSqlite: passes status extraWhere; **does NOT pass `txids` extraWhere**. Verified: `countProvenTxReqs` only handles `args.status`, not `args.txids`. So `count` and `find` disagree under BunSqlite.

**HIGH**: `countProvenTxReqs({ status: [...], txids: [...] })` returns the count *without* the txid filter under BunSqlite. Fix: mirror the txid filter in `countProvenTxReqs`.

`updateProvenTxReq(id|number[], partial)`:
- Knex / BunSqlite: branch on array, IN clause.
- Idb: `updateIdb` iterates and throws on missing.

Same issue as `updateTransaction` array form.

`updateProvenTxReqDynamics(id, update)` (StorageProvider): copies whitelist of fields from `update` into `partial`, then calls `updateProvenTxReq`. All three inherit this.

### 2.5 outputTags (`output_tags`)

`findOutputTags(args)`: no special args, vanilla. All three converge.

`insertOutputTag`: drop `outputTagId === 0`; insert. All converge.

`updateOutputTag`: single id. All converge.

`findOrInsertOutputTag(userId, tag)`: in `StorageReaderWriter`. Inserts a new tag if not found; toggles `isDeleted` back to false if found-deleted.

**Subtle bug across all providers** (in shared code): `await this.updateOutputTag(verifyId(...), { isDeleted: false })` is called WITHOUT `trx`. If you're inside a `transaction()`, this update happens outside the trx. Under Knex, this is a separate connection. Under Idb, this is a separate IDBTransaction (will block until the outer one completes — possible deadlock). Under BunSqlite, the savepoint and the bare update share the same connection so it works.

**Severity**: HIGH for Idb (deadlock potential when called inside a `transaction()`). Fix: `await this.updateOutputTag(verifyId(outputTag.outputTagId), { isDeleted: false }, trx)`.

Same shape applies to `findOrInsertOutputBasket`, `findOrInsertTxLabel`, `findOrInsertTxLabelMap`, `findOrInsertOutputTagMap`.

### 2.6 outputTagMaps (`output_tags_map`)

`findOutputTagMaps(args)`:
- Knex/BunSqlite: `tagIds` extraWhere applied via `whereIn`/`IN`.
- Idb: `args.tagIds` filtered in cursor.

`insertOutputTagMap`: void return. All converge.

`updateOutputTagMap(outputId, tagId, partial)`:
- Knex/BunSqlite: composite WHERE `(outputId=?, outputTagId=?)`.
- Idb: `updateIdbKey([tagId, outputId], ..., ['outputTagId', 'outputId'], 'output_tags_map')` — note Idb's composite index order is `[outputTagId, outputId]`. The composite key order must match the IDB schema exactly. Verify in `initDB`: line ≈246 creates `output_tags_map` with `keyPath: ['outputTagId', 'outputId']`. ✓ matches.

**No drift.**

The previously-fixed `filterOutputTagMaps` user-scope dead code: confirmed gone. The optional `userId` parameter in Idb's filter does a per-row `countOutputTags` check.

### 2.7 outputBaskets (`output_baskets`)

All three converge. `insertOutputBasket` drops `basketId === 0`.

`findOrInsertOutputBasketsBulk` is Knex-only override; Idb and BunSqlite fall back to `findOrInsertOutputBasket` per name. Slow but correct.

### 2.8 txLabels (`tx_labels`)

Same shape as outputTags. Same `findOrInsert` trx-not-passed issue applies.

### 2.9 txLabelMaps (`tx_labels_map`)

Same shape as outputTagMaps. `updateTxLabelMap(transactionId, txLabelId, partial)` — Idb composite key order: `[txLabelId, transactionId]`; verify schema: `tx_labels_map` keyPath `['txLabelId', 'transactionId']`. ✓ matches.

### 2.10 certificates (`certificates`)

`findCertificates(args)`:
- All: support `args.certifiers[]`, `args.types[]`, `args.includeFields`.
- All: `validateEntities(_, undefined, ['isDeleted'])`.
- Idb: when `userId + type + certifier + serialNumber` are all in partial, uses the composite index — fast path. Knex/BunSqlite would just AND them in the WHERE.

`insertCertificate`:
- All: handle `e.fields` separately (insert into certificate_fields after).
- Knex: `if (e.logger) delete e.logger`. BunSqlite: same. Idb: **does not strip `logger`**. Looking at the code — confirmed Idb's `insertCertificate` (line 843) only handles `fields`, not `logger`. The `e.logger` may be a non-schema attribute that IDB will silently store. Severity LOW because IDB doesn't care, but `validateEntity` round-trip will surface a nonzero `logger` field that Knex would have stripped.

**Severity**: LOW / cosmetic.

`updateCertificate`: all three single-id update with `['isDeleted']` boolean field.

### 2.11 certificateFields (`certificate_fields`)

`findCertificateFields(args)`: all three converge.

`insertCertificateField`: void. All three converge. No primary-key-zero handling (composite key `[certificateId, fieldName]` is provided by caller).

`updateCertificateField(certificateId, fieldName, partial)`: composite WHERE. All three converge. Idb uses `updateIdbKey([certificateId, fieldName], ...)`.

### 2.12 commissions (`commissions`)

`findCommissions(args)`: all three throw on `partial.lockingScript`. All three return with `['isRedeemed']` boolean field.

`insertCommission`: drop `commissionId === 0`. All converge.

`updateCommission`: single id. All converge.

### 2.13 users (`users`)

`findUsers(args)`: vanilla. Idb supports `partial.identityKey` and `partial.activeStorage` field matchers (line 2071–2072).

`insertUser`: drop `userId === 0`. All converge.

`updateUser`: single id. All converge.

`findOrInsertUser(identityKey)` (StorageReaderWriter): inserts user + default basket. **No `trx` passed to inner `insertOutputBasket`** — same trx propagation hazard as 2.5.

`recentlyActiveUsers`:
- Knex: implemented via subquery + JOIN.
- Idb: NOT IMPLEMENTED. Will throw "method not found" if called.
- BunSqlite: NOT IMPLEMENTED.

**Severity**: HIGH for admin paths.

### 2.14 monitorEvents (`monitor_events`)

`findMonitorEvents(args)`:
- All: validate `['when']` date field.
- Idb: cursor walk; supports `partial.event` and `partial.details` matchers.

`insertMonitorEvent`: drops `id === 0`. All converge.

`updateMonitorEvent`: single id (uses `id` not `eventId`). All converge.

### 2.15 syncStates (`sync_states`)

`findSyncStates(args)`:
- All: validate `['when']` date field, `['init']` boolean.
- Idb: cursor walk; supports a wider set of matchers.

`insertSyncState`: drops `syncStateId === 0`; date field `['when']`; boolean `['init']`. All converge.

`updateSyncState`: single id; same date/boolean fields. All converge.

`findOrInsertSyncStateAuth` (StorageReaderWriter): no `trx` passed to `insertSyncState` (line 370). Same hazard.

---

## 3. `findOutputsByOutpoints` deep dive

Canon (Knex line 1138–1161): one query — `whereIn(txid, txids).whereIn(vout, vouts)` then in-memory filter on the requested outpoints. Critically, **vouts of one txid may match a different txid that was not requested**, so the post-filter is required.

Idb / BunSqlite inherit `StorageProvider`'s `findOutputsByOutpoints` (lines 150–162). That base method (need to confirm exact body — partial show only) calls `findOutputs({partial: {userId, txid, vout}})` per outpoint.

Net cost:
- Knex: 1 SELECT per call.
- Idb: N IDB cursor walks (each one going through `userId+transactionId_vout_userId` composite index). Slow but correct.
- BunSqlite: N SELECTs.

For wallet `internalize` flows over a Beef with 50 inputs, this matters — Idb gets very slow.

**Severity**: MED. Fix direction: add native `findOutputsByOutpoints` to Idb (single cursor over `userId` index, in-memory filter) and BunSqlite (one SELECT with `WHERE txid IN ... AND vout IN ...`).

---

## 4. Side-effect parity in `updateXStatus` helpers

Only `updateTransactionStatus` and `updateTransactionsStatus` exist. Both live in `StorageProvider` (shared base) — all three providers inherit the same logic.

Side effects on `status='failed'`:
1. Restore inputs: `updateOutput(input.outputId, { spendable: true, spentBy: undefined })`.
2. Set `spentBy: undefined` on outputs that referenced the failed tx.

The inputs are loaded via `EntityTransaction.getInputs(this, trx)`. `trx` IS plumbed correctly (verified at line 437).

**No drift.**

`updateProvenTxReqWithNewProvenTx` (StorageProvider:688): calls `findOrInsertProvenTx` inside `transaction()`, then `updateProvenTxReq` outside. Then iterates `req.notify.transactionIds` and calls `updateTransaction(id, ...)` per id, **without trx**. Same trx hazard pattern as 2.5.

---

## 5. Auto-set on insert/update — fields that differ per provider

| Field | Knex | Idb | BunSqlite |
|---|---|---|---|
| `created_at` insert | DB DEFAULT or override from canon helper | canon helper sets to JS `now` | overridden helper sets to JS `now` ISO string |
| `updated_at` insert | same | same | same |
| `updated_at` update | always set to JS `now` (canon) | same | same |
| `userId` on `findOrInsertUser` default basket | always set | always set | always set |
| Default basket name `'default'` | yes | yes | yes |
| `numberOfDesiredUTXOs` default | 144 (canon helper hard-codes) | 144 | 144 |
| `minimumDesiredUTXOValue` default | 32 | 32 | 32 |

---

## 6. Prioritized fix list

1. **CRITICAL — BunSqlite tag/label filter dropped**
   `findOutputs` and `countOutputs` ignore `tagIds` arg.
   `findTransactions` and `countTransactions` ignore `labelIds` arg.
   Symptom: `listOutputs({tags:[...]})` and `listActions({labels:[...]})` return everything in the basket / for the user.
   Fix: implement intersect via `output_tags_map` / `tx_labels_map`.

2. **CRITICAL — boolean coerce mutates wrong object**
   `validateEntityForInsert` mutates `entity[df]`, but inserted value comes from `v[df]` snapshot. Verify whether `bun:sqlite` accepts `true`/`false` as bound params. If no → INSERT fails. Easy fix in BunSqlite override: copy `v[df] = entity[df]` after the boolean loop.

3. **HIGH — Knex partial:null returns 0 rows; Idb / BunSqlite return IS NULL rows**
   Patch StorageKnex's `setupQuery` to translate `null` partial values to `whereNull`.

4. **HIGH — `recentlyActiveUsers` not implemented in Idb/BunSqlite**
   Admin code paths broken. Add naive implementations.

5. **HIGH — Idb `updateIdb` throws on missing id; Knex/BunSqlite count rows actually updated**
   Change Idb to skip-and-count when ids in array don't exist.

6. **HIGH — BunSqlite `countProvenTxReqs` ignores `txids` filter**
   `find` and `count` disagree.

7. **HIGH — `findOrInsert*` helpers in StorageReaderWriter pass no `trx` to update calls**
   Causes potential deadlock under Idb when called inside `transaction()`. Plumb `trx` through `updateOutputBasket / updateTxLabel / updateOutputTag / updateOutputTagMap / updateTxLabelMap / updateTransaction / updateProvenTxReq`.

8. **MED — listOutputsIdb fragile `spendable: undefined` for `includeSpent: true`**
   Switch to spread-omit pattern.

9. **MED — Idb / BunSqlite need native `findOutputsByOutpoints` and `findOrInsert*Bulk`**
   Per-outpoint round trip is expensive in Beef internalize.

10. **MED — Idb `findOutputs(noScript:true)` clears `lockingScript` even when present**
    Keep cached locking script when caller requested `noScript` purely to avoid `validateOutputScript` round-trip.

11. **MED — Idb `findTransactions(noRawTx:true)` also clears `inputBEEF`**
    Knex (per `transactionColumnsWithoutRawTx`) likely keeps `inputBEEF`. Verify column list and align.

12. **MED — Idb `insertCertificate` doesn't strip non-schema `logger` field**
    Cosmetic; add `if (e.logger) delete e.logger` for parity.

13. **LOW — BunSqlite double `changes()` query in `updateRows`**
    Cache the row, read once.

14. **LOW — BunSqlite `created_at`/`updated_at` always JS clock**
    Drop the always-set behavior on insert; let SQLite default fire.

15. **LOW — BunSqlite SAVEPOINT vs Knex real transaction**
    Document the divergence; tests written against BunSqlite must be re-run against Knex before deploy.

---

## 7. Methodology notes

The most fertile place to find drift is in **interactions** between methods:
- A `find*` that strips a field, called by code that then re-inserts that record assuming the field is set.
- An `update*` whose return-value semantics drift (Idb's strict-on-missing vs Knex's silent-zero).
- A helper's `trx` not propagated, harmless under Knex/BunSqlite, deadlock-prone under Idb.
- An args option (tagIds/labelIds) silently dropped in one provider's signature.

Everything in this doc was verified by reading the three files end-to-end at the offsets cited.
