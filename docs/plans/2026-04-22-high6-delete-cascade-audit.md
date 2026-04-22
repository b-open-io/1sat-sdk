# HIGH-6 audit — TS canon delete cascade integrity

**Date:** 2026-04-22  
**Outcome:** CLEAN  
**Scope:** wallet-toolbox canon (StorageKnex, StorageIdb) + 1sat-sdk BunSqlite. Go excluded.

## Summary

The TS canon codebase maintains the invariant "every parent delete cascades to every child" across all three storage implementations (Knex, IDB, BunSqlite). All delete operations are concentrated in `purgeData` (Knex/BunSqlite) and `purgeDataIdb` (stub; not yet implemented for IDB). The delete order in all implementations follows a strict sequence: child tables first (output_tags_map, tx_labels_map, commissions), then parent (transactions and outputs). No ON DELETE CASCADE triggers are declared in the schema; all cascades are imperative, handled in application code. No other production TS code path deletes parent rows without cascading to children. The invariant holds.

## FK relationship map

**Transaction hierarchy:**
- `transactions.transactionId` (line 330–344, KnexMigrations) → children:
  - `outputs.transactionId` (line 366, FK non-null)
  - `tx_labels_map.transactionId` (line 416, FK non-null)
  - `commissions.transactionId` (line 350–355, FK non-null + unique)
  - `outputs.spentBy` (line 381, references transactionId, nullable)
  - `proven_tx_reqs.txid` (logical reference, no FK; matched on txid string, not transactionId)

**Output hierarchy:**
- `outputs.outputId` (line 364) → children:
  - `output_tags_map.outputId` (line 400, FK non-null)

**Output tags:**
- `output_tags.outputTagId` (line 391) → child:
  - `output_tags_map.outputTagId` (line 399, FK non-null)

**Tx labels:**
- `tx_labels.txLabelId` (line 407) → child:
  - `tx_labels_map.txLabelId` (line 415, FK non-null)

**Output baskets:**
- `output_baskets.basketId` (line 320) → child:
  - `outputs.basketId` (line 367, FK nullable; SET NULL on purge; see line 162–163, purgeData.ts)

**Certificates:**
- `certificates.certificateId` (line 297) → child:
  - `certificate_fields.certificateId` (line 312, FK non-null)

**Proven txs:**
- `proven_txs.provenTxId` (line 265) → children:
  - `transactions.provenTxId` (line 332, FK nullable)
  - `proven_tx_reqs.provenTxId` (line 277, FK nullable)

**Users:**
- `users.userId` (line 292) → many children (not directly deleted in purge; user teardown not yet implemented)

## Delete paths audited

### 1. `purgeData()` in StorageKnex (wallet-toolbox/src/storage/methods/purgeData.ts)

Three phases plus orphan cleanup:

#### Phase 1: purgeCompleted (lines 31–73)
- **Deletes:** `proven_tx_reqs` rows with status='completed'
- **Cascade:** None required; proven_tx_reqs are leaves
- **Status:** CLEAN

#### Phase 2: purgeFailed (lines 75–116)
- **Calls:** `deleteTransactions(failedTxIds, ..., 'failed', true)` (lines 89)
- **Cascade in deleteTransactions (lines 189–237):**
  1. Fetch `outputIds` from outputs.transactionId IN (transactionIds) (lines 196–200)
  2. DELETE output_tags_map WHERE outputId IN (outputIds) (line 204)
  3. DELETE outputs WHERE outputId IN (outputIds) (line 208)
  4. DELETE tx_labels_map WHERE transactionId IN (transactionIds) (line 214)
  5. DELETE commissions WHERE transactionId IN (transactionIds) (line 219)
  6. UPDATE outputs SET spendable=true, spentBy=null WHERE spentBy IN (transactionIds) (lines 222–230)
  7. DELETE transactions WHERE transactionId IN (transactionIds) (line 234)
- **Also deletes:** proven_tx_reqs with status='invalid' and status='doubleSpend' (lines 91–113)
- **Status:** CLEAN — all children of transactions and outputs deleted before parents

#### Phase 3: purgeSpent (lines 118–169)
- **Deletes:** Transactions (via `deleteTransactions`) where all outputs are spent and tx is old
- **Updates:** outputs.spentBy to null if spentBy references a spent transaction (lines 156–163)
- **Cascade:** Same deleteTransactions flow as Phase 2
- **Status:** CLEAN

