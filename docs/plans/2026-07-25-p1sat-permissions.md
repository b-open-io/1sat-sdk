# P1Sat permissions

Status: **Architecture locked** (2026-07-25) — implementation not started  
Goal: One createAction approval path for all `@1sat/actions` P1Sat ops — explicit intent, trusted display facts, narrow apply, no dual build paths.  
Prior art (inventory only): [2026-07-23-p1sat-permission-prompts.md](./2026-07-23-p1sat-permission-prompts.md)  
Archived drafts: [archive/](./archive/) (e2e / flow / matrix superseded by this doc)

---

## Locked architecture

| Layer | Owns |
|-------|------|
| **Action** | Almost all op logic: load assets, BEEF, inputs, output shells, tags, intent + input labels, description |
| **Module** | Prompt UI from wallet re-lookup + intent; fail closed; hashOutputs commit; dispatch apply by intent |
| **Apply** | **Narrow only:** trusted extras the dApp must not finalize alone (PushDrop/sigma signature inside locking script; later multi-tx). Most intents = validate-only (no rewrite) |

Stepped **back** from “put all logic in apply.”

### Mode — `OneSatContext.isBaseWallet: boolean`

| Value | Meaning | Who runs apply |
|-------|---------|----------------|
| **`true`** | createAction does **not** go through the 1sat module | **Action** before createAction |
| **`false`** | Module handles createAction | **Module** (not the action) |

| Module originator | Behavior |
|-------------------|----------|
| **dApp** | Prompt, then apply (crypto on module’s **base** wallet) |
| **admin** | **Still apply**, no prompt — not bare return on seal ops |

- Do **not** use `instanceof` or a context “isAdmin” flag (admin = WPM originator only)
- Hosts: CLI/real base → `true`; dApp and admin-WPM → `false`

### Labels & params

| Item | Rule |
|------|------|
| Intent | `p 1sat intent <domain>.<verb>` (replaces need for bare `p 1sat action` if always present) |
| Input | `p 1sat input <basketSuffix> <id>` when spending a tracked row |
| Module params | Via labels / tags / scripts — **not** caller `customInstructions` (WPM encrypts CI before module) |
| Apply mutation | Mutate existing inputs/outputs **in place** (do not replace arrays — WPM spend math uses original args refs) |
| Prompt | Every `p 1sat` createAction; apply always dispatched by intent (may be no-op / validate) |
| Identity bind | Validate self in module; do **not** show identity hex on card |
| Double-load by id | Intentional (action build + module trust) |
| Sign path | Action already loaded the UTXO/CI — sign callback can close over that (same as today). No extra id re-lookup required for signing. |
| Module / UI | **Does** re-lookup by id — must not trust action/dApp tags for the card or validation |

### Rejected

- Fake double-createAction prepare hack  
- Full apply-owned build  

---

## Worked example: Publish OpNS (`opns.register`)

### Current (problem)

```
action: load → PushDrop.lock (field-sig on gated wallet) → createAction
gated:  bare "Sign payload" card + weak "Update OpNS" card → spend auto-grant
```

Field-sig runs **before** createAction → double prompt; name from untrusted tags.

### Proposed

```
action:
  load id → outpoint, BEEF, tags, unlock len
  labels: p 1sat intent opns.register, p 1sat input opns <id>
  inputs: real outpoint + unlock len + inputBEEF
  outputs: [{ satoshis: 1, basket: opns, tags, lockingScript: placeholder }]
  description: set

gated createAction:
  WPM encrypt → module prompt (re-lookup name from wallet by id)
  → apply seals PushDrop IN PLACE on output
  → underlying createAction → spend auth → sign (action’s loaded CI / callback)

base:
  apply seals PushDrop → createAction → sign
```

| | Current | Proposed |
|--|---------|----------|
| Field-sig | On gated wallet before CA | `apply` on **base** only |
| dApp cards | 2 (opaque sig + weak update) | 1 (“Publish name”) |
| Intent | Inferred | `opns.register` label |
| Display name | Tags / weak enrich | Module re-lookup by id |
| Tx shape owner | Action | **Action** (apply seals PushDrop only) |

---

## Intent matrix

