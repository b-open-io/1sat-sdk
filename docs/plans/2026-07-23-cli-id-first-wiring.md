# CLI + skills wiring for id-first actions

**Status:** Ready to implement (walkthrough closed)  
**Date:** 2026-07-23  
**Repo:** `1sat-sdk` monorepo  
**Depends on:** [P1SAT id-first actions](./2026-07-23-p1sat-id-first-actions.md) (library model)

## Context for a fresh session

### Why this exists

Wallet-owned P1SAT assets use **`id:`** tags. Spends load the row + BEEF by id from the basket — callers do **not** pass `inputBEEF` or a stale `WalletOutput` for those paths. Lists are metadata (tags/CI) by default. External spends still need **BEEF + outpoint**.

Work was partially started in `@1sat/actions` (uncommitted / in progress): helpers `carryTags`, `loadBasketOutput*`; OpNS id-based spends; ordinals carry-tags; etc. **This plan is the source of truth for final names and CLI.** Reconcile code to these tables; do not invent parallel APIs.

### Related product repos (after actions+cli)

- `1sat-name` — My Names already moving to `id`; keep in sync with renames
- `yours-wallet`, `wallet-desktop`, website — update when publishing
- Do **not** commit/publish until user reviews

### Tooling

- Bun workspaces; package `@1sat/actions`, `@1sat/cli`
- CLI entry: `packages/cli` — commands under `src/commands/`, help in `src/help.ts`
- Skills: `packages/actions/skills/*`, `packages/cli/skills/cli`, catalog in root `AGENTS.md` / plugin

---

## Conventions (locked)

| Verb | Meaning |
|------|---------|
| **`list*`** | Retrieve many |
| **`get*`** | Retrieve one / summary blob |
| **`sell*`** | Put on market (OrdLock) |
| **`buy*`** | Take from market |
| **`send*`** | Move asset/value to a recipient (**prefer over `transfer*`**) |
| **`inscribe`** | Raw file-on-chain (not “mint”) |
| **`mint*`** | Spec-layer issuance (BSV21 auth mint, collections) |
| **verbNoun** | Action names: `sellOpns`, `sendOrdinals` — not `opnsSell` |

| Surface | Rule |
|---------|------|
| **CLI role** | Agent surface for actions — flags map action inputs, not a minimal test subset |
| **List / lookup** | Tags on; **print `id`** every row; expose action optionals as flags |
| **Wallet-owned spend** | `--id` only → action `{ id }`. Action loads tags/CI/BEEF. No CLI outpoint→id helper |
| **External BEEF** | `--beef <file\|hex\|base64>` if set; else **services fetch** if available; else error |
| **Default receive** | Protocol `P1SAT` (`[0,'p 1sat']`), keyID **`1sat 0`**, counterparty self — used when sell `payAddress` omitted (**in the action**) |
| **Deprecation** | Export old names as aliases briefly if needed; skills/CLI use new names only |

---

## Action + CLI matrix

### OpNS

| Action (target) | Was | CLI | Flags | Notes |
|-----------------|-----|-----|-------|--------|
| `listOpns` | `getOpnsNames` | `opns lookup` | `--limit` `--offset` `--ids` `--names` `--tags` `--tag-query-mode` `--include` | Print id, name, outpoint |
| `registerOpns` | `opnsRegister` | `opns register` | `--id` | |
| `deregisterOpns` | `opnsDeregister` | `opns deregister` | `--id` | |
| `sellOpns` | `opnsList` | `opns sell` | `--id` `--price` [`--pay-address`] | payAddress optional in **action**; default receive |
| `cancelOpnsListing` | `opnsCancelListing` | `opns cancel-listing` | `--id` | Not generic cancelListing |
| `sendOpns` | `opnsTransfer` | `opns send` | `--id` `--to` | **New CLI.** `--to` → address or counterparty (identity key) |
| `internalizeOpns` | (same) | `opns internalize` | `--beef` [`--key-id`] | **New CLI.** Default key-id `1sat 0` |
| `buyOpns` | CLI used `purchaseOrdinal` | `opns buy` | `--outpoint` [`--beef`] | **New action.** File into OPNS basket + id/tags. BEEF rule |

### Ordinals

