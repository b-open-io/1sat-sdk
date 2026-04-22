# Storage provider parity — fresh-agent handoff

**As of 2026-04-21 end of day.** Prior agent ran four parallel audits and landed an initial parity sweep. Multiple CRIT-severity findings remain unvalidated. Your job: validate each finding independently, then land fixes in grouped commits with user review between groups.

---

## Prime directive

**Do not act on any finding without validating it first.** The prior agent's audits were produced by sub-agents operating on grep + code reading. Several findings reference specific line numbers that may be correct, but the *behavior* claimed needs to be reproduced. Validate by:

1. Reading the cited code at the cited line.
2. Mentally (or via a small test) simulating the described input.
3. Only then writing the fix.

If you can't reproduce a finding, mark it "unconfirmed" and ask the user before proceeding. Silent mis-fixes compound the problem.

---

## Repos you'll be touching

| Repo | Path | Role |
|---|---|---|
| wallet-toolbox | `/Users/davidcase/Source/1sat/wallet-toolbox` | Canonical `StorageKnex` + `StorageIdb` |
| 1sat-sdk | `/Users/davidcase/Source/1sat/1sat-sdk` | `StorageBunSqlite` + published `@1sat/*` packages |
| yours-wallet | `/Users/davidcase/Source/1sat/yours-wallet` | Consumer of `@bsv/wallet-toolbox-mobile` |
| go-wallet-toolbox | `/Users/davidcase/Source/1sat/go-wallet-toolbox` | Reference only; we are abandoning it for TS |

## Current branch state

- **wallet-toolbox**: branch `fix/storage-provider-parity` (pushed to `b-open-io/wallet-toolbox`). Rebased onto `origin/master` at 2.1.21. Three commits:
  - `e386f171` StorageIdb: align filter/update semantics with Knex canon (parity sweep)
  - `2b1f0ef4` StorageIdb: drop r.txid guard in filterProvenTxReqs user scope
  - `90ea80f4` @bopen-io/wallet-toolbox@2.1.21-parity-fix.0 (package rename)
  - `62ec0a03` CHANGELOG

  Draft PR: https://github.com/bsv-blockchain/wallet-toolbox/pull/151

- **1sat-sdk**: `master` is clean, pushed. All downstream packages bumped and published (list in "What's published" below).

## What's published (NPM)

Use these in downstream `package.json` bumps when you land new versions:

- `@bopen-io/wallet-toolbox@2.1.21-parity-fix.0`
- `@bopen-io/wallet-toolbox-mobile@2.1.21-parity-fix.0`
- `@1sat/client@0.0.22`
- `@1sat/wallet@0.0.52`
- `@1sat/wallet-node@0.0.35`
- `@1sat/wallet-remote@0.0.27`
- `@1sat/wallet-browser@0.0.41`
- `@1sat/wallet-server@0.0.6`
- `@1sat/actions@0.0.103`
- `@1sat/connect@0.0.39`
- `@1sat/react@0.0.48`
- `@1sat/extension@0.0.8`
- `@1sat/sweep-ui@0.0.38`
- `@1sat/cli@0.0.38`

mss1 (`wallet.shruggr.cloud`) is running from source via `git pull` against 1sat-sdk master; systemd service `1sat-wallet-server.service`.

---

## What's in the parity sweep already landed (do NOT duplicate)

All on branch `fix/storage-provider-parity`. When doing your validation passes, these fixes should be present and working.

