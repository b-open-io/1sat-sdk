# P1SAT id-first actions and filing

**Status:** In progress (uncommitted implementation)  
**Date:** 2026-07-23  
**CLI/skills execution plan:** [2026-07-23-cli-id-first-wiring.md](./2026-07-23-cli-id-first-wiring.md)  

## Problem

1. Self-spends of wallet-owned P1SAT assets often take a full `WalletOutput` and trust in-memory tags/BEEF. Tags are not reloaded by `id:`; only BEEF sometimes is (`resolveBeef`).
2. Generic ordinal paths use `resolveOrdinalTags` to re-decide basket/tags (content-type + ORDFS). That can mis-file OpNS (and other) assets out of their basket.
3. List helpers historically pulled **entire transactions** (BEEF) by default. Callers only need **tags/CI** for most UI; BEEF should be on demand via `id:`.

## Working model (not final until implemented)

### Wallet-owned (P1SAT baskets)

- Every UTXO in a P1SAT asset basket **must** have an **`id:`** tag (stamped at ingress / create via tracked action or equivalent).
- Actions that **spend** a wallet-owned non-fungible asset take **`id:`** (or ids), then **lookup** the row (`listOutputs` by tag in the right basket) for outpoint, tags, CI, and BEEF.
- **Self-kept** outputs: always re-file correct **basket + carried tags** + new `id:` (tracked action). Do **not** use `resolveOrdinalTags` as basket authority for domain assets already under management.
- **Tag carry on moves:** copy prior tags; drop old `id:`; drop move-specific markers when leaving that state (`ordlock`/`price:`, `opns:published` as appropriate). **Action** adds its own markers (list adds ordlock/price; register adds published). No inventing `origin` from current outpoint.

### Not from our wallet

- Caller supplies **BEEF** plus **which output** (`outpoint` / `txid` + `outputIndex`). BEEF alone is not enough.
- Plus path-specific fields (price script, token amount, remittance, etc.).
- No `id:` lookup on our storage for that input.

### Fungible (BSV21)

- Caller API stays **value-based** (tokenId, amounts, destinations), not “spend this id.”
- Selected UTXOs in basket should still **have** `id:` internally.
- Self-kept outputs (change, and send-to-self) must be basketed and tagged; full self-send must not drop tracking.

### Deposit / locks (bulk consume)

- Rows have `id:` at create.
- **Deposit sweep:** bulk only (limit OK); not per-id product API.
- **Unlock:** prefer `ids?: string[]` (specific) or omit = all unlockable; output is funding, not asset tag carry.

---

## Domain notes

### OpNS (`opns`)

| Kind | Actions / paths |
|------|------------------|
| Ingress | `internalizeOpns` (mint); `internalizeBeef` / owner sync; `sweepOrdinals` (OpNS class); market purchase (today generic `purchaseOrdinal`) |
| Self-moves | register, deregister, list, cancel listing, transfer-to-self |
| External | transfer-out (no basket on our recipient out) |

- Ingress stamps full tags: `opns`, `type:application/op-ns`, `origin:…`, `name:…`, `id:…` (mint origin = mint delivery outpoint **only at ingress**).
- Self-moves: **id-first lookup**, OPNS basket, carry tags (no `resolveOrdinalTags` for filing).
- Dedicated OpNS cancel (not bare `cancelListing` without filing).

### Ordinals (`1sat`)

- Same id-first rule as OpNS for self-moves: transfer-self, list, cancel.
- Ingress: inscribe, purchase, sweep, sync.
- `resolveOrdinalTags` at most for **true external ingress** fill-in; not for owned self-spends.

### BSV21 (`bsv21`)

- Value API for send; internal UTXOs have `id:`.
- Fix: self destination must basket/tag; deploy/mint paths should stamp `id:` on kept outs.
- No requirement that user pass input ids for send.

### Locks (`lock`)

- Create with `id:`.
- Unlock: `ids?: string[]` or all unlockable → funding.

### Deposit (`1sat-deposit`)

- Ingress with `id:`.
- `sweepDeposit`: bulk / limit only → funding.

