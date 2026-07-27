# P1Sat intent matrix (draft for review)

Status: **draft** — labels / pre-apply args / apply per action  
Conventions: [2026-07-25-p1sat-action-permission-flow.md](./2026-07-25-p1sat-action-permission-flow.md)

## Conventions (assumed)

| Item | Value |
|------|--------|
| Intent label | `p 1sat intent <domain>.<verb>` |
| Input asset | `p 1sat input <basketSuffix> <id>` when spending a tracked basket row |
| Token context | `p 1sat bsv21 <tokenId>` via `buildTokenLabel` where useful |
| Generic `p 1sat action` | **Not required** if intent always present (basket alone also routes) |
| Id tags | Still stamped on basketed outputs (`id:<actionId>_<i>`) after apply finalizes outputs |
| Prompt | Every P createAction **and** P internalize (card type may differ) |
| Apply | Narrow: validate-only by default; rewrite only for trusted seals (PushDrop/sigma/…) |
| Action | Owns load + almost all createAction args |
| Base vs gated | Base: apply then CA. Gated: prompt → apply on base **in place** → underlying CA |
| Module trust | Re-lookup display facts from wallet storage; do not trust dApp tags alone |
| In-place | Mutate existing inputs/outputs objects; do not replace arrays (WPM spend/verify) |

**Hook column:** `CA` = createAction path · `IA` = internalizeAction path

**Apply kind:** `rewrite` = mutates scripts/args · `validate` = checks + pass-through · `tag` = stamps filing tags/CI on internalize · `TBD` = novel, design later

---

## OpNS

### `registerOpns` — `opns.register` · CA · rewrite

| | |
|--|--|
| **Labels** | `p 1sat intent opns.register` · `p 1sat input opns <id>` |
| **Pre-apply args** | `inputBEEF`; 1 input (outpoint, unlock len from current CI); output **skeleton** (1 sat, basket `opns`, seed tags from loaded row — script/CI incomplete until apply); `randomizeOutputs: false` |
| **Apply** | Identity key; PushDrop.lock field-sig on base; write lockingScript + CI (`pushdrop`, keyID, anyone) + ensure `opns:published`; drop bind if already wrong shape |
| **After** | `signOrdinalInput` vin0 · hashOutputs auto-grant |
| **Card (draft)** | Publish name · name from wallet re-lookup |

### `deregisterOpns` — `opns.deregister` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent opns.deregister` · `p 1sat input opns <id>` |
| **Pre-apply args** | Full: 1 in; 1×1sat P2PKH self (derived keyID=outpoint); basket opns; seed tags **without** published; CI plain |
| **Apply** | Validate input is opns; output self P2PKH; published tag absent; optional: input was PushDrop bind |
| **After** | `signOrdinalInput` |
| **Card** | Unpublish name · name |

### `sellOpns` — `opns.list` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent opns.list` · `p 1sat input opns <id>` |
| **Pre-apply args** | Full: 1 in; 1×1sat OrdLock; tags `ordlock`, `price:N`; basket opns |
| **Apply** | Validate OrdLock script price matches tag/intent; input owned opns |
| **After** | `signOrdinalInput` |
| **Card** | List name for sale · name · price |

### `sendOpns` — `opns.transfer` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent opns.transfer` · `p 1sat input opns <id>` |
| **Pre-apply args** | Full: 1 in; 1×1sat P2PKH; self → basket+tags+CI; external → no basket, empty tags |
| **Apply** | Validate recipient script; external must not keep opns basket bind |
| **After** | `signOrdinalInput` |
| **Card** | Transfer name · name · recipient |

### `cancelOpnsListing` — `opns.cancel-listing` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent opns.cancel-listing` · `p 1sat input opns <id>` |
| **Pre-apply args** | Full: 1 in (listed); 1×1sat P2PKH cancel addr; basket opns; seed tags no ordlock/price |
| **Apply** | Validate input has listing shape; output plain owner lock |
| **After** | `OrdLock.cancelWithWallet` sign |
| **Card** | Cancel listing · name |

### `buyOpns` — `opns.purchase` · CA · TBD

| | |
|--|--|
| **Labels** | `p 1sat intent opns.purchase` · (no input asset label — external listing) · optional name/origin as **untrusted** hints only |
| **Pre-apply args** | External OrdLock in + BEEF; outs: opns basket ingress + seller pay (+ market); tags stamped for filing |
| **Apply** | TBD (purchase pattern): decode OrdLock price from **script**; validate payment out; module card from script+re-decode not seller tags |
| **After** | purchase unlock builder |
| **Card** | Buy name · name? · price from script · TBD |