| Action (target) | Was | CLI | Flags | Notes |
|-----------------|-----|-----|-------|--------|
| `listOrdinals` | `getOrdinals` | `ordinals list` | `--limit` `--offset` `--ids` `--tags` `--tag-query-mode` `--include` | Print id |
| `sendOrdinals` | `transferOrdinals` | `ordinals send` | `--id` `--to` | was `ordinals transfer` |
| `sellOrdinal` | `listOrdinal` | `ordinals sell` | `--id` `--price` [`--pay-address`] | payAddress optional in action |
| `cancelOrdinalListing` | `cancelListing` | `ordinals cancel` | `--id` | |
| `buyOrdinal` | `purchaseOrdinal` | `ordinals buy` | `--outpoint` [`--beef`] | BEEF rule |
| `burnOrdinals` | (same) | `ordinals burn` | `--ids` | comma-separated |
| `inscribe` | (same) | `ordinals inscribe` | `--file` `--type` `--map` `--sign-with-bap` `--stream` `--stream-chunk-size` + dest if action has it | CLI was `mint` |

### BSV21 (CLI group was `tokens`)

| Action (target) | Was | CLI | Flags | Notes |
|-----------------|-----|-----|-------|--------|
| `listBsv21` | `listTokens` | `bsv21 list` | e.g. `--token-id` + list optionals | Group rename `tokens`→`bsv21` |
| `getBsv21Balances` | (same) | `bsv21 balances` | action optionals | Summary; `get` OK |
| `sendBsv21` | (same) | `bsv21 send` | `--token-id` `--amount` dest flags | Self dest must basket (library) |
| `buyBsv21` | `purchaseBsv21` | `bsv21 buy` | `--outpoint` `--token-id` `--amount` [`--beef`] | BEEF rule |
| `deployBsv21Mint` | (same) | `bsv21 deploy-mint` | symbol/amount/decimals/icon + dest | |
| `deployBsv21Auth` | (same) | `bsv21 deploy-auth` | symbol/decimals/icon + dest | |
| `mintBsv21` | (same) | `bsv21 mint` | auth-spend mint flags | Spec mint from auth UTXO |

### Locks

| Action (target) | Was | CLI | Flags | Notes |
|-----------------|-----|-----|-------|--------|
| `listLocks` | (new) | `locks list` | action optionals | was `locks info`; print **id** per UTXO |
| `getLockData` | (same) | — | none | Kept: summary blob (`totalLocked`, `unlockable`, `nextUnlock`). Not replaced by `listLocks` |
| `lockBsv` | (same) | `locks bsv` | `--sats` `--until` | was `locks lock` / `--blocks` |
| `unlockBsv` | (same) | `locks unlock` | [`--ids`] | omit = all matured |

---

## Library gaps to implement (if not already)

These are required by the matrix and id-first plan — verify/implement in `@1sat/actions`:

1. Renames + re-exports/aliases for old names during transition (optional; prefer clean break if user agrees).
2. Wallet-owned OpNS/ordinals spends: **`{ id }` only**; load via `loadBasketOutputBeef(basket, id)`.
3. Tag **carry** on self-moves; fixed domain basket; no `resolveOrdinalTags` for owned filing.
4. `sellOpns` / `sellOrdinal`: optional `payAddress` → derive `1sat 0` receive.
5. **`buyOpns`**: external outpoint + BEEF; file OPNS basket with type/origin/name/id.
6. `internalizeOpns`: full mint tags including `type:application/op-ns`, `origin:`, `name:`, `id:`.
7. `listOpns` / `listOrdinals` / `listLocks` / `listBsv21`: metadata default; tags on.
8. `unlockBsv({ ids? })`, `sendBsv21` self-destination basketed.
9. Sigma single inscribe: inscription **not** `noSend`; anchor `noSend` + `sendWith`.
10. Index exports + `action-registry` / gen-action-index if used.

---

## Skills to update

Update skill bodies and any action name lists so agents use **new** names and id-first / BEEF rules.