1. `StorageIdb.filterOutputTagMaps` — user-scope dead code (`&& r.txid` check on a table that has no `txid` field) removed. `getOutputTagMapsForUser` now actually scopes by userId via countOutputTags sub-query.
2. `StorageIdb.filterProvenTxReqs` — same `&& r.txid` guard dropped.
3. `StorageIdb.filterOutputs` — empty-array `txStatus` guarded with `.length > 0`.
4. `StorageIdb.filterTransactions` — empty-array `status` guarded with `.length > 0`.
5. `StorageIdb` — `assertNoUndefinedInPartial` helper added, called from every `filterX` method. Throws `WERR_INVALID_PARAMETER` on undefined values in partial, matching Knex's `Undefined binding(s) detected` behavior.
6. `StorageIdb` — all truthiness guards (`if (args.partial.X && r.X !== args.partial.X)`) swept to `!== undefined` across every filter method (106 replacements).
7. `StorageIdb.updateIdb` — returns real count of updated rows instead of always `1`.
8. `1sat-sdk/packages/wallet-node/src/storage-bun-sqlite.ts`:
   - Schema whitelist on `insertRow` / `updateRows` / `updateTransaction` / `updateProvenTxReq` — unknown keys in incoming payloads are dropped before building SQL.
   - `buildWhere` throws `WERR_INVALID_PARAMETER` on undefined partial values.
   - `insertRow` preserves explicit `null` (drops only `undefined`) — NOT NULL violations surface instead of being rewritten to column DEFAULT.

---

## Audit reports (source of findings to validate)

Read all four before doing any work.

| Report | Scope |
|---|---|
| `docs/plans/2026-04-21-storage-provider-divergences.md` | Original round-1 audit (background agent, grep-based) |
| `docs/plans/2026-04-21-read-path-audit.md` | `listOutputs` / `listActions` / `listCertificates` end-to-end |
| `docs/plans/2026-04-21-entity-surface-audit.md` | `find/count/insert/update` across all 15 entity types |
| `docs/plans/2026-04-21-sync-path-audit.md` | `getSyncChunk` / `processSyncChunk` / `EntityX` merge methods |
| `docs/plans/2026-04-21-action-lifecycle-audit.md` | `createAction` / `signAction` / `processAction` / `internalizeAction` / `abortAction` / `allocateChangeInput` / `purgeData` / `validateOutputScript` |

Also read the context doc for **why** we did this audit:

- `docs/plans/2026-04-21-orphan-outputtagmoss-analysis.md` — Dan's yours-wallet IDB investigation (multi-account IDB, 62 orphan `output_tags_map` rows, `listOutputs` locking-script bug)

---

## Consolidated findings list to validate

Work through these in this order. **For each: validate first, then fix.** Do not land more than one group of fixes at a time without user review.

### CRIT — data integrity / observable corruption

**CRIT-1 — `internalizeAction` doesn't populate `scriptOffset`/`scriptLength` on output inserts**

Source: action-lifecycle audit §CRIT-1.

Claim: The four output writers in `wallet-toolbox/src/storage/methods/internalizeAction.ts` (L463 `storeNewWalletPaymentForOutput`, L494 `mergeWalletPaymentForOutput`, L511 `mergeBasketInsertionForOutput`, L528 `storeNewBasketInsertionForOutput`) write `lockingScript` but omit `scriptOffset`/`scriptLength`. The only site that sets them is `processAction.ts:360-365`.

Validate by:
1. Read those four functions. Confirm they don't compute or set `scriptOffset`/`scriptLength`.
2. Read `processAction.ts:360-365`. Confirm it's the only site populating them.
3. Check if `validateOutputScript` (StorageProvider.ts:821) gracefully falls back when offsets are missing — it does, it uses `lockingScript` as-is. But when `listOutputsIdb` passes `noScript:true`, the script is cleared in `findOutputs` L1718, then `validateOutputScript` bails at L823 because offsets are missing.
4. Confirm this matches Dan's BAP output state (stored `lockingScript` present, `scriptOffset`/`scriptLength` both undefined in IDB).

Fix: `internalizeAction.ts` needs to compute the offsets when it has `rawTx` available and set them on the output insert. Match the logic in `processAction.ts:360-365`.

**CRIT-2 — `updateTransactionStatus('failed')` doesn't unspendable child outputs (ghost output bug)**

Source: action-lifecycle audit §CRIT-3.

Claim: `StorageProvider.ts:482-495` only restores INPUTS (prior outputs that were spent by the failing tx). It never touches the failing tx's own OUTPUTS. They were inserted with `spendable=true` and stay that way. Same gap in all three providers.