### `internalizeOpns` — `opns.internalize` · IA · tag

| | |
|--|--|
| **Labels** | `p 1sat intent opns.internalize` (on internalize `labels` if WPM forwards them) |
| **Pre-apply args** | AtomicBEEF `tx`; insertion: basket `opns`, outputIndex from mint decode; tags/CI may be partial until apply |
| **Apply** | Decode mint delivery from **tx bytes** (not dApp name alone); stamp `name:`, `origin:`, `type:`, `id:`, CI (protocolID/keyID/counterparty from args but key material validated as spendable shape); reject if not opns mint |
| **After** | none (no createAction) |
| **Card** | Receive name · name from tx decode · (basket grant may also fire) |
| **Note** | Today no intent label; module only basketAccess. Proposed: rich IA path for this intent |

### `listOpns` — read only

No CA/IA intent. Basket access on `listOutputs(opns)` only (existing).

---

## Ordinals

### `sendOrdinals` — `ordinal.transfer` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.transfer` · input label per spent id |
| **Pre-apply args** | Full: N ins; N×1sat outs (self basket+seed / external bare) |
| **Apply** | Validate 1:1 ordinal move; recipients from scripts |
| **After** | `signOrdinalInput` each |
| **Card** | Send ordinal(s) · names/origins · recipient(s) |

### `sellOrdinal` — `ordinal.list` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.list` · input label |
| **Pre-apply args** | Full OrdLock out + price tag |
| **Apply** | OrdLock price vs script |
| **After** | `signOrdinalInput` |
| **Card** | List for sale · asset · price |

### `cancelOrdinalListing` — `ordinal.cancel-listing` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.cancel-listing` · input label |
| **Pre-apply args** | Full cancel to P2PKH |
| **Apply** | Input listing shape; plain out |
| **After** | OrdLock cancel sign |
| **Card** | Cancel listing · asset |

### `buyOrdinal` — `ordinal.purchase` · CA · TBD

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.purchase` |
| **Pre-apply / apply / card** | Same purchase TBD pattern as `buyOpns` (basket ordinals) |

### `burnOrdinals` — `ordinal.burn` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.burn` · input labels |
| **Pre-apply args** | N ins; burn OP_RETURN/MAP out (no basket) |
| **Apply** | Validate burn out shape; no sneaky basketed ordinal out |
| **After** | `signOrdinalInput` each |
| **Card** | Burn ordinal(s) · assets |

---

## Inscriptions / collections

### `inscribe` (plain) — `ordinal.inscribe` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.inscribe` |
| **Pre-apply args** | Full: 0 explicit asset ins; 1×1sat inscription out basket ordinals; type/origin/sha tags |
| **Apply** | Validate inscription envelope / basket; content preview TBD (size/type only?) |
| **After** | wallet funds only |
| **Card** | Create inscription · type · optional name · TBD preview |
| **Note** | Novel: no asset input — TBD how much content to show |

### `inscribe` (sigma) — `ordinal.inscribe-sigma` · CA · TBD multi-tx

| | |
|--|--|
| **Labels** | Intent on **entry** createAction (first call that should prompt) |
| **Pre-apply / apply** | TBD: apply runs anchor + BAP sigma + inscription chain on base after one prompt; return final txid semantics |
| **Card** | Create inscription (signed) · TBD |

### `inscribe` (stream) — `ordinal.inscribe-stream` · CA · TBD multi-tx

| | |
|--|--|
| **Labels / apply / card** | TBD multi-tx chunk chain |

### `mintCollection` — `ordinal.mint-collection` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.mint-collection` |
| **Pre-apply args** | Full 1sat collection inscription out |
| **Apply** | Validate collection MAP shape |
| **Card** | Mint collection · name |

### `mintCollectionItem` — `ordinal.mint-item` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent ordinal.mint-item` |
| **Pre-apply args** | Full item inscription + collection ref |
| **Apply** | Validate item MAP / parent ref |
| **Card** | Mint collection item · name · collection |

---

## Locks

### `lockBsv` — `lock.lock` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent lock.lock` |
| **Pre-apply args** | Full: lock script outs basket `lock`; tags `until:H`; CI |
| **Apply** | Validate Lock script until height matches tag; amounts |
| **After** | wallet funds |
| **Card** | Lock BSV · amount · until height |

### `unlockBsv` — `lock.unlock` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent lock.unlock` · input label per lock id |
| **Pre-apply args** | N lock ins; empty outs (→ change); lockTime set |
| **Apply** | Inputs in lock basket; matured vs height if checkable |
| **After** | `Lock.unlockWithWallet` each |
| **Card** | Unlock BSV · amount(s) |