**Hook:** `CA` = createAction · `IA` = internalizeAction  
**Apply:** `rewrite` · `validate` · `tag` · `TBD`

| Action | Intent | Hook | Apply | Notes |
|--------|--------|------|-------|-------|
| `registerOpns` | `opns.register` | CA | rewrite | PushDrop field-sig in place |
| `deregisterOpns` | `opns.deregister` | CA | validate | Drop published; self P2PKH |
| `sellOpns` | `opns.list` | CA | validate | OrdLock price vs script |
| `sendOpns` | `opns.transfer` | CA | validate | External must drop opns basket |
| `cancelOpnsListing` | `opns.cancel-listing` | CA | validate | OrdLock cancel sign after |
| `buyOpns` | `opns.purchase` | CA | validate | External OrdLock; price from script; ORDFS/name for card |
| `internalizeOpns` | `opns.internalize` | IA | — | basketAccess v1; overlay later |
| `listOpns` | — | — | — | Read-only; basket access only |
| `sendOrdinals` | `ordinal.transfer` | CA | validate | 1:1 move |
| `sellOrdinal` | `ordinal.list` | CA | validate | OrdLock |
| `cancelOrdinalListing` | `ordinal.cancel-listing` | CA | validate | |
| `buyOrdinal` | `ordinal.purchase` | CA | validate | OrdLock + ORDFS preview like transfer card |
| `burnOrdinals` | `ordinal.burn` | CA | validate | No sneaky basketed out |
| `inscribe` (plain) | `ordinal.inscribe` | CA | validate | Script authority; card from parse |
| `inscribe` (sigma) | `ordinal.inscribe-sigma` | CA | rewrite (multi-step) | Apply: anchor + sigma + push input |
| `inscribe` (stream) | `ordinal.inscribe-stream` | CA | — | **Parked** for gated; base/CLI only |
| `mintCollection` | `ordinal.mint-collection` | CA | validate | |
| `mintCollectionItem` | `ordinal.mint-item` | CA | validate | |
| `lockBsv` | `lock.lock` | CA | validate | until height vs script |
| `unlockBsv` | `lock.unlock` | CA | validate | |
| `sendBsv21` | `bsv21.transfer` | CA | validate | + token label |
| `buyBsv21` | `bsv21.purchase` | CA | validate | Parse token from script; optional overlay “validated” |
| `mintBsv21` | `bsv21.mint` | CA | validate | |
| `deployBsv21*` | `bsv21.deploy-*` | CA | validate | tag `bsv21:deploy`; balance filters deploy∩outpoint |
| Funder path | same as action | IA | validate | Prefer apply-before-fund; IA tags only |
| `internalizeBeef` / sync | — | IA | — | basketAccess only |
| Cosign / messagebox | — | IA | — | basketAccess only (often admin) |

---

## TBD (short)

1. **Purchases** — *direction settled below* (detail still implementable)
2. **Multi-tx** — *sigma + deploy direction below*; **stream parked**
3. **Creates without asset input** — *direction below*
4. **Bulk / sync internalize** — *basket grant only* (no rich intent card)
5. **`internalizeOpns`** — *basket-only for now*; reuse buy OpNS overlay helpers when we enrich later
6. **Flag** — *`isBaseWallet` settled below*
7. **Funder** — *settled below*

### Purchases (direction)

- **No wallet input label** — external listing (BEEF + outpoint). Action builds full args; apply **validate** (OrdLock price from **script**, payment outs) + **stamp** resolved meta in place.
- **Shared `resolveListingMeta`** — action fills when it can; **module always re-resolves** on gated for card + authority; apply only stamps (no third ORDFS policy).
- **Origin required** — action rejects early if neither service nor hint supplies origin; empty content-type OK.
- **Hints OK** — verified / unverified / mismatch (show truth; stamp correct values after approve).
- **Ordinal:** ORDFS (preview + origin confirm).
- **OpNS:** + **OpNS overlay** — origin should match the name’s current/claimed listing in overlay.
- **BSV21:** parse id/amt from script; **overlay** check that token/inputs are **active** (funded) on our BSV21 overlay.
- Card language like transfer; dApp tags = hints only.
- **Not this pass:** pre-fund on base after 1sat approve to drive WPM `netSpent` → 0 (one popup). Feasible later: interstitial P basket, sized fee in pre-fund (`netSpent = outs + fee - ins`), single-change wallet config, sweep leftovers. Buy flow stays dual-gate (1sat card + normal DSAP) for now.