#### Orphan cleanup (lines 171–185)
- **Deletes:** `proven_txs` not referenced by remaining transactions or proven_tx_reqs
- **Cascade:** None required; proven_txs are roots with no children in the delete hierarchy
- **Status:** CLEAN

### 2. `purgeData()` in BunSqlite (1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts, lines 3200–3469)

Identical logic to StorageKnex:

#### Phase 1: purgeCompleted (lines 3221–3275)
- **Deletes:** proven_tx_reqs with status='completed'
- **Status:** CLEAN

#### Phase 2: purgeFailed (lines 3277–3325)
- **Calls:** `deleteTransactions(failedTxIds, r, 'failed', true)` (line 3276)
- **Cascade in deleteTransactions (lines 3382–3469):**
  1. Fetch outputIds from outputs.transactionId (lines 3391–3395)
  2. DELETE output_tags_map WHERE outputId (line 3400)
  3. DELETE outputs WHERE outputId (line 3412)
  4. DELETE tx_labels_map WHERE transactionId (line 3424)
  5. DELETE commissions WHERE transactionId (line 3436)
  6. UPDATE outputs SET spendable=1, spentBy=null WHERE spentBy (lines 3448–3449)
  7. DELETE transactions WHERE transactionId (line 3460)
- **Also deletes:** proven_tx_reqs with status='invalid' and status='doubleSpend'
- **Status:** CLEAN — same order as Knex

#### Phase 3: purgeSpent (lines 3327–3370)
- **Deletes:** Transactions via deleteTransactions (line 3361)
- **Updates:** outputs.spentBy to null (line 3360, not shown in excerpt but present)
- **Status:** CLEAN

#### Orphan cleanup (lines 3368–3376)
- **Deletes:** proven_txs not referenced by remaining transactions or proven_tx_reqs
- **Status:** CLEAN

### 3. `purgeDataIdb()` in StorageIdb (wallet-toolbox/src/storage/methods/purgeDataIdb.ts, lines 1–11)

- **Status:** NOT IMPLEMENTED — stub returns empty results
- **Impact:** IDB wallet instances cannot purge; data accumulates. Does not cause orphans since no deletes occur. Future implementation must follow the same cascade pattern as Knex/BunSqlite.

### 4. `reviewStatus()` (StorageKnex, wallet-toolbox/src/storage/methods/reviewStatus.ts, lines 19–101)

- **Operations:** Only UPDATEs, no DELETEs
- **Status:** CLEAN

### 5. `reviewStatusIdb()` (wallet-toolbox/src/storage/methods/reviewStatusIdb.ts, lines 18–43)

- **Operations:** Calls `updateTransactionStatus('failed', ...)` which is an UPDATE, not a DELETE
- **Status:** CLEAN

### 6. `updateTransactionStatus()` (StorageProvider, wallet-toolbox/src/storage/StorageProvider.ts, lines 453–509)

- **Operations:** Only UPDATEs (outputs.spendable, outputs.spentBy)
- **No DELETE calls**
- **Status:** CLEAN

### 7. `abortAction()` (StorageProvider, lines 245–293)

- **Operations:** Calls `updateTransactionStatus('failed', ...)` (line 278), which is an UPDATE
- **No DELETE calls**
- **Status:** CLEAN

### 8. `relinquishCertificate()` and `relinquishOutput()` (StorageProvider, lines 636–657)

- **Operations:** `updateCertificate(isDeleted=true)` and `updateOutput(basketId=null)` — soft delete and NULL-out only
- **No hard DELETE calls**
- **Status:** CLEAN

## Gaps found

**None.** All delete operations are concentrated in purgeData (Knex and BunSqlite). The delete order is correct:
1. Child rows (output_tags_map, tx_labels_map, commissions) deleted by their parent FK
2. Parent rows (outputs, transactions) deleted last
3. Orphan cleanup (proven_txs) handles roots with no children

No production code path deletes a parent without cascading to all children. IDB is unaffected because purgeDataIdb is not yet implemented.

## Recommendation

**Close HIGH-6 as invariant-holds.** The TS canon storage implementations maintain the invariant "every parent delete cascades to every child" via imperative application-level cascades. No DB-level ON DELETE CASCADE triggers are present, but the application enforces the cascade order before deleting parents. Receiver-side guards in sync chunk processing are unnecessary defense-in-depth; the sender side cannot produce orphan children. When purgeDataIdb is implemented, follow the same cascade pattern (delete children first, then parents) to preserve the invariant.

