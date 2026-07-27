# P1Sat action + permission flow (examples)

Status: **draft for review** — examples only; not an implementation checklist yet  
Related: [2026-07-25-p1sat-permissions-e2e.md](./2026-07-25-p1sat-permissions-e2e.md)

Goal of this doc: compare **today** vs **proposed** for a few concrete actions so we can decide if the abstractions stay compatible or should be streamlined. Start with OpNS publish; sigma inscribe next after feedback.

---

## Shared pieces today (all tracked actions)

Rough stack the action sits on:

```
Action code
  → executeTrackedAction / createTrackedAction
       • injects label `p 1sat action` (unless bypassP1Sat)
       • injects per-output `id:<actionId>_<i>` tags
       • createAction({ signAndProcess: false })
  → (wallet may be WPM + 1sat module)
       • module onRequest(createAction): enrichIntent → prompt
       • underlying createAction → signable tx
       • module onResponse: cache hashOutputs + input outpoints (~60s)
  → completeSignedAction
       • caller signing callback (e.g. signOrdinalInput)
       • each createSignature under `p 1sat`: auto-grant if preimage matches cache
       • signAction / abort on failure
```

**Compatible idea we keep:** user (or admin) approves at **createAction**; later **createSignature** for that tx is auto-allowed via commitment. We are not throwing that away.

**Tension:** some work (PushDrop field-sig, sigma BSM, multi-tx) happens **before** or **between** createActions, so it never rides that commitment.

---

## Example A — OpNS publish (`registerOpns`)

### What the user means

Bind this wallet’s identity to a name UTXO they already hold (“publish name”).

### Current flow

```
1. loadOpns(id) → outpoint, BEEF, tags, customInstructions
2. getPublicKey(identityKey)
3. PushDrop.lock(..., includeSignature=true)
     → getPublicKey(p 1sat, keyID=opns:…)
     → createSignature(data=identity bytes)     ← FIELD-SIG
        [gated] module: no tx context → bare “Sign payload” card
4. executeTrackedAction / createAction
     labels: p 1sat action, optional p 1sat input opns <id>
     output: PushDrop script, basket opns, tags incl. opns:published
        [gated] module: enrichIntent → kind “opns” → “Update OpNS Name” card
        [gated] onResponse: hashOutputs cache
5. signOrdinalInput (spend name UTXO)
     → createSignature(BIP-143 preimage)
        [gated] auto-grant if cache hit
6. funding sigs similarly / WPM spending as applicable
```

**Base/CLI:** steps 3–5 run with no cards (or admin silent).  
**dApp gated:** often **two** cards (opaque sig, then weak “update”), then silent spends.

**Who builds the bind?** Action, fully, before createAction.  
**Who explains publish?** Heuristic UI after the fact; no intent label.

### Proposed flow (aligned with locked split)

**`applyOpnsRegister(baseWallet, args)`** — narrow: identity + PushDrop field-sig; overwrite output[0].lockingScript (+ CI/tags as needed) **in place**. Does not replace full action build.

**Action:** load → full args (intent + input labels, real input+BEEF, 1-sat out shell) → if base, apply → `executeTrackedAction` → sign via id re-lookup.

**Module:** intent → re-lookup for card → prompt (skip if admin) → apply on base in place → underlying CA → hashOutputs cache.

**Spend sigs:** BIP-143 auto-grant after approved createAction (unchanged idea).

### Current vs proposed (publish)

| | Current | Proposed |
|--|---------|----------|
| Field-sig | On gated wallet **before** createAction | `applyOpnsRegister` on **base** (action if base host; module if gated) |
| User cards (dApp) | Sig + “Update OpNS” | One “Publish name” |
| Intent | Inferred from baskets/tags | Explicit `opns.register` label |
| Display name | Tags on args / weak enrich | Module re-lookup by id |
| createAction → sig auto-grant | Yes | Yes (kept) |
| Who builds tx shape | Action | **Action** (apply only seals PushDrop) |
| Mode switch | None (always signs early) | `ctx.isBaseWallet` (or equivalent) |

### Locked split (2026-07-25 review)

| Layer | Owns |
|-------|------|
| **Action** | Load, inputs, BEEF, output shells, tags, intent + input labels, description |
| **Module** | Prompt from wallet re-lookup + intent; commit; dispatch apply |
| **Apply** | Only trusted extras (e.g. PushDrop field-sig into out); most intents validate-only |

Stepped back from “all logic in apply.” Flag name still TBD.

---

## Deeper dive — `executeTrackedAction` and publish

### What that helper actually does today

Not only ID tags. For the **wallet path** (no external funder):

| Step | Responsibility |
|------|----------------|
| `randomActionId` | Stable id for this execution |
| `applyTrackingTags` | Every basketed output gets `id:<actionId>_<outputIndex>` |
| `applyOneSatLabel` | Ensures `p 1sat action` so WPM dispatches createAction to the 1sat module (and so createSignature can attach to a prior commitment) |
| `createAction({ signAndProcess: false })` | Always two-phase |
| `completeSignedAction` | Merge BEEF, run caller `sign` callback, verify those unlocks, `signAction`, **abort** on local failure so pending change isn’t leaked; inspect broadcast results |