Validate by:
1. Read `StorageProvider.ts:482-495`.
2. Read `abortAction` (search for it — lives in `methods/`).
3. Check Dan's BAP basket on mss1: 11 outputs with `spendable=true` but their transaction has `status='failed'`. Should be `spendable=false`.
4. Confirm `createAction`/`processAction` don't somehow mark the outputs `spendable=false` on the way to failed state.

Fix: in the `'failed'` branch of `updateTransactionStatus` (and `abortAction`), after restoring inputs, also set `spendable=false` (and possibly null out `basketId`) on outputs where `transactionId === tx.transactionId`.

**CRIT-3 — `purgeDataIdb` is a no-op stub**

Source: action-lifecycle audit §CRIT-2.

Claim: `wallet-toolbox/src/storage/methods/purgeDataIdb.ts` returns `{count:0, log:''}` with a TODO. Canon `methods/purgeData.ts` is 251 lines across four phases.

Validate by:
1. Read `purgeDataIdb.ts` — confirm stub.
2. Read `purgeData.ts` — understand the four phases: completed-data trimming, failed-tx cascade delete, spent-tx cleanup with proof preservation, orphan proven_txs deletion.
3. Confirm Idb-backed deployments (yours-wallet, wallet-browser) have no equivalent cleanup path.

Fix: port `purgeData.ts` to Idb semantics. This is a sizable change — budget for a careful port and unit tests.

**CRIT-4 — BunSqlite `findOutputs`/`countOutputs` drop `tagIds`, `findTransactions`/`countTransactions` drop `labelIds`**

Source: entity-surface audit §CRITICAL-1.

Claim: BunSqlite's signatures don't even accept these args. `listOutputs({tags:[...]})` and `listActions({labels:[...]})` silently return everything.

Validate by:
1. Read BunSqlite's `findOutputs` / `findTransactions` signatures — compare to Knex.
2. Grep for callers passing `tagIds` / `labelIds` and confirm they break silently.
3. Test mentally: what does `mss1` return for `listOutputs({basket:'bap', tags:['type:alias']})`? Should return only type:alias outputs. Does it actually apply the tag filter?

Fix: add `tagIds` / `labelIds` args to BunSqlite and implement the filter. Match Knex semantics (IN clause against the map tables with whereExists).

**CRIT-5 — BunSqlite boolean coercion on insert binds raw true/false**

Source: entity-surface audit §CRITICAL-2.

Claim: `validateEntityForInsert` does `entity[df] = value ? 1 : 0` AFTER `v = {...entity}`. The copy `v` has the original true/false. BunSqlite binds `v`, so booleans reach the driver untransformed. Knex/MySQL coerce; `bun:sqlite` likely does not.

Validate by:
1. Read `validateEntityForInsert` in the relevant file.
2. Run an actual insert with a boolean field (e.g., `insertOutputBasket({isDeleted:false})`) against a bun:sqlite DB and check the stored value. Could be 0/1 if bun:sqlite auto-coerces, could be blob/error if not.
3. If the bug reproduces, quantify which boolean fields on which tables are affected.

Fix: either change `validateEntityForInsert` to mutate `v` directly (change the caller), or have BunSqlite pre-coerce booleans on insert.

### HIGH — silent wrong results

**HIGH-6 — `syncMap.X.idMap[id]` lookups silently propagate undefined**

Source: sync-path audit §1.

Claim: `EntityProvenTxReq.mergeNew:523`, `EntityTransaction.mergeExisting:282`, `EntityOutput.mergeNew:256` all do `syncMap.X.idMap[id]` with no guard. On a miss:
- SQL providers hit NOT NULL constraint (loud)
- IDB silently inserts an orphan (quiet)

Validate by:
1. Read the three cited lines.
2. Construct a sync-chunk scenario where an idMap miss is possible (e.g., an output referencing a transaction that was purged before sync).
3. Verify the symptom on each provider.

Fix: guard at the call site. Throw an explicit "unmapped X in syncMap" error if `syncMap.X.idMap[id]` is undefined.

**HIGH-7 — Idb `listOutputs` missing `'sending'` from txStatus allowed list**

Source: read-path audit §CRIT-2.

