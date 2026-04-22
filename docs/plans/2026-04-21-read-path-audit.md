# Read-Path Storage Audit (2026-04-21)

End-to-end audit of `listActions`, `listOutputs`, `listCertificates` plus the
helpers they invoke (`findOutputs`, `countOutputs`, `findCertificates`,
`findCertificateFields`, `findTransactions`, `getTagsForOutputId`,
`getLabelsForTransactionId`, `validateOutputScript`, `extendOutput`,
`getValidBeefForKnownTxid`) across StorageKnex (canon), StorageIdb, and
StorageBunSqlite.

Findings are limited to **observable behavior differences** for the seven
representative data shapes from the brief. Stylistic / naming differences are
omitted.

There is no `listOutputBaskets` public storage method. Skipped.

---

## 1. `listOutputs`

| | StorageKnex (canon) | StorageIdb | StorageBunSqlite |
|---|---|---|---|
| Tx-status filter | `'completed','unproven','nosend','sending'` ([listOutputsKnex.ts#L131](wallet-toolbox/src/storage/methods/listOutputsKnex.ts#L131)) | `'completed','unproven','nosend'` (no `sending`) ([listOutputsIdb.ts#L101](wallet-toolbox/src/storage/methods/listOutputsIdb.ts#L101)) | `'completed','unproven','nosend','sending'` ([storage-bun-sqlite.ts#L3027](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L3027)) |
| Locking-script columns | dynamic SELECT — `lockingScript`/`scriptLength`/`scriptOffset` only when `includeLockingScripts \|\| specOp?.includeOutputScripts` ([listOutputsKnex.ts#L113-L126](wallet-toolbox/src/storage/methods/listOutputsKnex.ts#L113-L126)) | `noScript: true` hardcoded → `findOutputs` clears `o.lockingScript = undefined` ([listOutputsIdb.ts#L110](wallet-toolbox/src/storage/methods/listOutputsIdb.ts#L110), [StorageIdb.ts#L1718](wallet-toolbox/src/storage/StorageIdb.ts#L1718)) | dynamic SELECT — same as Knex ([storage-bun-sqlite.ts#L3010-L3023](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L3010-L3023)) |
| Tag-resolution helper | `output_tags` whereIn ([listOutputsKnex.ts#L92-L102](wallet-toolbox/src/storage/methods/listOutputsKnex.ts#L92-L102)) | `filterOutputTags` cursor scan ([listOutputsIdb.ts#L82-L87](wallet-toolbox/src/storage/methods/listOutputsIdb.ts#L82-L87)) | `output_tags WHERE tag IN (?)` ([storage-bun-sqlite.ts#L2997-L3004](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2997-L3004)) |
| Negative offset | reverses to DESC ([listOutputsKnex.ts#L23-L27](wallet-toolbox/src/storage/methods/listOutputsKnex.ts#L23-L27)) | throws `WERR_NOT_IMPLEMENTED` ([listOutputsIdb.ts#L20](wallet-toolbox/src/storage/methods/listOutputsIdb.ts#L20)) | reverses to DESC ([storage-bun-sqlite.ts#L2945-L2949](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2945-L2949)) |

### CRIT-1 — Idb hardcoded `noScript:true` strips Dan's locking scripts
This is the bug the prompt called out. listOutputsIdb forces `noScript:true`
into `findOutputs`, which sets `o.lockingScript = undefined`
([StorageIdb.ts#L1718](wallet-toolbox/src/storage/StorageIdb.ts#L1718)).
Re-resolution via `validateOutputScript` requires `scriptLength + scriptOffset
+ txid` ([StorageProvider.ts#L823](wallet-toolbox/src/storage/StorageProvider.ts#L823));
when those are missing, `lockingScript` stays `undefined` and the caller sees
no script. **StorageBunSqlite does NOT have this bug** — its column list adds
`lockingScript` directly when `vargs.includeLockingScripts` is set.

For shape (1) (`lockingScript` populated, offsets undefined) caller-visible
diff: Knex/BunSqlite return the script bytes; Idb returns no `lockingScript`
field on the WalletOutput.

**Fix direction:** in listOutputsIdb, `noScript: !vargs.includeLockingScripts`
(matching Knex/Bun) and rely on `validateOutputScript` for re-resolution. Stop
forcing `o.lockingScript = undefined` in the noScript path of
`findOutputs` — let it remain whatever IDB stored.

### CRIT-2 — Idb txStatus list omits `'sending'`
Outputs from a transaction in `sending` are visible in Knex/BunSqlite results
but invisible in Idb. For shape (7) — though that shape is about `failed`
which all three correctly exclude — and for actual mempool-broadcasting
flows, this divides the providers. A user mid-broadcast querying baskets sees
fewer outputs on Idb.

**Fix direction:** add `'sending'` to the `stati` array in
[listOutputsIdb.ts#L101](wallet-toolbox/src/storage/methods/listOutputsIdb.ts#L101).

### MED-3 — Idb lacks negative-offset support
Knex and BunSqlite both treat negative offset as "from the tail, descending."
Idb throws. Any UI depending on tail pagination breaks on Idb only.

**Fix direction:** mirror the Knex/Bun reversal logic in listOutputsIdb;
implement DESC cursor traversal.

### LOW-4 — totalOutputs accounting on bun
BunSqlite always runs the COUNT query before applying limit
([storage-bun-sqlite.ts#L2781-L2785](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2781-L2785)),
but then at line 3160-3161 only uses it when `outputs.length >= limit`. Wasted
work, no observable diff. No fix required unless perf matters.

For shape (5) (tag does not exist), all three return early with empty result
([listOutputsKnex.ts#L105-L111](wallet-toolbox/src/storage/methods/listOutputsKnex.ts#L105-L111),
[listOutputsIdb.ts#L90-L96](wallet-toolbox/src/storage/methods/listOutputsIdb.ts#L90-L96),
[storage-bun-sqlite.ts#L3007-L3008](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L3007-L3008)). Consistent.

For shape (6), the per-tx `userId` filter is enforced uniformly. No leak.

---

## 2. `listActions`

| | StorageKnex | StorageIdb | StorageBunSqlite |
|---|---|---|---|
| Default tx-status set | `['completed','unprocessed','sending','unproven','unsigned','nosend','nonfinal']` ([listActionsKnex.ts#L110](wallet-toolbox/src/storage/methods/listActionsKnex.ts#L110)) | identical ([listActionsIdb.ts#L87](wallet-toolbox/src/storage/methods/listActionsIdb.ts#L87)) | identical ([storage-bun-sqlite.ts#L2738-L2747](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2738-L2747)) |
| Total-actions count | runs a separate `qcount` only when `txs.length >= limit` ([listActionsKnex.ts#L162-L167](wallet-toolbox/src/storage/methods/listActionsKnex.ts#L162-L167)) | identical pattern via `countTransactions` ([listActionsIdb.ts#L103-L111](wallet-toolbox/src/storage/methods/listActionsIdb.ts#L103-L111)) | always runs COUNT, then uses same gating as Knex ([storage-bun-sqlite.ts#L2833-L2835](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2833-L2835)) |
| Time-label parsing (BRC-114) | yes ([listActionsKnex.ts#L36-L70](wallet-toolbox/src/storage/methods/listActionsKnex.ts#L36-L70)) | yes ([listActionsIdb.ts#L31-L65](wallet-toolbox/src/storage/methods/listActionsIdb.ts#L31-L65)) | yes ([storage-bun-sqlite.ts#L2669-L2708](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2669-L2708)) |
| Time-label `>=` / `<` semantics | uses `validateDateForWhere` ([listActionsKnex.ts#L117-L118](wallet-toolbox/src/storage/methods/listActionsKnex.ts#L117-L118)) | passes raw `Date` to `findTransactions`, which compares by `getTime()` ([StorageIdb.ts#L1918-L1919](wallet-toolbox/src/storage/StorageIdb.ts#L1918-L1919)) | uses `validateDateForWhere` ([storage-bun-sqlite.ts#L2756-L2762](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2756-L2762)) |

All three are functionally aligned for the representative shapes. No
caller-visible diff for shapes (3), (5), or (6) — empty `status` array isn't
reachable from listActions because the default set is always populated.

### LOW-5 — `created_at` storage-format inconsistency
Knex stores dates per `validateDateForWhere` (driver-dependent string).
Idb stores native `Date` and compares `getTime()`. BunSqlite stores ISO-ish
strings. Cross-provider sync of the same wallet (not currently supported but
a future risk) could mis-bucket boundary-millisecond txs. No active impact.

---

## 3. `listCertificates`

All three providers delegate to the shared
[listCertificates.ts](wallet-toolbox/src/storage/methods/listCertificates.ts)
helper ([StorageProvider.ts#L528-L530](wallet-toolbox/src/storage/StorageProvider.ts#L528-L530));
divergence is restricted to the `findCertificates` / `findCertificateFields`
overrides plus `transaction()` semantics.

| | Knex | Idb | BunSqlite |
|---|---|---|---|
| `findCertificates` certifier/type filter | `whereIn` ([StorageKnex.ts#L573-L578](wallet-toolbox/src/storage/StorageKnex.ts#L573-L578)) | applied inline in cursor ([StorageIdb.ts](wallet-toolbox/src/storage/StorageIdb.ts) `filterCertificates`) | `IN (?)` extra-where ([storage-bun-sqlite.ts#L2058-L2066](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2058-L2066)) |
| `transaction()` wrapping | knex transaction | IDB transaction wrapper | bun:sqlite synchronous transaction ([storage-bun-sqlite.ts#L733](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L733)) |

For all seven representative shapes the observable result is equivalent. No
findings.

---

## 4. `findOutputs` (shared helper for all read paths)

| | Knex | Idb | BunSqlite |
|---|---|---|---|
| `partial.lockingScript` guard | throws ([StorageKnex.ts#L591-L595](wallet-toolbox/src/storage/StorageKnex.ts#L591-L595)) | throws ([StorageIdb.ts#L1577-L1581](wallet-toolbox/src/storage/StorageIdb.ts#L1577-L1581)) | throws ([storage-bun-sqlite.ts#L2116-L2120](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2116-L2120)) |
| Empty `txStatus: []` | `args.txStatus.length > 0` guard ([StorageKnex.ts#L597](wallet-toolbox/src/storage/StorageKnex.ts#L597)) | `args.txStatus.length > 0` guard ([StorageIdb.ts#L1666](wallet-toolbox/src/storage/StorageIdb.ts#L1666)) | `args.txStatus.length > 0` guard ([storage-bun-sqlite.ts#L2124](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2124)) |
| `noScript=true` post-effect on `o.lockingScript` | column omitted from SELECT — value is undefined ([StorageKnex.ts#L602-L604](wallet-toolbox/src/storage/StorageKnex.ts#L602-L604)) | **explicitly assigns `o.lockingScript = undefined`** even though IDB cursor returned the full row including script ([StorageIdb.ts#L1718](wallet-toolbox/src/storage/StorageIdb.ts#L1718)) | column omitted from SELECT ([storage-bun-sqlite.ts#L2129-L2131](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2129-L2131)) |
| `validateOutputScript` invocation | when `!noScript` ([StorageKnex.ts#L734-L738](wallet-toolbox/src/storage/StorageKnex.ts#L734-L738)) | when `!noScript` ([StorageIdb.ts#L1715-L1719](wallet-toolbox/src/storage/StorageIdb.ts#L1715-L1719)) | when `!noScript` ([storage-bun-sqlite.ts#L2141-L2145](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2141-L2145)) |

All three correctly guard empty `txStatus` arrays — the prior poisoning bug
remains fixed. The Idb post-effect on `o.lockingScript = undefined` is the
chain that makes CRIT-1 manifest.

---

## 5. `validateOutputScript` (base class, shared)

Lives in [StorageProvider.ts#L821-L832](wallet-toolbox/src/storage/StorageProvider.ts#L821-L832).
Single implementation. Returns early if `!o.scriptLength || !o.scriptOffset
|| !o.txid`.

This is the chokepoint that makes CRIT-1 dangerous: it cannot recover a
script that was deliberately wiped by Idb's `findOutputs` because Dan's rows
have the script bytes but no `scriptOffset`/`scriptLength` to drive
re-resolution from BEEF.

**Fix direction (alternative to fixing CRIT-1 in listOutputsIdb):** make
`validateOutputScript` also short-circuit-success when `o.lockingScript` is
already populated, skipping the early `return`. But the cleaner fix is at the
caller — don't wipe in the first place.

---

## 6. `getTagsForOutputId` / `getLabelsForTransactionId`

| | Knex | Idb | BunSqlite |
|---|---|---|---|
| Implementation | single JOIN query | two queries: `findOutputTagMaps` then per-id `findOutputTags` ([StorageIdb.ts#L455-L463](wallet-toolbox/src/storage/StorageIdb.ts#L455-L463)) | single JOIN query ([storage-bun-sqlite.ts#L2543-L2557](1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts#L2543-L2557)) |
| Behavior on missing tag/label row | excluded by JOIN | `verifyOne` throws ([StorageIdb.ts#L460](wallet-toolbox/src/storage/StorageIdb.ts#L460)) — fatal | excluded by JOIN |

### HIGH-6 — Idb throws on dangling tag/label maps
If a `output_tags_map` row references an `outputTagId` whose `output_tags`
row was soft-deleted (`isDeleted=true`), `verifyOne` rejects (it gets zero
rows back due to the `isDeleted: false` filter). The whole `listOutputs`
call fails with an exception. Knex and BunSqlite silently drop the row via
JOIN. Same applies to `getLabelsForTransactionId`
([StorageIdb.ts#L444-L452](wallet-toolbox/src/storage/StorageIdb.ts#L444-L452)).

For shape (6), if a soft-deleted tag survives in the map (which can happen
across restores or partial deletes), Idb breaks the entire response, while
Knex/Bun gracefully drop it.

**Fix direction:** in Idb's `getTagsForOutputId` /
`getLabelsForTransactionId`, replace `verifyOne` with `verifyOneOrNone` and
skip when undefined. Or filter the maps to exclude orphans first.

---

## 7. `extendOutput` / `getValidBeefForKnownTxid`

`extendOutput` and `getValidBeefForKnownTxid` are inherited from
StorageProvider with no overrides in any of the three providers. No
divergence.

The `getValidBeefForKnownTxid` recursion calls into provider-specific
`getProvenOrRawTx` / `findOutputs` paths but those are uniform across all
three for the representative shapes.

---

## 8. `findCertificates` / `findCertificateFields`

All three honor `userId`/`isDeleted` partials and the
`certifiers`/`types` array filters. Empty arrays are guarded (`length > 0`)
in all three. No findings.

---

## Severity Summary

| ID | Severity | Title | Provider(s) affected |
|---|---|---|---|
| CRIT-1 | CRIT | listOutputsIdb hardcoded `noScript:true` strips lockingScript when offsets are absent | StorageIdb only |
| CRIT-2 | CRIT | listOutputsIdb missing `'sending'` in tx-status filter | StorageIdb only |
| HIGH-6 | HIGH | Idb tag/label fetch throws on orphaned map rows | StorageIdb only |
| MED-3 | MED | listOutputsIdb no negative-offset support | StorageIdb only |
| LOW-4 | LOW | BunSqlite always runs unused COUNT in noTags listOutputs path | BunSqlite |
| LOW-5 | LOW | Cross-provider date-format drift on time-label boundaries | All three (cross-sync only) |

## Recommended Fix Order

1. **CRIT-1** — drop the hardcoded `noScript:true`; thread
   `!vargs.includeLockingScripts` through and remove the wipe-on-noScript
   block in `findOutputs`. Verify Dan's profile loads.
2. **CRIT-2** — add `'sending'` to the Idb status array.
3. **HIGH-6** — switch to `verifyOneOrNone` and skip orphans, in both
   `getTagsForOutputId` and `getLabelsForTransactionId` of StorageIdb.
4. **MED-3** — implement DESC traversal for negative offset.
5. **LOW-4 / LOW-5** — defer; no caller impact today.

## Methodology Notes

The pattern that matched CRIT-1 — *two providers calling the same helper but
the helper sees different state because one path mutates first* — also
matched HIGH-6. Both arise from Idb's cursor-based implementation needing to
do work that JOIN-based providers get for free. All three providers correctly
rely on the shared base-class `validateOutputScript` and
`getValidBeefForKnownTxid`; the divergences are upstream of those calls.

The previously reported fixes (filterOutputTagMaps user-scope dead code,
filterProvenTxReqs `&& r.txid` guard, empty `txStatus`/`status` array
poisoning, `assertNoUndefinedInPartial` everywhere, `updateIdb` real count,
BunSqlite schema whitelist + `buildWhere` undefined guard) are all verified
in place across the current source.