### Sigma inscribe (direction)

- **One gated createAction** = final inscription intent (content, ordinals out shell, **no** anchor input yet; sigma script placeholder).
- **`bypassP1Sat` not the long-term answer** — P basket still hits the module anyway.
- **Apply on base after approve:**
  1. Anchor createAction (`noSend`) on base only  
  2. Sigma-sign (BAP on base)  
  3. `inputs.push` anchor spend; seal real sigma locking script on existing out **in place**  
  4. Underlying createAction for the inscription  
- Intermediates never use the gated wallet → one user grant.
- In-place **push/mutate** OK; do not replace `inputs`/`outputs` arrays.
- **Sized placeholders** for realistic script length when useful for build/fee math (1sat card still doesn’t show final wallet fee).

### BSV21 deploy (direction)

**Problem today:** fund CA → hand-built deploy + bare sig → internalize = multiple popups. Done so balance can query `bsv21:${txid}_0` after the fact.

**Preferred (simpler):** one normal createAction, tag deploy out `bsv21:deploy` (+ sym/dec/amt/…).  
**Balance for `tokenId`:** one `listOutputs` with tags `bsv21:${tokenId}` **or** `bsv21:deploy` (tagQueryMode any), then filter in app: keep `bsv21:${tokenId}` rows, and `bsv21:deploy` rows only if **outpoint === tokenId**.  
No second hop, no funding basket, no internalize theater. Permissions = single CA + intent `bsv21.deploy` (validate-only apply).

### Creates without asset input (direction)

Plain `inscribe` / `mintCollection` / `mintCollectionItem` (non-sigma).

- **Authority = output locking script** (inscription envelope). Tags are non-authoritative hints.
- **Card:** show parsed type/size/(optional preview) from script — “dApp is creating this inscription,” not client tag copy.
- **Apply:** validate-only (script shape + ordinals basket). Sigma path stays under sigma multi-tx apply.
- No wallet asset re-lookup.

### Funder (direction)

- Optional on action input; if set, `executeTrackedAction` → `fund(args)` → `internalizeAction` (no wallet createAction).
- Permissions: **basket access on internalize** only — no createAction intent/apply path.
- Dumb funder + own-asset inputs → fail safe. Smart funder (own wallet) can do full tx.
- Normal P asset moves stay on wallet createAction; no extra gated policy this pass.

### Stream inscribe (parked)

- Full file does **not** fit one createAction; no BRC-100 side channel to register a blob with the module from a dApp.
- **Gated/WPM:** stream multi-tx apply **not supported** this design — use single-tx `inscribe` or fail clearly.
- **Base/CLI:** existing multi-tx stream OK (no module chain).
- Revisit only with a real bulk-data path.

---

## Mockup brief (content locked; visuals open)

**Baseline UI:** `@1sat/permission-module-ui` `OneSatPermissionPrompt` (yours-wallet hosts it). Evolve; don’t invent a parallel system.  
**Mockups:** [mockups/p1sat-permissions.pen](./mockups/p1sat-permissions.pen) · wiring plan: [2026-07-25-p1sat-permission-ui-wiring.md](./2026-07-25-p1sat-permission-ui-wiring.md)

**Out of scope on 1sat cards:** network fee, DSAP spending (separate WPM prompt), identity pubkey hex, raw keyIDs/protocols as primary copy.

**Shared building blocks (reuse across intents)**

| Block | Use |
|-------|-----|
| Originator line | “{originator} wants to …” |
| Asset identity | name and/or origin; optional ORDFS/image preview |
| Trust badge | verified / unverified / mismatch (purchases + any hint path) |
| Amount / price | sats or token amt |
| Recipient | address shortened |
| Detail rows | key/value list |
| basketAccess list | basket name + short capability line |

**Display model by intent** (title + primary facts; mockup owns layout)