### Inscriptions / Sigma / stream

- **Sigma single inscribe:** anchor `noSend: true`; **inscription normal send** + `sendWith: [anchorTxid]` (not noSend on inscription).
- Anchor is **2 sats** plumbing (`SIGMA` basket); inscription **1 sat** into ordinals with tags + `id:`.
- `keyID` in CI remains for signing; `id:` is storage/lookup — different roles.
- Stream: noSend chain until final sendWith (separate from Sigma single-tx rule).
- No orphan-anchor reuse today; fresh anchor per Sigma inscribe.

### Identity / BAP

- Create with `id:`; old records often relinquished, not id-first asset transfer.

### Out of P1SAT id model (or special)

- MNEE (external API UTXOs), cosign (required external BEEF), plain `sendBsv` funding, social create-only, hosting receipts (create with id: but not OpNS-style moves).

---

## List / read APIs (consumers)

Default list behavior should match the model:

| Action | Default | Optional |
|--------|---------|----------|
| `getOpnsNames` | metadata: tags + CI (no BEEF) | `include: 'entire transactions'` if needed |
| `getOrdinals` (and similar) | same — **tags by default**, not BEEF | entire transactions on demand |
| Token list / balances | metadata; no full BEEF unless spending path needs it | |

Spend path: **id → lookup** (tags + BEEF in one tagged `listOutputs`), or caller passes BEEF only for external inputs.

---

## Implementation themes (all required; no single “priority domain”)

1. **Ingress guarantees `id:`** on every P1SAT basketed out (createTrackedAction / internalize paths / fix deploy internalize gaps).
2. **Self-spend actions** accept **`id:`** (non-fungible) or select UTXOs that have ids (fungible); reload canonical row before carry/re-file.
3. **Remove `resolveOrdinalTags` from owned self-spend filing** (OpNS/ordinals list-transfer-cancel); keep only where discovery is the job (true external ingress) or delete after dedicated ingress helpers exist.
4. **Carry-tags helper** (minimal): filter previous tags + caller-supplied adds/drops; basket is domain constant.
5. **List defaults:** tags/CI on; BEEF off unless requested.
6. **BSV21 self-send** baskets the self output.
7. **Sigma:** inscription not `noSend`; anchor held + `sendWith`.
8. **Unlock:** optional `ids?: []`.

---

## Consumers to update (1sat tooling)

After actions change, update all first-party callers. Expect API shifts: pass **`id:`** instead of full stale `WalletOutput` where we require it; stop requesting BEEF on every list.

| Area | Examples |
|------|----------|
| **1sat-name** | My Names (list/cancel/register/transfer), mine internalize, jobs held-check (`getOpnsNames` metadata) |
| **@1sat/cli** | `opns *`, `ordinals *`, token send, list commands |
| **yours-wallet** | OpNS manager, ordinals UI, unlock, lists |
| **wallet-desktop** | RPC handlers (`getOpnsNames`, transfers, lists) |
| **wallet-server / hosting** | any action wrappers |
| **1sat-website** | wallet OpNS/ordinals pages |
| **Skills / docs** | opns, ordinals, action-patterns, CLI skill |
| **Tests** | actions unit/integration; any e2e that assumed list+BEEF |

Also: extension store builds must pick up published actions or they keep old filing bugs.

---

## Related short-term draft (may be superseded)

In-tree OpNS filing draft (`opnsList`/`opnsTransfer`/`opnsCancelListing` + `internalizeOpns` tags, `cancelListing.filing`) was a **partial** fix (basket ownership without full id-first API). Re-implement under this plan rather than shipping half-measures as final.

---

## Open points

- Exact TypeScript shapes: `id: string` vs full `id:…` tag string; batch `ids: string[]`.
- Whether `getOpnsNames({ ids })` / `getOrdinals({ ids })` are the lookup primitive spends use internally.
- OpNS purchase: dedicated `opnsPurchase` vs purchaseOrdinal + explicit filing args.
- Migration: existing basket UTXOs missing `id:` or `type:`/`origin:` — repair tool vs best-effort carry.