For the **fundingProvider path** (different world):

| Step | Responsibility |
|------|----------------|
| Same id tags + `p 1sat action` label on args | Still applied |
| `fundingProvider.fund(args)` | External party builds/funds/broadcasts from the **completed** CreateActionArgs |
| `wallet.internalizeAction` | Basket insertion of the resulting tx (tags, customInstructions, baskets from args) |
| **No** wallet createAction / completeSignedAction | No hashOutputs commitment path through the module’s createAction intercept |

`bypassP1Sat: true` skips **both** id tags and the dispatch label (sigma anchor use case).

### Publish specifically through this stack

```
registerOpns
  load spend
  PushDrop.lock (field-sig)          ← outside executeTrackedAction
  executeTrackedAction(args, fundingProvider?, beef, signOrdinalInput)
       │
       ├─ if fundingProvider:
       │     fund(args) → internalizeAction     ← never hits module createAction
       │
       └─ else:
             createTrackedAction → createAction  ← module prompt + commitment
             completeSignedAction → sign spend   ← auto-grant if commitment ok
```

### Label note (from review)

`p 1sat action` is only a **dispatch** hammer so createAction enters the module when baskets/labels might otherwise be missed. **Intent label** (`p 1sat intent opns.register`) can replace that role for publish if it always starts with `p 1sat`. Basket `p 1sat opns` on the output also forces module routing. So the generic action label is likely **redundant** once every tracked op carries intent (and/or P baskets). Keep id tags either way.

### Conflicts / issues for the proposed model

1. **When apply runs vs when tags are stamped**  
   `applyTrackingTags` runs at the start of `executeTrackedAction` / `createTrackedAction`. If apply **adds or rewrites outputs** inside the module **after** the dApp already called createAction, id tags must be applied **after** apply (module or shared prep), not only in the action helper before the intercept. Base path: apply then stamp then createAction is fine if order is explicit.

2. **Funding provider bypasses createAction**  
   Publish with `fundingProvider` never hits module `onRequest(createAction)`. No prompt, no hashOutputs cache, no module-side apply. Today the action has already field-sig’d before fund. Under the proposal:
   - **Base + funder:** apply on base, then fund(complete args) — OK if funder is trusted with full scripts.
   - **Gated + funder:** user never enters createAction intercept; permissions story is **undefined**. Options later: ban funder on gated, or require a prior permissioned “session,” or have funder path call module explicitly. **Call out as a real fork** — not a small detail.

3. **completeSignedAction still needed**  
   Abort-on-failure, BEEF merge, script verify, sign callback for the OpNS input — none of that is the permission module’s job. Proposed flow still wants this after a successful createAction (wallet path). Compatible.

4. **signAndProcess: false is load-bearing**  
   Module commitment + caller-built unlocks assume two-phase. Don’t collapse to signAndProcess true for gated P ops without a new design.

5. **internalizeAction on funder path**  
   Uses labels/tags from args; if those include intent labels, module may see **internalize** (basket access) not createAction enrich. Different prompt surface today (`basketAccess`). Publish-via-funder may only get basket grants, not “Publish name.”

6. **executeTrackedAction vs “streamline everything”**  
   Worth keeping as a **shell** if we redefine it slightly:
   - ensure id tags (after final outputs exist)
   - ensure intent/P dispatch labels (not necessarily `p 1sat action`)
   - wallet path: createAction → completeSignedAction
   - funder path: fund → internalize (with an explicit policy for gated)
   - optional: call `apply*` when `isBaseWallet` before either path  

   Or split: `finalizeTrackedArgs` (tags) + `runWalletAction` + `runFundedAction` so publish’s apply sits cleanly before both.

7. **No fundamental incompatibility** with createAction-commit → signature auto-grant on the **wallet** path. The awkward pieces are **pre-createAction crypto** (apply moves that) and **funder path** (never createAction).

### Recommendation (publish-sized, not a full rewrite)

- Keep **id tagging** and **completeSignedAction** behavior.  
- Drop reliance on bare `p 1sat action` once intent is mandatory for module ops.  
- Treat **executeTrackedAction** as still useful plumbing, not the permission brain.  
- **Design fundingProvider + gated explicitly** before implementing publish; don’t assume createAction-centric permissions cover it.  
- Apply order: **apply → stamp ids → createAction/fund**.

---

## Example B — Inscribe with sigma

*Placeholder — fill after publish review.*

Today (one-line reminder): anchor createAction (`bypassP1Sat`) → `applySigma` (BAP `createSignature`) → inscription createAction (`p 1sat`) → spend anchor.

Proposed direction under discussion: first createAction with intent is the **permission entry**; after approve, trusted wallet runs the **full chain** as apply; dApp sees one logical result. Detail after publish sign-off.

---

## Decision log

| Date | Note |
|------|------|
| 2026-07-25 | Doc created; publish current vs proposed for review |
| 2026-07-25 | Locked: action owns build; apply narrow (sig-in-script etc.); in-place rewrite |
| | Sigma section deferred until publish feedback |