---

## BSV21

### `sendBsv21` — `bsv21.transfer` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent bsv21.transfer` · `p 1sat bsv21 <tokenId>` · input labels per utxo id |
| **Pre-apply args** | Full token transfer outs (+ change + fee); scripts from token template |
| **Apply** | Validate token id/amt consistency vs wallet inputs (re-lookup); recipients |
| **After** | `signP2PKHInput` per token in |
| **Card** | Send tokens · sym/id · amount · recipient |

### `buyBsv21` — `bsv21.purchase` · CA · TBD

| | |
|--|--|
| **Labels** | `p 1sat intent bsv21.purchase` · `p 1sat bsv21 <tokenId>` |
| **Pre-apply / apply / card** | Purchase TBD (OrdLock listing) |

### `mintBsv21` — `bsv21.mint` · CA · validate

| | |
|--|--|
| **Labels** | `p 1sat intent bsv21.mint` · token label · input label on auth id if any |
| **Pre-apply args** | Auth in; mint out bsv21 + continuing auth out |
| **Apply** | Validate auth spend + mint amounts |
| **After** | P2MS or P2PKH per CI |
| **Card** | Mint tokens · token · amount |

### `deployBsv21Mint` / `deployBsv21Auth` — `bsv21.deploy-*` · TBD multi-tx

| | |
|--|--|
| **Today** | Raw createAction funding (not tracked) + manual deploy + **internalize** into bsv21 / bsv21-auth |
| **Proposed** | TBD: intent on funding CA and/or IA; apply may span funding+deploy+internalize |
| **Card** | Deploy token · TBD |

---

## Other internalize-heavy (P-adjacent)

### Funder path on any tracked action · IA after external fund

| | |
|--|--|
| **Labels** | Same intent labels as the action (on internalize if passed) |
| **Apply** | Prefer **apply before fund** on base; IA apply = validate insertion tags match already-built tx + basket grant. Not a second full rewrite. |
| **Scope** | Rare for own-asset P moves; keep in mind |

### `internalizeBeef` / address sync ingress · IA · TBD

| | |
|--|--|
| **Labels** | May stamp multiple baskets (ordinals, bsv21, deposit, …) |
| **Apply / card** | TBD — bulk ingress; may stay basketAccess-only or per-output intent |
| **Note** | Not a single user verb like publish |

### Cosign / messagebox internalize · IA · TBD

| | |
|--|--|
| **Apply / card** | TBD — often admin/sync originator |

### BSV21 deploy internalize (part of deploy) · IA · TBD

Covered under deploy above.

---

## Apply registry (summary)

| Intent | Apply kind | Hook |
|--------|------------|------|
| `opns.register` | rewrite (PushDrop) | CA |
| `opns.deregister` | validate | CA |
| `opns.list` | validate | CA |
| `opns.transfer` | validate | CA |
| `opns.cancel-listing` | validate | CA |
| `opns.purchase` | TBD | CA |
| `opns.internalize` | tag (tx decode) | IA |
| `ordinal.transfer` | validate | CA |
| `ordinal.list` | validate | CA |
| `ordinal.cancel-listing` | validate | CA |
| `ordinal.purchase` | TBD | CA |
| `ordinal.burn` | validate | CA |
| `ordinal.inscribe` | validate | CA |
| `ordinal.inscribe-sigma` | TBD multi-tx | CA |
| `ordinal.inscribe-stream` | TBD multi-tx | CA |
| `ordinal.mint-collection` | validate | CA |
| `ordinal.mint-item` | validate | CA |
| `lock.lock` | validate | CA |
| `lock.unlock` | validate | CA |
| `bsv21.transfer` | validate | CA |
| `bsv21.purchase` | TBD | CA |
| `bsv21.mint` | validate | CA |
| `bsv21.deploy-*` | TBD multi-tx+IA | CA/IA |

---

## Novel / TBD clusters (explicit)

1. **Purchase** (ordinal / opns / bsv21) — external OrdLock, price from script  
2. **Multi-tx** — sigma, stream, bsv21 deploy  
3. **Create without asset input** — inscribe / collection mint / lock — content disclosure  
4. **Bulk / sync internalize** — internalizeBeef, cosign, paymail  
5. **`internalizeOpns`** — designed above as IA+tag; confirm labels on internalizeArgs and rich vs basket-only card  

---

## Review prompts

- Intent verb names (`list` vs `sell`, `register` vs `publish`)?  
- IA intents: always rich card or basketAccess + optional enrich?  
- Purchase/multi-tx: park OK?  
- Any action missing from this set?
