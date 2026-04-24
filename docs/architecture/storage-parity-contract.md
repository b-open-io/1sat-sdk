# Storage Parity Contract

Cross-provider behavioral contracts for the three `StorageProvider` implementations in `@bsv/wallet-toolbox` + `1sat-sdk`: Knex (canon), IndexedDB, BunSqlite.

## Delete Cascade Order

**Invariant:** Every parent delete cascades to every child. No ON DELETE CASCADE triggers — all cascades are imperative, enforced in application code.

All delete operations are concentrated in `purgeData` (Knex, BunSqlite) or `purgeDataIdb` (IDB — stub, not yet implemented). Other code paths use soft deletes (`isDeleted=true`) or NULL-out (`basketId=null`, `spentBy=null`), never hard DELETE.

### Required cascade sequence for `deleteTransactions`

1. Fetch `outputIds` from `outputs.transactionId IN (...)`
2. `DELETE output_tags_map WHERE outputId IN (...)` — child of outputs
3. `DELETE outputs WHERE outputId IN (...)` — parent of output_tags_map
4. `DELETE tx_labels_map WHERE transactionId IN (...)` — child of transactions
5. `DELETE commissions WHERE transactionId IN (...)` — child of transactions
6. `UPDATE outputs SET spendable=true, spentBy=null WHERE spentBy IN (...)` — orphan spend refs
7. `DELETE transactions WHERE transactionId IN (...)` — parent

### Purge phase ordering

1. **purgeCompleted** — delete `proven_tx_reqs` rows with `status='completed'` (leaves, no cascade)
2. **purgeFailed** — `deleteTransactions(failedTxIds, 'failed')` then delete `proven_tx_reqs` with status `invalid`/`doubleSpend`
3. **purgeSpent** — `deleteTransactions` for old txs with all outputs spent
4. **Orphan cleanup** — delete `proven_txs` not referenced by any remaining transaction or proven_tx_req

### FK hierarchy (wallet-toolbox schema)

```
users.userId
  └─ (many children, teardown not yet implemented)

proven_txs.provenTxId
  ├─ transactions.provenTxId (nullable)
  └─ proven_tx_reqs.provenTxId (nullable)

transactions.transactionId
  ├─ outputs.transactionId (FK non-null)
  ├─ outputs.spentBy (FK nullable, SET NULL on purge)
  ├─ tx_labels_map.transactionId (FK non-null)
  └─ commissions.transactionId (FK non-null + unique)

outputs.outputId
  └─ output_tags_map.outputId (FK non-null)

output_tags.outputTagId
  └─ output_tags_map.outputTagId (FK non-null)

tx_labels.txLabelId
  └─ tx_labels_map.txLabelId (FK non-null)

output_baskets.basketId
  └─ outputs.basketId (FK nullable, SET NULL on purge)

certificates.certificateId
  └─ certificate_fields.certificateId (FK non-null)
```

**proven_tx_reqs.txid** is a logical (string) reference to transactions, no FK.

### When `purgeDataIdb` is implemented

Follow the same cascade pattern — children first, then parents. Do not introduce DB-level triggers.

## Partial-Null Find Semantics

**Divergence (theoretical HIGH):**

| Provider | `partial: { x: null }` | Behavior |
|----------|------------------------|----------|
| Knex | `WHERE x = NULL` | always false → **0 rows** |
| IDB | `r.x === null` check | **rows where x IS NULL** |
| BunSqlite | `WHERE x IS NULL` | **rows where x IS NULL** |

**Status:** No callers in `wallet-toolbox`, `1sat-sdk`, or `yours-wallet` pass `partial: { x: null }` to any `findX`/`countX`. Zero production impact.

**Contract:** `null` in a `partial` filter is **undefined behavior** — don't rely on any provider's current handling. Use explicit `.whereNull()` or shape-specific predicates when NULL matching is required.

**If a future caller surfaces this:** fix at the Knex layer via `.whereNull(col)` translation in `setupQuery`. This is one of few warranted exceptions to the "Knex is canon" rule.

**Do not confuse with UPDATE paths:** `{ spentBy: null as unknown as undefined }` in `reviewStatus.ts` and `purgeData.ts` goes through the UPDATE code path, which handles undefined/null uniformly across providers (writes NULL). That is not the partial/WHERE path.
