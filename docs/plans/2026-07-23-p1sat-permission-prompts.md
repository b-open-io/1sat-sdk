# P1SAT permission prompts — inventory & plan

Status: **Draft** — stock-taking; no implementation commitment  
Last updated: 2026-07-23

## Goal

Make 1Sat permission-module prompts **rich and trustworthy** for every
`@1sat/actions` flow that hits `p 1sat` protocol / baskets, without limiting
users to only those flows forever.

Wallet vendors trust the module to interpret 1Sat ecosystem rules. Users should
see a clear verb + asset facts (name, price, recipient, …). Technical proofs
(scripts, outpoints) stay in the validator; they need not dominate the UI.

## Non-goals (for now)

- Bulk-grant / manifest work (separate; 1sat-name manifest is done).
- Forcing all ordinal activity through predefined actions.
- Showing raw PushDrop / sighash / identity hex as the primary UX.

## Locked product direction (discussion so far)

| Topic | Direction |
|-------|-----------|
| Intent source | App/action layer **declares** intent (claim). Tx alone cannot name “publish” vs “unpublish”. |
| Trust | Module **validates** claim against wallet storage + committed scripts/tags. Do not trust free-text descriptions (encrypted away) or unverified output tags alone. |
| Claim labels | Anyone can emit them. They are a **switch** to run a validator, not auth. Fail closed on bad claims. |
| Unlabeled `p 1sat` txs | **Allow** for now (custom clients, partial coverage). Later optional: require claims for rich UI only, or harden unknown path. |
| First UI bar | Verb + identity of asset (+ what changes in plain language). Not full cryptographic disclosure. |

## Current architecture (what exists)

```
dApp / @1sat/actions
  → createAction (+ labels: `p 1sat action`, optional `p 1sat input <basket> <id>`)
  → LocalWalletPermissionsManager
  → createOneSatPermissionModule.onRequest
       enrichIntent()  → kind + summary + intent blob
       promptHandler   → OneSatPermissionPrompt UI
  → createAction builds signable tx
  → onResponse: hashOutputs commitment (60s) for createSignature auto-grant
```

**Trusted today**

- Input metadata via `p 1sat input …` → `listOutputs` by `id:` in wallet storage.
- Recipient from locking-script decode.
- Post-approve hashOutputs bind.

**Weak today**

- Kind detection from baskets + **app-supplied** output tags.
- Single catch-all kind `opns` for publish / unpublish / many self-moves.
- Purchase detection omits OPNS basket (OpNS buy misclassified).
- `opnsRegister` does not emit input asset labels.
- Many UTXOs lack `id:` / `name:` tags → empty prompt rows.
- Descriptions encrypted before module sees them.
- Fee / net spend not on 1Sat card (WPM DSAP is separate).

Key code:

- `packages/permission-module/src/enrichIntent.ts`
- `packages/permission-module/src/handlers.ts`
- `packages/permission-module-ui/src/OneSatPermissionPrompt.tsx`
- `packages/actions/src/utils/createTrackedAction.ts`
- `packages/types` — `P1SAT_LABEL`, `buildInputAssetLabel`, baskets

## Target architecture (proposed)

```
Action executeTrackedAction
  → labels include:
       `p 1sat action`                    (dispatch, existing)
       `p 1sat input <basket> <id>`       (when spending known asset, existing)
       `p 1sat intent <domain>.<verb>`    (NEW claim — optional at first)

Module onRequest(createAction)
  → if intent claim present:
       run validator[domain.verb](wallet, args, resolvedInputs)
       if invalid → reject (or force unknown + no rich copy)
       if valid → PromptRequest with validated display model
  → if no claim:
       existing enrichIntent path (unlabeled allowed)
```

Validators live in **permission-module** (trust boundary). Actions only attach
the claim id and ensure inputs are labeled when possible.

Display model (sketch): `{ verb, title, subtitle, rows[], featured? }` produced
only from validated facts + claim.

Exact claim string namespace TBD (`p 1sat intent opns.register` vs shorter).

## Inventory: actions that hit the module via createAction

Anything using `executeTrackedAction` / `createTrackedAction` without
`bypassP1Sat: true` gets `p 1sat action` and prompts.

### OpNS

| Action | File | Basket | Input labels today | Current kind | Notes |
|--------|------|--------|--------------------|--------------|-------|
| `opnsRegister` | opns/ | opns | **No** | `opns` → “Update” | Publish / identity bind (PushDrop) |
| `opnsDeregister` | opns/ | opns | via transfer builder if `id:` | `opns` → “Update” | Clears bind |
| `opnsList` | → `listOrdinal` | opns | if `id:` | `listing` | OrdLock + price tag |
| `opnsTransfer` | → `transferOrdinals` | opns / none | if `id:` | `opns` transfer if external recipient | Bind does not carry |
| (market buy name) | `purchaseOrdinal` + op-ns type | opns | n/a (external listing) | often mis-`opns` | Should be purchase |

### Ordinals

| Action | Current kind | Notes |
|--------|--------------|-------|
| `transferOrdinals` | ordinal-transfer / opns if basket | Self vs external |
| `listOrdinal` | listing | |
| `cancelListing` | cancel-listing | Needs ordlock/price on input tags |
| `purchaseOrdinal` | purchase (ordinals/bsv21 only) | Fix OPNS |
| `burnOrdinals` | unknown / thin | Needs kind |
| `inscribe` | inscription | Multi-step; anchor uses bypassP1Sat |
| `mintCollection` / `mintCollectionItem` | inscription-like | |

### Tokens (BSV21)

| Action | Current kind | Notes |
|--------|--------------|-------|
| `sendBsv21` | token-transfer | |
| `purchaseBsv21` | purchase | |
| `mintBsv21` | token-transfer / unknown | |
| `deployBsv21Mint` / `deployBsv21Auth` | thin | Deploy semantics |