Claim: `listOutputsIdb.ts:101` uses `['completed', 'unproven', 'nosend']`. Knex (`listOutputsKnex.ts:131`) and BunSqlite (`storage-bun-sqlite.ts:3027`) use `['completed', 'unproven', 'nosend', 'sending']`. Mid-broadcast outputs disappear only on Idb.

Validate: just read the three lines and confirm.

Fix: one-line change.

**HIGH-8 — Idb `getTagsForOutputId` / `getLabelsForTransactionId` use `verifyOne`**

Source: read-path audit §HIGH-6.

Claim: IDB's two-step lookup (`StorageIdb.ts:455-463` / `:444-452`) uses `verifyOne` which throws if a soft-deleted tag/label still has a non-deleted map row. Knex/Bun silently drop via JOIN.

Validate by:
1. Read both methods.
2. Construct: an output_tag row with `isDeleted=true`, and an output_tags_map row referencing it with `isDeleted=false`. Call `getTagsForOutputId`.
3. Confirm IDB throws, Knex/Bun return empty.

Fix: change `verifyOne` to silently skip missing/deleted parent rows.

**HIGH-9 — `partial: {x: null}` divergence**

Source: entity-surface audit §HIGH-3.

Claim: Knex's `.where({x: null})` emits `x = NULL` (always false → 0 rows). IDB compares with `===` (returns IS-NULL rows). BunSqlite emits `IS NULL` (returns IS-NULL rows).

Validate by:
1. Read Knex's `setupQuery` and verify what `.where({x: null})` produces in SQL.
2. Read IDB's filter handling for null.
3. Read BunSqlite's `buildWhere` (already reads `val === null` → `${col} IS NULL`).

Fix: in Knex `setupQuery`, translate `null` values in partial to `.whereNull(col)`.

**HIGH-10 — Paginated sync chunks have no ORDER BY**

Source: sync-path audit §2.

Claim: `getSyncChunk` paginates via offset/limit. Knex/BunSqlite `setupQuery`/`selectQuery` only emit ORDER BY when `orderDescending` is true. Sync never sets it. SQL is free to return rows in any order across chunks → skip or duplicate.

Validate by:
1. Read `setupQuery` / `selectQuery` in Knex and Bun.
2. Read getSyncChunk — confirm it paginates without setting orderDescending.
3. Check IDB — walks keyPath order, safe.

Fix: always emit `ORDER BY <primary_key>` on paginated queries in Knex/Bun.

**HIGH-11 — `updateIdb` throws on missing id in batch**

Source: entity-surface audit §HIGH-5.

Claim: IDB throws `not found` if any id in the batch doesn't exist. Knex/Bun just return partial count.

Validate: read the three implementations.

Fix: continue past missing rows, return actual updated count. (This was touched in the prior parity sweep — `updateIdb` now returns real count — but may not have changed the throw-on-missing behavior.)

**HIGH-12 — BunSqlite `countProvenTxReqs` ignores `args.txids` filter**

Source: entity-surface audit §HIGH-6.

Claim: `find` and `count` disagree — `find` respects `txids`, `count` doesn't.

Validate: read both.

Fix: apply the same txids filter in `countProvenTxReqs`.

**HIGH-13 — `findOrInsertX` helpers don't pass `trx` to update calls**

Source: entity-surface audit §HIGH-7.

Claim: `StorageReaderWriter.findOrInsertOutputBasket / TxLabel / OutputTag / OutputTagMap / TxLabelMap / SyncStateAuth / User` don't propagate the `trx` argument to internal update calls. Deadlock risk on IDB when called inside a `transaction()`.

Validate: read each `findOrInsertX` helper.

Fix: thread `trx` through.

### MED — behavioral inconsistency

**MED-14 — `allocateChangeInput` script hydration divergence**

Source: action-lifecycle audit §CRIT-4 (downgraded — P2PKH change is 25 bytes, below `maxOutputScript=1024`, so hydration via SELECT works today without `validateOutputScript`).

Claim: Knex calls `validateOutputScript` after change-input selection. IDB and Bun don't. Latent bug — breaks when a non-P2PKH change template is introduced.

Validate: read all three.

Fix: add `validateOutputScript` call in IDB and Bun.

