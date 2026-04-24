# HIGH-9 audit — `partial: {x: null}` usage in storage find calls

**Date:** 2026-04-22
**Outcome:** NOT-AN-ISSUE. No code fix required.

## Why this was audited

The entity-surface audit flagged a cross-provider divergence:

- Knex: `partial: {x: null}` → SQL `WHERE x = NULL` → always false → 0 rows.
- IDB: JS `r.x === null` → returns rows where `x` IS NULL.
- BunSqlite: `WHERE x IS NULL` → returns rows where `x` IS NULL.

The three providers give three different answers for the same call shape. Theoretical severity: HIGH. Practical severity depends on whether any caller actually uses this API shape.

## Search

Searched wallet-toolbox (`src`, `client`, `mobile`), 1sat-sdk (`packages`), and yours-wallet (`src`) for:

1. Inline `partial: { ... x: null ... }` object literals passed to any `findX` or `countX` method.
2. Multi-line `partial: {` blocks containing `: null`.
3. `: null }` patterns adjacent to `partial:` usage.
4. Typescript null-cast patterns (`null as unknown as undefined`, `null as any`).

## Results

**Zero callers pass `partial: {x: null}` to any find/count method across all three codebases.**

The null-cast pattern (`null as unknown as undefined`) is present in exactly two canon files, but only in UPDATE contexts, not find/partial:

- `wallet-toolbox/src/storage/methods/reviewStatus.ts:66` — `update({ spentBy: null as unknown as undefined, spendable: true })`
- `wallet-toolbox/src/storage/methods/purgeData.ts:154` — `spentBy: null as unknown as undefined` inside update payload
- `wallet-toolbox/src/storage/methods/purgeData.ts:227` — same pattern in update

These go through the UPDATE code path (write-side), which handles undefined/null uniformly across providers (Knex sets column to NULL, BunSqlite's `updateRows` writes NULL, IDB stores `undefined`). This is **not** the partial/WHERE path that HIGH-9 describes.

All 1sat-sdk and yours-wallet `null` occurrences are in public API return payloads (e.g. `{ isConnected: false, addresses: null }`), wallet-server RPC responses, and desktop RPC handlers — orthogonal to storage find partials.

## Decision

- HIGH-9 → **NOT-AN-ISSUE** (no callers).
- No code change in Knex, IDB, or BunSqlite `findX`/`partial` handling.
- If a future caller introduces `partial: {x: null}`, the divergence will surface and we can fix at that point per canonicity rule — either propagate Knex's SQL-level behavior (0 rows) or introduce an exception at the Knex layer. That is a decision for that future moment, not now.

## Note on the canonicity-rule awkwardness

Had HIGH-9 turned out to be a real-caller issue, the fix would have been Knex-side (`.whereNull(col)` translation in `setupQuery`), which would mark one of the few warranted exceptions to the "Knex is canon" rule. Since no caller exists, the question is moot and the canonicity rule holds without exception for this campaign.