| Intent | Title | Primary facts | Featured |
|--------|-------|---------------|----------|
| `opns.register` | Publish name | name (wallet re-lookup) | — |
| `opns.deregister` | Unpublish name | name | — |
| `opns.list` | List name for sale | name, price (script) | — |
| `opns.transfer` | Transfer name | name, recipient | — |
| `opns.cancel-listing` | Cancel listing | name | — |
| `opns.purchase` | Buy name | name, price (OrdLock); trust on name/origin | optional preview |
| `ordinal.transfer` | Send ordinal | asset id/name/origin, recipient | ORDFS preview if any |
| `ordinal.list` | List for sale | asset, price | preview |
| `ordinal.cancel-listing` | Cancel listing | asset | preview |
| `ordinal.purchase` | Buy ordinal | asset, price; trust badges | ORDFS preview |
| `ordinal.burn` | Burn ordinal | asset(s) | preview |
| `ordinal.inscribe` | Create inscription | type, size (from **script**) | preview if cheap |
| `ordinal.inscribe-sigma` | Create inscription | same as inscribe (+ signed) | preview if cheap |
| `ordinal.mint-collection` | Mint collection | name/type from script/tags as verified | — |
| `ordinal.mint-item` | Mint collection item | item + collection ref | — |
| `lock.lock` | Lock BSV | amount, until height | — |
| `lock.unlock` | Unlock BSV | amount(s) | — |
| `bsv21.transfer` | Send tokens | sym/id, amount, recipient | — |
| `bsv21.purchase` | Buy tokens | sym/id, amount, price; overlay active badge | — |
| `bsv21.mint` | Mint tokens | token, amount | — |
| `bsv21.deploy-*` | Deploy token | symbol, supply/decimals as applicable | — |
| basketAccess | Grant basket access | basket list | — |

**Purchase trust states:** verified (lookup matches) · unverified (no lookup) · mismatch (show authoritative value; note dApp differed).

**Mockup session owns:** spacing, type, dark/light, component chrome, empty/error states, multi-asset lists.  
**Wiring session owns:** PromptRequest shape, resolveListingMeta, apply, isBaseWallet.

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-07-23 | Claim+validate prompts; intent labels; fail closed on bad claims; inventory of weak enrich paths |
| 2026-07-25 | Split: action builds almost everything; module prompts + re-lookup; apply narrow (rewrite only trusted seals) |
| 2026-07-25 | Sign uses action-loaded CI; module/UI still re-looks up (does not trust action) |
| 2026-07-25 | Purchases: resolveListingMeta; origin required; Ord ORDFS; OpNS overlay name↔origin; BSV21 parse + active overlay; apply stamps |
| 2026-07-25 | Sigma: one gated CA; apply on base does anchor+sigma+push input+seal script |
| 2026-07-25 | Purchase pre-fund / unify DSAP: future only; buys keep 1sat + DSAP for now |
| 2026-07-25 | Stream inscribe: parked for gated/WPM; base/CLI only |
| 2026-07-25 | BSV21 deploy: single CA + `bsv21:deploy` tag; balance query or-filter by outpoint===tokenId |
| 2026-07-25 | Plain inscribe/mint: script is authority; card from parse; validate-only apply |
| 2026-07-25 | Bulk/sync internalize: basket grant only |
| 2026-07-25 | internalizeOpns: basket-only v1; share buy overlay helpers later |
| 2026-07-25 | Funder: IA basket only; no CA intent path; park further gated policy |
| 2026-07-25 | `isBaseWallet`: action applies iff true; module always applies when it handles CA (admin silent) |
| 2026-07-25 | Apply mutates args **in place**; no array replace |
| 2026-07-25 | Module params not via caller CI (WPM encrypts) |
| 2026-07-25 | Rejected: double-createAction prepare; full apply-owned build |
| 2026-07-25 | Intent label can supersede bare `p 1sat action` when always present |
| 2026-07-25 | Consolidated messy e2e/flow/matrix drafts into this doc |
| 2026-07-25 | Mockup brief: per-intent titles/facts + shared blocks; visuals open |

---

## Implementation order (when starting)

1. Context flag + apply dispatch skeleton  
2. `opns.register` end-to-end (canonical)  
3. Remaining validate-only OpNS  
4. Ordinals / locks / bsv21 validate paths  
5. Multi-tx apply (sigma); deploy tag/balance change; purchases resolveListingMeta