| Skill path | Update for |
|------------|------------|
| `packages/actions/skills/opns/SKILL.md` | All OpNS renames; id-first; sell/buy/send/internalize/list; no resolveOrdinalTags story for owned moves |
| `packages/actions/skills/ordinals-create/SKILL.md` | `inscribe`; listOrdinals |
| `packages/actions/skills/ordinals-marketplace/SKILL.md` | sellOrdinal, buyOrdinal, cancelOrdinalListing, sendOrdinals |
| `packages/actions/skills/tokens/SKILL.md` | listBsv21, buyBsv21, sendBsv21; CLI group bsv21 |
| `packages/actions/skills/locks/SKILL.md` | listLocks, lockBsv, unlockBsv ids |
| `packages/actions/skills/action-patterns/SKILL.md` | id-first pattern; carry tags; external BEEF+outpoint; regenerate action index if scripted |
| `packages/cli/skills/cli/SKILL.md` | Command map, flags, BEEF rule, group renames (`bsv21`, `locks list/bsv`, `ordinals inscribe/send`) |
| Root / plugin catalogs | `AGENTS.md`, `.claude-plugin` skill lists if they hardcode old names |

Also run `bun run scripts/gen-action-index.ts` (or equivalent) if action-patterns depends on it.

---

## CLI implementation notes

- **Files:** `packages/cli/src/commands/{opns,ordinals,tokens→bsv21,locks}.ts`, `help.ts`, command router if group name `tokens` changes.
- **Shared helpers:** parse `--beef` (file/hex/base64); resolve BEEF via services; parse `--to` as address vs identity key; print id from tags (`id:…` → bare id for flags).
- **Breaking CLI:** document in cli skill / changelog: `--outpoint` → `--id` for wallet owns; `tokens` → `bsv21`; `ordinals mint` → `inscribe`; `ordinals transfer` → `send`; `locks info/lock` → `list`/`bsv`.

---

## Verification

```bash
# from 1sat-sdk
bun run --filter '@1sat/actions' build
bun run --filter '@1sat/cli' build   # if applicable
# manual smoke (with test wallet)
1sat opns lookup
1sat ordinals list
1sat bsv21 list
1sat locks list
# then one mutator each domain with --id / external buy with --beef
```

- Typecheck CLI against local actions workspace.
- No publish until user sign-off.
- Leave work uncommitted unless user asks to commit.

---

## Implementation order

1. Complete/fix `@1sat/actions` to match **Action (target)** column + library gaps.
2. Update **skills** (actions + cli + action-patterns index).
3. Rewrite **CLI** commands + **help.ts** to match CLI column.
4. Smoke test locally.
5. User review → commit/publish actions then cli; then other consumers (1sat-name, wallets).

---

## Out of scope (unless pulled in)

- Full repair tool for UTXOs missing `id:`
- MNEE / cosign / identity / social CLI renames
- Premium services product behavior beyond BEEF fallback rule

---

## Live CLI testing checkpoint (2026-07-24)

**Status:** Smoke testing **done** for planned surfaces. Implementation + fixes uncommitted (review before publish).

### Environment (test wallet)

| Item | Value |
|------|--------|
| Active storage | **local** (after clean remote-first resync) |
| Backup | `https://wallet.1sat.app` |
| storageIdentityKey | `1sat-cli-f1e3a9dad9d23f76` (bumped from `…f75` to clear stale idMap) |
| Identity | `02ebe10482ce95fd92a33cae71dfacbbba3ad60911d96192d7ce0e6fa660a4751e` |
| Hosting | **subscribed** on wallet.1sat.app — `active: true`, `expiresAt: 1816458714`, pay tx `6db0d745…1118` |
| Paymail | `wassup@1sat.app` receive OK via `1sat messagebox sync` (0.1 BSV) |
| Deposit address | `1Gng4vJW55tcdJ4cpji4pfKUWzdERNNLEq` |

**Clean resync procedure that worked:** set `activeRemote` in config only (do **not** `set-active` while empty) → wipe local `wallet-main.db*` → open CLI (remote active, local pulls as backup) → then `remote set-active local`.

### OpNS id-first smoke

| Command | Result |
|---------|--------|
| `opns lookup` | OK — prints id |
| `opns buy` | OK — bought **wassup** |
| tags after buy | OK (`opns`, `type:application/op-ns`, `origin:`, `name:`, `id:`) |
| `opns sell` | OK (needed healthy funding UTXOs; stale spent coins on old local blocked sell) |
| tags after sell | OK (+`ordlock`, `price:`) |
| `opns cancel-listing` | OK on-chain + tags; CLI threw post-broadcast on old `@bsv/sdk` missing `Beef.fromBinaryView` — **fixed** (sdk ≥2.1.9) |
| `opns register` | OK — `opns:published`, PushDrop CI |
| `opns deregister` | OK (earlier session) |
| `opns sell` / `cancel` (post–seed-tags) | OK on **davidtest** — origin held through sell+cancel |
| `opns send` / `internalize` | Deferred (1sat-name later) |