### Locks

| Action | Current kind |
|--------|--------------|
| `lockBsv` | lock |
| `unlockBsv` | unlock |

### Identity / social

| Action | Current kind | Notes |
|--------|--------------|-------|
| `publishIdentity` / `rotateIdentity` / `attest` / `updateProfile` | unknown / weak | BAP basket — enrich may not classify |
| `createSocialPost` | social-post | Empty rows |

### Sweep / deposit

| Action | Notes |
|--------|-------|
| `sweepBsv` / `sweepOrdinals` / `sweepBsv21` / `sweepDeposit` | Batch internalize-ish creates; need clear “import into wallet” copy |

### Explicitly outside module (by design today)

| Action | Why |
|--------|-----|
| `sendBsv` / `sendAllBsv` | Bypass tracked path — plain BSV / WPM spending |
| Inscribe Sigma anchor | `bypassP1Sat: true` |
| Reads (`getOpnsNames`, `listOutputs`, …) | Basket access prompts only, not tx intent |
| `internalizeAction` (e.g. 1sat-name mint) | Basket insertion grant, not createAction enrich |
| AuthFetch / BRC-29 pay | Protocol + spending, not 1Sat asset module |
| MNEE | Separate stack |

## Per-intent work items (to fill as we implement)

For each claim, document before coding:

1. **Claim id**
2. **User-facing title / subtitle** (verb + asset)
3. **Rows** (name, price, recipient, …)
4. **Validate input** (basket, tags, inscription type, listing state)
5. **Validate output** (script family, tags consistency, price vs OrdLock, PushDrop bind shape, …)
6. **Action changes** (emit claim + input labels + ensure tags)
7. **UI kind** (reuse vs new `EnrichedIntentKind`)

### Priority slice (1sat-name)

| Claim (draft) | Title (draft) | Validation sketch |
|---------------|---------------|-------------------|
| `opns.register` | Publish name | Input in opns basket; output PushDrop bind + `opns:published`; name from input storage |
| `opns.deregister` | Unpublish name | Input published/PushDrop; output plain P2PKH self; published tag dropped |
| `opns.transfer` | Transfer name | Input opns; external recipient script; no bind carry |
| `opns.list` | List name for sale | Input opns; output OrdLock; price tag matches script |
| `opns.cancel-listing` | Cancel listing | Input ordlock; output plain opns |
| `opns.purchase` / shared `ordinal.purchase` | Buy name | Incoming opns output + seller payment; price from payment out |

Then ordinals/tokens/locks/identity/sweep in later phases.

## Phased delivery

### Phase 0 — Plan & inventory (this doc)

- [x] Architecture discussion (claim + validate, unlabeled allowed)
- [x] Action inventory
- [ ] Review/signoff on claim namespace and fail-closed rules for **bad** claims
- [ ] Prioritize phase 1 list

### Phase 1 — Plumbing

- [ ] Claim label constant + helper on `executeTrackedAction` / actions
- [ ] Module: parse claim; registry of validators; fail closed if claim present & invalid
- [ ] Display model shared by module → UI (stop overloading coarse kinds only)
- [ ] Always emit input labels from actions when `id:` exists; backfill strategy for missing `id:` (optional retag action or resolve by outpoint)

### Phase 2 — OpNS validators + UI (1sat-name complete path)

- [ ] register / deregister / transfer / list / cancel / purchase (OPNS)
- [ ] Fix purchase detection for opns basket even without claim (unlabeled fallback)
- [ ] Prompt copy + rows per table above
- [ ] Tests: valid claim, lying tags, missing input, wrong script shape

### Phase 3 — Ordinals / market / burn / inscribe

- [ ] Align list/cancel/transfer/purchase/burn/inscribe claims + validators
- [ ] Collection mints

### Phase 4 — Tokens, locks, identity, social, sweep

- [ ] Same pattern per inventory row
- [ ] social-post content preview if feasible without trusting plaintext alone

### Phase 5 — Policy harden (optional)

- [ ] Decide: unlabeled stays forever vs rich-UI-only-with-claim
- [ ] Do **not** block unlabeled spends of user assets without explicit product decision

## Tooling gaps (fundamental)

1. **No intent channel** that survives WPM encryption except labels/tags/scripts.
2. **No validator registry** — only heuristic `detectKind`.
3. **Input resolution depends on `id:` tags** — pre-tracking UTXOs are blind.
4. **Output tag trust** — tags are not bound to script content today.
5. **Script parsers incomplete for prompts** — OrdLock price, PushDrop bind field0, op-ns inscription body not systematically decoded in the module.
6. **Double prompt** — asset module then DSAP spending for funded txs; product may want combined later.

## Open questions

1. Claim namespace final form and versioning (`opns.register` vs `opns.register.v1`).
2. On invalid claim: hard reject vs downgrade to unknown (recommend **reject** if claim present).
3. How aggressive to parse BEEF/inscription when wallet tags missing (network ORDFS?).
4. Whether internalize (mint delivery) should ever get a rich “receive name” prompt (today basket grant only).
5. Package split: validators in permission-module vs shared `@1sat/intent-validate` used by module only.

## Success criteria

- 1sat-name publish / unpublish / list / unlist / transfer / buy each show a distinct, accurate verb + name (and price/recipient where relevant).
- Lying output tags cannot produce a successful **claimed** rich prompt.
- Unlabeled custom clients still function (phase 0–4).
- Tests cover validators for each claimed OpNS verb.

## Related

- 1sat-name `public/manifest.json` — bulk basket/auth grants (no spending).
- `docs/protocols/opns-paymail-bind.md` — publish PushDrop shape for register validator.
- Host pack / paymail plan — separate product surface.