**MED-15 — `recentlyActiveUsers` is Knex-only**

Source: entity-surface audit §HIGH-4.

Claim: IDB and BunSqlite throw or are missing the implementation.

Validate: search for the method in all three.

Fix: implement in IDB and Bun, or mark as optional and guard callers.

**MED-16 — Idb negative paging offset throws; Knex/Bun reverse to DESC**

Source: read-path audit §MED-3.

Claim: `listOutputsIdb.ts:20` throws on negative offset.

Validate: read the line.

Fix: match Knex/Bun behavior (treat negative offset as DESC).

**MED-17 — Idb `findOutputs(noScript:true)` wipes lockingScript even when present**

Source: entity-surface audit §MED-10 + read-path audit §CRIT-1.

Same underlying bug as the Dan lockingScript issue. Covered by the fix for CRIT-1 likely.

**MED-18 — Idb `findTransactions(noRawTx:true)` also clears `inputBEEF`**

Source: entity-surface audit §MED-11.

Claim: inconsistency — `noRawTx` shouldn't touch `inputBEEF`.

Validate: read IDB's findTransactions.

Fix: don't clear `inputBEEF` when only `noRawTx` was requested.

**MED-19 — Idb `insertCertificate` doesn't strip non-schema `logger` field**

Source: entity-surface audit §MED-12.

Claim: Knex/BunSqlite strip it, IDB stores it.

Validate: read IDB's insertCertificate.

Fix: strip the field.

### LOW — stylistic / perf / redundancy

- **LOW-20** — `EntityProvenTxReq.mergeExisting` always writes and returns false → `updates` counter under-reports.
- **LOW-21** — `EntityOutputBasket.equals` omits `isDeleted` even though `mergeExisting` propagates it.
- **LOW-22** — `since` filter uses `>=` so boundary rows re-merge each cycle.
- **LOW-23** — BunSqlite `updateRows` runs `changes()` query twice.
- **LOW-24** — BunSqlite always sets `created_at`/`updated_at` JS-side; Knex lets DB defaults fire.
- **LOW-25** — BunSqlite `transaction()` is SAVEPOINT on a single connection — silently masks missing-`trx` bugs that would break under Knex.
- **LOW-26** — BunSqlite listOutputs always runs COUNT before LIMIT (wasted work).
- **LOW-27** — `validateOutputScript` silently early-bails — should debug-log.
- **LOW-28** — Idb `getProvenOrRawTx` status set lacks `unfail`.

---

## Suggested fix grouping (review with user before landing)

Each group = one commit + one user review cycle. Don't skip the review.

**Group A — Dan's immediate pain points (user-visible bugs)**
- CRIT-1 (internalizeAction offsets) — closes the lockingScript bug at the insert-time root.
- CRIT-2 (failed tx unspendable outputs) — closes the ghost-output bug.
- HIGH-7 (Idb 'sending' in txStatus) — one-liner, drop-in.
- MED-17 (covered by CRIT-1).

Cuts `@bopen-io/wallet-toolbox@2.1.21-parity-fix.1` + mirror the same to mobile. Cascade through 1sat-sdk and yours-wallet.

**Group B — BunSqlite-specific correctness**
- CRIT-4 (tagIds/labelIds filters).
- CRIT-5 (boolean coercion) IF validated.
- HIGH-12 (countProvenTxReqs txids).

Cuts `@1sat/wallet-node` patch. mss1 redeploys.

**Group C — Sync / correctness HIGHs**
- HIGH-6 (unmapped idMap guards).
- HIGH-8 (getTagsForOutputId verifyOne).
- HIGH-9 (null partial in Knex).
- HIGH-10 (ORDER BY on paginated sync).
- HIGH-11 (updateIdb partial batch).
- HIGH-13 (trx threading).

Cuts `@bopen-io/wallet-toolbox@2.1.21-parity-fix.2`.

**Group D — Maintenance + MEDs**
- CRIT-3 (purgeDataIdb port) — large, separate PR.
- MED-14, 15, 16, 18, 19.

Cuts `@bopen-io/wallet-toolbox@2.1.21-parity-fix.3`.