**Assets:** **wassup** registered; **davidtest** unregistered after cancel. Re-`lookup` for current ids.

### Ordinals smoke

| Command | Result |
|---------|--------|
| `ordinals inscribe` | OK — SVG test; genesis `9a873cd8…` |
| `ordinals list` | OK — id / tags |
| `ordinals sell` → `cancel` | OK after `ordinalSeedTags` (origin genesis held) |
| external send → receive + `wallet sync` | OK — OriginIndexer `-2`; origin/type/`id:` filed |
| `ordinals buy` | OK — external listing `49b64de2….0`; tags origin/type/name/`id:` |
| `ordinals burn` | Skipped (not required) |

### BSV21 smoke

| Command | Result |
|---------|--------|
| receive GEMS via deposit + `wallet sync` | OK — tags + `id:` |
| `bsv21 send` self (3 of 9 GEMS) | OK — split 3+6, overlay fee 2000 sats (1000×2 outs) |
| MINTOK | Present but `token-not-active` on send (indexer); not blocking |

### Paymail / messagebox

| Command | Result |
|---------|--------|
| hosting subscribe (authfetch) | OK |
| external pay → `wassup@1sat.app` | OK |
| `1sat messagebox sync` | OK — `processed: 1` (0.1 BSV) |

`wallet sync` = address/owner only; paymail inbox = **`messagebox sync`** (default host `https://messagebox.1sat.app`).

### Code fixes from testing

- `ordinalSeedTags(output)` — origin promote + type/name; no drop/add; no `sha256` carry
- OpNS/ordinals: id-first one-load; OpNS owns sell/send/cancel (no patch-over builders)
- OriginIndexer `getMetadata(…, -2)` (was `0`)
- CLI: `messagebox sync`, `authfetch`; id-first command flags
- Single-shot inscribe still stamps `sha256:`; stream keeps `sha256:` + `stream-i:`

### Tooling added

- `1sat authfetch <method> <url> [--body] [--header]…`
- `1sat messagebox sync [--url] [--box]`

### Known pitfalls (do not re-litigate)

- Local SQLite can hold **multiple users**; always scope analysis to CLI identity userId.
- Stale `spendable=1` funding UTXOs break sell/list funding selection.
- Wiping local DB does **not** rotate `storageIdentityKey`.
- Self-send to own deposit address: createAction then sync **merge** does not re-apply tags/`id:` (edge case; not normal external receive).
- Do not special-case “own address” in `sendOrdinals` — external dest stays external.

### Still open (not blocking smoke)

1. User review of full dirty tree → commit/publish (actions then cli)
2. `opns send` / `internalize` when testing 1sat-name
3. locks (lower priority)

### Peripheral-files review (closed 2026-07-24)

The sdk/toolbox bumps and monitor change were reviewed separately. Outcome:

- `maxRebroadcastAttempts: 0` is **required** by `MonitorOptions`, not redundant — `0` means
  rebroadcast without limit; a positive cap marks the req invalid. Kept, with a comment.
- The `internalizeBeef` OrdLock purchase-relinquish loop was correctly removed: wallet-toolbox
  2.4.3's `internalizeAction` calls `markInputsSpent`, closing the gap the loop worked around.
  This makes the actions change **depend on** the toolbox bump — land the deps commit first.
- `resolveBeef` / `extractIdTag` deleted (no call sites left); `loadBasketOutputBeef` and
  `readAssetIdTag` replace them. `AGENTS.md` Action Conventions updated to the id-first rule.
- `bun.lock` also floats ~12 unrelated deps; inherent to lockfile regeneration with `^` ranges.
- `@1sat/cli` has 16 pre-existing `tsc` errors — none from this work. Its build is
  `bun build --compile`, which does not typecheck. Two are real bugs, tracked separately:
  `1sat sweep` passes `wif` where the actions have taken `keys: PrivateKey[]` since `73215a8`,
  and `wallet outputs --include` forwards unvalidated input to `listOutputs`.

### Resume after compact

```bash
1sat remote list
1sat opns lookup
1sat ordinals list
1sat bsv21 balances
1sat messagebox sync
# review git status in 1sat-sdk before commit
```