**Group E — LOW-priority hygiene** — batch whenever convenient.

---

## Publishing workflow

Match the sequence already established:

1. Land fixes on `fix/storage-provider-parity` in wallet-toolbox (commit with descriptive message).
2. Update CHANGELOG entry for the new version suffix.
3. Bump both `package.json` and `mobile/package.json` `version` in lockstep (`2.1.21-parity-fix.N`).
4. `npm install` (regenerates lockfile).
5. `npm run build` — must be clean.
6. `git push bopen fix/storage-provider-parity --force-with-lease` (rebased branch).
7. Update draft PR #151 description with the new fixes.
8. `bun publish --access public` in root and `mobile/`.
9. Bump peer-dep consumers in 1sat-sdk (all packages that use `@bsv/wallet-toolbox` via the npm alias).
10. `rm -f bun.lock && bun install`, rebuild, commit, push master, publish 1sat-sdk packages in dep order (see `CLAUDE.md` at 1sat-sdk root for dep order).
11. `ssh mss1 "cd ~/workspace/1sat/sdk && git pull && rm -f bun.lock && bun install && systemctl --user restart 1sat-wallet-server.service"` to redeploy.
12. Hand updated package.json diff to yours-wallet agent (or apply if you own that repo).

## Critical process constraints

From user's memory rules:
- **No git stash, restore, reset** without explicit permission.
- **Commit work before pulling** — don't leave uncommitted changes.
- **Ask for destructive git ops** (force push, reset --hard, etc.).
- **Don't auto-revert** on user pushback — drop tools and discuss.
- **Don't re-publish if npm shows old version** — publish delay is up to 5 min. Just wait.

From `1sat-sdk/CLAUDE.md`:
- Dep order: types → utils → client → core → actions/wallet → sdk → examples
- connect before react (react depends on connect via workspace:*)
- `workspace:*` references resolve from lockfile at publish time
- Clean dist/ before building
- After publishing, verify with `npm view @1sat/<pkg> dependencies`

Use **Bun**, not npm, for all 1sat-sdk scripts. wallet-toolbox uses npm.

## Environment

- **mss1** — `ssh mss1`, runs `1sat-wallet-server.service`, CLI from source. `wallet.shruggr.cloud` → port 8100 via Cloudflare.
- **ovh-n0001** — `ssh ovh-n0001`, runs 1sat-stack + go-wallet-toolbox. Postgres for wallet. `api.1sat.app`.
- **rack** — `ssh rack`, another 1sat-stack instance with `~/.1sat/wallet.sqlite` (hand-written go-wallet-toolbox DB).

Dan's test identity: `02e0c4688774ce2bb048032fe5d569cc42301dde6b01025759be253ba64d183fd3`.

## Validation test data

Dan's IDB backup at `/Users/davidcase/Downloads/Archive/` (msgpack-encoded SyncChunks). Decode script pattern:

```ts
import { decode } from '@msgpack/msgpack'
import { readFileSync } from 'fs'
const chunk = decode(readFileSync('/Users/davidcase/Downloads/Archive/chunk-0000.bin')) as any
```

Useful for reproducing:
- Multi-account IDB scenarios
- Failed-tx ghost output scenarios
- Missing `scriptOffset`/`scriptLength` on outputs with lockingScript present

mss1 wallet sqlite at `~/.1sat/cli/data/wallet-main.db` — live state to cross-check fixes against.

---

## What success looks like

When you're done:

1. Each finding above is either a landed fix, marked "unconfirmed — not reproduced", or downgraded with explanation.
2. All fixes grouped into discrete commits with review cycles.
3. Groups A and B published. yours-wallet agent has the package.json diff for picking up the new versions.
4. mss1 redeployed and verified — adding it as a remote from yours-wallet succeeds, BAP profile renders, failed transactions don't leave ghost outputs in baskets.
5. Consolidated CHANGELOG entry on `@bopen-io/wallet-toolbox` covering all landed fixes.
6. Group C / D / E queued for subsequent PRs. User informed of what's in-flight vs deferred.

Don't rush. Don't skip validation. Ask if uncertain.
