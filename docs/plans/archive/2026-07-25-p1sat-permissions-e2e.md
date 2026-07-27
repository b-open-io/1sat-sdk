# P1SAT permissions — end-to-end walkthrough

Status: **In progress** — living doc; fill one action at a time  
Started: 2026-07-25  
Prior art: [2026-07-23-p1sat-permission-prompts.md](./2026-07-23-p1sat-permission-prompts.md)

## Purpose

Walk every `@1sat/actions` flow that touches `p 1sat` baskets / protocol and
document, without assuming the current design is correct:

1. **What actually happens** (tx shape, wallet calls, order)
2. **What the user should approve** (verb + facts) — dApp / interactive mode
3. **Where those facts come from** (trusted sources only)
4. **How the same action works in trusted mode** (CLI / direct wallet) with no fork
5. **What the permission layer must gate** so a dApp cannot bypass

Implementation detail is deferred until the dual-mode pattern is solid.

---

## Dual-mode model (architectural)

Two ways a human ends up “doing” an action — **same action code**, different trust.

| Mode | Example | Who chose the verb? | Permission UI? |
|------|---------|---------------------|----------------|
| **Trusted** | CLI: `1sat opns publish alice` | The user, explicitly | No — call is the intent |
| **Untrusted** | dApp site calls `registerOpns` | The website claims the user wants it | Yes — wallet must prove and explain |

```
                    ┌──────────────────────────┐
  Action            │  registerOpns (one path) │
  (mode-agnostic)   │  builds real wallet calls│
                    └────────────┬─────────────┘
                                 │ WalletInterface
              ┌──────────────────┼──────────────────┐
              ▼                                     ▼
     Direct / admin                          WPM + p 1sat module
     (CLI, trusted host)                     (extension, dApp originator)
              │                                     │
              │ pass-through                        │ intercept → validate
              │                                     │          → prompt?
              ▼                                     ▼
                    underlying wallet (keys, storage, broadcast)
```

### Principle: intercept, don’t fork

- **Actions always perform the real work** via normal `WalletInterface` calls
  (`getPublicKey`, `createSignature`, `createAction`, `listOutputs`, …).
- **Permissions never own a second implementation** of “how to build a publish.”
  They sit in front of the wallet and may block, explain, or auto-allow.
- **Trusted mode** = no module, or admin/trusted originator → same signatures,
  same scripts, zero (or silent) prompts.
- **Untrusted mode** = module sees the same calls and must make them safe/clear.

If we moved “the field-sig only happens inside the permission UI,” trusted users
would need a different step to produce the same bytes. That is a fork. Avoid it.

If we moved “createAction is assembled inside the prompt” for dApps only, CLI
and dApp diverge. Avoid it.

**Current shape (action builds → module restates) is the right dual-mode spine.**
The work is to make restatement *accurate and intentional*, not to relocate
construction into the UI layer.

### What each layer is for

| Layer | Responsibility |
|-------|----------------|
| **Action** | Domain workflow: load asset, build scripts/args, sign spends, complete tx. May *label* intent for the module. Does not talk to popup UI. |
| **Baskets + `p 1sat` protocol** | Force asset ops through names the module can see. dApp cannot spend/list OPNS under a silent non-P path if keys and baskets are P-bound. |
| **Permission module** | Untrusted gate: understand what call(s) mean, load facts from wallet DB + committed scripts, prompt once with friendly copy, refuse counterfeits. |
| **Prompt UI** | Render an already-decided display model. No authority, no second parse of truth. |

### What the user is signing off on (untrusted)

Not “here is a raw tx.” Not “here is a keyID.”

For publish: **this originator wants to publish name X on a name I already hold.**

Facts for that sentence come from **our** storage and **scripts we will commit**,
not from the dApp’s marketing tags. Identity bind is checked as *self* in the
gate; it is not the headline of the card.

### Multi-step wallet calls (register as example)

Publish is naturally several wallet calls in one user intention:

1. Field-sig while building the bind lock  
2. createAction for the self-spend  
3. BIP-143 sigs for inputs  

**Trusted:** all three just run.  
**Untrusted:** the *session* should feel like one approval; intermediate calls
must not each dump a cryptic card. How we correlate those calls is a later
design choice — the invariant is: **action still issues all three; module
correlates when present.**

### Bypass resistance (both modes)

- Spend/sign under `p 1sat` → module (if installed) always sees signatures.
- Basket `p 1sat opns` → list/internalize gated; createAction with that basket labeled.
- Direct wallet without module: user/host is trusted; baskets still organize
  storage but interactive proof is unnecessary.
- dApp must not be able to get a publish-shaped bind by skipping labels and
  hoping heuristics say “unknown allow.” Fail closed when we *know* the shape
  or when a claim is present and wrong. (Exact policy TBD per action.)

### Working hypothesis (pattern, not implementation)

1. **One action path** for CLI and dApp.  
2. **Optional interceptor** adds understanding + UI only when untrusted.  
3. **Intent is explicit when we can** (action labels what it is doing) so the
   module does not reverse-engineer forever.  
4. **Module validates** labels/scripts/DB; UI stays thin.  
5. **Optimize correlation of multi-call ops**, not relocation of building into
   the prompt.

### The double-prompt problem (register as example)

User intention: **publish this name.**

Wallet calls the action must make either way:

1. `createSignature` — field-sig **into** the output locking script  
2. `createAction` — self-spend that carries that script (basket, labels, …)  
3. Later BIP-143 `createSignature`s — unlock inputs  

Today in a **permissioned** wallet those hooks surface separately → **two** (or more)
cards: opaque “sign payload”, then “update OpNS”. In a **direct** wallet the same
calls never popup — and that must keep working.

dApp-facing hooks we care about live on the wallet path (`createAction`,
`createSignature` / sign flows, etc.). The field-sig is not a special side
channel; it is a normal `createSignature` that happens to run *before*
`createAction` because the sig bytes are *part of* the output script.

### What we will not do

| Approach | Problem |
|----------|---------|
| Put publish logic only inside the permission UI | Direct/CLI never runs that UI → broken or forked build |
| Action branches `if (permissioned) … else …` | Every action learns the trust boundary; messy, easy to get wrong |
| Split register into two user-facing actions | CLI UX worse; dApp can still call the dangerous half |
| Build the tx inside the prompt | Second implementation of the action |

### Clean simple layer: **mode-blind actions + optional gate**

```
Action (never asks “am I trusted?”)
    │
    │  always: real createSignature / createAction / …
    ▼
WalletInterface
    │
    ├─► Direct wallet          → execute
    │
    └─► Permissioned wallet    → gate may:
           (WPM + p 1sat module)    • prompt (once per user intention when it can)
                                    • validate (DB + scripts)
                                    • allow / deny
                                    • then execute
```

**Actions do not know the trust boundary.**  
**Hosts choose the wallet wrapper.**  
CLI wires a direct (or admin) wallet. Extension wires WPM + module. Same
`registerOpns(ctx, { id })`.

The gate’s job for multi-call ops is **correlation**, not construction:

- Direct: call 1, 2, 3 just run. No popups. No “prior grant” required.  
- Permissioned: gate recognizes these calls belong to one publish, shows **one**
  friendly card, still produces the **same** signatures and tx as direct.

So “abstract the signature request” does **not** mean the action picks a
different code path. It means the **wallet gate** may treat that
`createSignature` as part of a larger intention when it has enough context —
and when it has no gate, nothing special happens.

### Invariants (keep the layer simple)

1. **Same bytes either mode** — field-sig, locking script, tx body identical
   whether or not a human saw a card.  
2. **Gate is optional** — absence of module never requires a grant, session, or
   prompt token the action must supply.  
3. **Action may label intent** (optional metadata on calls/labels) so the gate
   does not guess forever — labels are hints + validator switches, not a second
   API.  
4. **Fail closed only when the gate is present and sure** — bad claim, wrong
   identity in bind, script doesn’t match what was approved. Direct mode has no
   gate to fail.  
5. **UI never builds** — only displays what the gate already decided.

### How this feels per mode (register)

| | Trusted / direct | Untrusted / permissioned |
|--|------------------|---------------------------|
| User intent | CLI command / in-app button they own | dApp originator must be checked |
| Field-sig | Silent | Part of **one** “Publish name” approval (not its own cryptic card) |
| createAction | Silent | Same approval session — no second “what is this?” card |
| Spend sigs | Silent | Silent if bound to approved tx (existing idea) |
| If user rejects | N/A (or CLI abort) | No sig, no tx |

### Open design choice (later, still not implementation)

How the gate **correlates** call 1 with call 2 (session, pending approval,
intent labels, keyID conventions, …) is TBD. Whatever we pick must preserve
invariants 1–2: direct mode stays a straight line; permissioned mode only adds
a lens.

Prefer the dumbest correlation that keeps **one card** and **one action body**.

### Locked decision (2026-07-25): context flag + narrow apply

**Mode flag** on `OneSatContext` (name TBD). Base: action runs apply before CA. Gated: module prompts then apply on base. Admin: apply, no prompt.

**Split**

| Layer | Owns |
|-------|------|
| **Action** | Almost all op logic: load, inputs, BEEF, output shells, tags, intent + input labels |
| **Module** | Prompt (wallet re-lookup + intent); fail closed; hashOutputs; dispatch apply |
| **Apply** | Narrow trusted extras only (PushDrop/sigma sig-in-script, later multi-tx). Most intents = validate-only |

**Publish:** action builds full args including real input + 1-sat out placeholder → prompt → apply seals PushDrop **in place** → underlying CA → sign by id re-lookup.

**In-place rule:** mutate existing outputs/inputs objects; do not replace arrays (WPM spend/verify).

Rejected: full logic in apply; instanceof detection; fake double-createAction prepare hack.

---

---

## Shared plumbing (reference)

| Piece | Role |
|-------|------|
| `executeTrackedAction` | Adds `p 1sat action` label + per-output `id:`; `createAction(signAndProcess:false)` → `completeSignedAction` |
| `buildInputAssetLabel(basket, id)` | `p 1sat input <suffix> <id>` → module `listOutputs` by `id:` |
| WPM | Encrypts descriptions/customInstructions before modules see args |
| Module `onRequest(createAction)` | enrich/validate → prompt |
| Module `onResponse(createAction)` | Cache BIP-143 `hashOutputs` + authorized outpoints (60s) |
| Module `onRequest(createSignature)` | Auto-grant if preimage matches cache; else bare signature prompt |
| `P1SAT_PROTOCOL` `[0, 'p 1sat']` | Level 0 — `getPublicKey` always passes today |

**Trust baseline today**

| Source | Trust |
|--------|-------|
| Input metadata via `id:` → wallet storage | Trusted |
| Recipient from locking-script decode | Trusted (committed) |
| Output tags on createAction args | **Untrusted** (app-supplied) |
| `description` / customInstructions in args | **Unavailable** (WPM encrypts) |
| Claim label (proposed) | Untrusted switch; validator must fail closed |

---

## OpNS

Basket: `p 1sat opns`  
Protocol for asset keys / PushDrop: `P1SAT_PROTOCOL`  
Bind constants: `OPNS_PUBLISHED_TAG`, `OPNS_PUSHDROP_TEMPLATE`, `opnsRegisterKeyId`, `OPNS_REGISTER_COUNTERPARTY = 'anyone'`  
Spec: `docs/protocols/opns-paymail-bind.md`

### `registerOpns` ✅ walked

**Files:** `packages/actions/src/opns/index.ts` · `signOrdinalInput.ts` · PushDrop (`@bsv/sdk`)

#### What actually happens (order)

1. **Load spend** — `loadBasketOutputBeef(wallet, OPNS_BASKET, id)` → owned UTXO + BEEF + tags + `customInstructions`.
2. **Identity key** — `getPublicKey({ identityKey: true })` (not P1SAT protocol).
3. **Build bind lock (BEFORE createAction)** — `PushDrop(wallet).lock([identityPubKey], P1SAT_PROTOCOL, keyID, 'anyone', forSelf=true, includeSignature=true)` where `keyID = opnsRegisterKeyId(inputOutpoint)` → `opns:{txid}_{vout}`.
   - Inside PushDrop.lock:
     - `getPublicKey({ protocolID: P1SAT_PROTOCOL, keyID, counterparty: 'anyone', forSelf: true })` — module **pass-through** (level 0).
     - `createSignature({ data: fields.flat() /* identity pubkey bytes */, protocolID, keyID, counterparty: 'anyone' })` — **field-sig, NOT a BIP-143 preimage**.
       - No createAction commitment exists yet → module falls through to **`kind: 'signature'`** bare prompt (“Sign payload”, protocol/keyID/bytes).
4. **createAction** via `executeTrackedAction`:
   - Input: OpNS outpoint, unlocking length from current customInstructions (P2PKH ~108 or PushDrop ~73 if already published).
   - Output: 1 sat, PushDrop locking script, basket `OPNS_BASKET`, tags = ordinal seed + `opns` + `opns:published` (+ carried name/origin/…), customInstructions `{ protocolID, keyID, counterparty, template: 'pushdrop', name? }`.
   - Labels: `p 1sat action` + optional `p 1sat input opns <id>` if input has `id:` tag.
5. **Module createAction path** — `enrichIntent` → kind **`opns`** (input basket or output basket) → UI **“Update OpNS Name”** (cannot distinguish register).
6. **onResponse** — hashOutputs + outpoints cached.
7. **Sign input** — `signOrdinalInput` → P2PKH or PushDrop unlock via `createSignature` with full BIP-143 preimage in `data` → **auto-grant** if within 60s and outpoint authorized.
8. **Funding inputs** (if any) — same commitment auto-grant under P1SAT when signed that way; plain change may also hit WPM DSAP spending (separate card).

#### What the user should approve (target)

Focused, user-facing — not a crypto disclosure:

| Field | Value |
|-------|--------|
| Verb / title | **Publish name** |
| Name | The OpNS name being published |
| Optional | Origin / short context only if it helps recognition |
| **Not in UI** | Identity pubkey hex, keyID, protocol strings, field-sig details |
| **Not** | Generic “Update”; not bare “Sign payload” as the primary story |

Identity is always **this wallet’s** identity key. Showing it adds noise. The module still **must** verify the bind is self so a dApp cannot counterfeit a “publish” that binds someone else’s key (or an arbitrary payload) under a friendly title.

#### Where prompt data should come from

| Fact | Role | Source | Trust |
|------|------|--------|-------|
| Name | **Display** | Input UTXO `name:` / customInstructions via `listOutputs` by `id:` | Trusted (wallet) |
| Origin | Display (optional) | Input tags `origin:` | Trusted |
| Already published? | Product / copy | Input tags +/or script template | Trusted |
| Identity == self | **Validate only, not display** | Decode PushDrop fields[0]; compare to `getPublicKey({ identityKey: true })` | Must match or reject claim |
| keyID binding | Validate only | `opnsRegisterKeyId(spentOutpoint)` vs script derivation | Derived from input outpoint |
| Field-sig | Validate only | Verify over fields with same key derivation | Cryptographic |
| `opns:published` tag | Hygiene only | Output tags | Untrusted alone; script shape is proof |

**Today’s UI** uses input/output tags for name; no PushDrop decode; no “publish” verb.

#### Permission / signing processes required

| Call | When | Desired behavior |
|------|------|------------------|
| `getPublicKey` identity | Before lock | Silent |
| `getPublicKey` P1SAT keyID | Inside PushDrop.lock | Silent (level 0) |
| `createSignature` **field-sig** | Inside PushDrop.lock, **before** createAction | Must be covered by the **one** user approval (see attack plan) |
| `createAction` | After lock built | Validate bind script + capture hashOutputs; **no second full prompt** if grant matches |
| `createSignature` BIP-143 | Spend name UTXO (+ funding) | Auto-grant via hashOutputs (existing) |

#### Product rule (register / bind)

> **Validate self-identity hard; display name soft.**  
> One friendly prompt: Publish **{name}**. Counterfeit resistance lives in the validator.

---

### `registerOpns` — plan of attack

> **Status:** exploratory notes from an earlier pass.  
> Prefer the **Dual-mode model** above. Do not treat grant caches / phase
> diagrams below as decided implementation — they are one way to correlate
> multi-call ops under intercept-don’t-fork.

#### Hard constraint (do not hand-wave)

```
PushDrop.lock(includeSignature=true)
  → createSignature(field-sig)     // MUST happen first
  → locking script includes sig
createAction(outputs: [that script])
  → user approval + hashOutputs cache
createSignature(BIP-143 spend)     // auto-grant from cache
```

The field-sig is **not** a BIP-143 preimage. It cannot ride the post-createAction commitment cache.

You also **cannot** invent the locking script after createAction approval: outputs are fixed in the approved tx. So “approve createAction first, then field-sig” is impossible without changing PushDrop / two different scripts (user would approve the wrong bytes).

**Implication:** The **primary** user prompt for register must fire at (or before) field-sig time. createAction becomes **validate + bind commitment**, not the first time the user hears “Publish name”.

#### Rejected approaches

| Approach | Why not |
|----------|---------|
| Unsigned PushDrop in createAction, sign later | Output script would change after approval → breaks commitment |
| Auto-grant any `opns:*` field-sig without prompt | Forges binds; dApp could sign arbitrary field payloads |
| Two full prompts (sig then tx) | Bad UX; what we have today in worse form |
| Action calls UI directly | Breaks WPM/module trust boundary |
| Show identity key in UI for “safety” | Noise; real safety is validator equality check |

#### Recommended approach: **grant at field-sig, verify at createAction**

Two module phases, **one** user-facing card.

```
┌─────────────────────────────────────────────────────────────┐
│ Phase A — createSignature (field-sig)                       │
│  Detect: protocol p 1sat, keyID ^opns:, data = 33-byte key? │
│  Resolve: keyID → outpoint → OPNS basket row (wallet DB)    │
│  Check: data bytes === wallet identity key                  │
│  Prompt ONCE: “Publish name” + name (+ optional origin)     │
│  On approve → PendingBindGrant { outpoint, name, exp }      │
│  Return args (allow field-sig)                              │
└───────────────────────────┬─────────────────────────────────┘
                            │ PushDrop.lock finishes
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase B — createAction                                      │
│  Labels: p 1sat action + p 1sat input opns <id>             │
│          + p 1sat intent opns.register  (claim)             │
│  Validator opns.register:                                   │
│    • input resolves to same outpoint as grant               │
│    • output script = signed PushDrop                        │
│    • fields[0] === identity                                 │
│    • keyID derivation matches spent outpoint                │
│    • field-sig verifies                                     │
│    • grant present & unexpired                              │
│  If valid → NO second prompt; onResponse caches hashOutputs │
│  If invalid / no grant → reject (fail closed on claim)      │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase C — createSignature (BIP-143)                         │
│  Existing hashOutputs + outpoint auto-grant                 │
└─────────────────────────────────────────────────────────────┘
```

**Why field-sig is a safe place to prompt**

- `keyID` is structured: `opns:{txid}_{vout}` → exact UTXO being published.
- `data` must be identity pubkey bytes — module compares to `getPublicKey({ identityKey: true })` **before** showing the friendly card. Wrong data → hard reject, no “Publish” chrome.
- Name comes from **wallet storage** for that outpoint, not from dApp tags on the signature request (signature args have no tags).

**Why createAction still matters**

- Commits the user to the **full tx** (including fee inputs once built).
- Verifies the locking script actually embeds the approved bind (dApp can’t swap script after field-sig).
- Establishes hashOutputs for spend auto-grant.
- Claim label makes intent explicit for validators and future unlabeled policy.

**Grant TTL:** short (e.g. 60s, same order as commitment cache). One-shot consume on successful createAction validate (or keep until expiry if createAction aborted — product choice; prefer consume-on-success + expire).

#### Claim + validator (concrete)

**Claim label:** `p 1sat intent opns.register`  
(Emitted by action in `labels` alongside `p 1sat action` and input asset label.)

**Validator inputs**

1. Parse claim; if claim present and not `opns.register` → other validator or reject.
2. Resolve `p 1sat input opns <id>` → exactly one OPNS basket output.
3. Pending grant exists for `input.outpoint` (or grant.outpoint matches).
4. Name for display already fixed at grant time from wallet row.

**Validator outputs**

1. Find OPNS_BASKET output (expect one primary).
2. `PushDrop.decode(lockingScript)`.
3. `fields[0]` hex === wallet identity key (fail closed).
4. Re-derive lock pubkey: protocol + `opnsRegisterKeyId(input.outpoint)` + counterparty anyone + identity; match script lock pub.
5. Verify field-sig over fields.
6. Optional: reject re-publish if input already has valid bind (product).

**Do not trust** output tags for the security decision; tags may still be copied for wallet filing.

#### Display model (UI contract)

```ts
{
  kind: 'transaction', // or dedicated 'opns.register' if we split kinds
  verb: 'publish',
  title: 'Publish name',
  subtitle: '<originator> wants to publish “{name}”', // originator optional short
  rows: [
    { key: 'Name', value: name },
    // origin only if useful for disambiguation
  ],
  // no identity, keyID, protocol, dataLength
}
```

Same component family as other 1Sat cards (coin badge, Approve/Reject). Field-sig path uses this model, **not** `kind: 'signature'`.

#### Action changes (`registerOpns`)

1. Emit `p 1sat intent opns.register` on createAction labels.
2. Always emit input asset label when `id:` present (already).
3. No need to call a new prompt API — PushDrop.lock’s createSignature becomes the prompt surface via module intelligence.
4. Ensure name is on the wallet row before register (ingress/mint path); if missing, module shows “Publish name” without name or rejects — **prefer reject or “Unknown name”** only if we can’t resolve (product: fail closed if no name tag).
5. Keep PushDrop.lock order as-is (no fragile reorder).

#### Module changes

| Area | Work |
|------|------|
| `handlers.handleCreateSignatureRequest` | Branch: non-BIP143 + keyID `opns:` + data is identity → resolve outpoint, validate data===identity, prompt Publish, store `PendingBindGrant` |
| `PendingBindGrant` store | Beside commitment cache; TTL; match outpoint |
| `validators/opns.register.ts` | Script + grant checks above |
| `handleCreateActionRequest` | If claim `opns.register` → run validator; on ok skip prompt; on fail throw; if no claim keep legacy enrich path |
| `enrichIntent` / UI kinds | Add publish-specific display path; stop mapping register to “Update” |
| Tests | Happy path one prompt; wrong identity data rejected; grant missing at createAction rejected; swapped script rejected; BIP-143 still auto-grants |

#### yours-wallet

- No special page if `PromptRequest` display model is enough — existing `OneSatPermissionPrompt` gains a **Publish name** summary branch.
- Confirm field-sig path opens the same popup host (`oneSatPrompt` / `OneSatPermissionRequest`).

#### UX target (single card)

| Step | User sees |
|------|-----------|
| 1 | **Publish name** · Name: `alice` · Approve / Reject |
| 2 | (nothing — createAction silent if valid) |
| 3 | (nothing — spend sigs silent) |
| Fee | Existing WPM spending card if separate — out of scope unless we combine later |

#### Open product choices (pin before mockups)

1. **Re-publish** already-bound name: allow (refresh bind) vs reject vs copy “Update published name”?
2. **Missing `name:` on UTXO:** reject vs allow with origin-only?
3. **Grant consume:** one-shot on successful validate vs TTL-only?
4. **Claim required for register-shaped txs:** only when claim present fail-closed (recommended) vs also detect PushDrop bind without claim and force same validator?

#### Implementation order (after mockup signoff)

1. Display model + UI mock for Publish card (no backend).
2. PendingBindGrant + createSignature branch + tests.
3. opns.register validator + createAction skip-prompt path + tests.
4. Action emits claim label.
5. Manual e2e in yours-wallet: one card, then silent finish.
6. Only then generalize pattern to other field-sig / multi-phase actions.

#### Current UX summary (baseline)

| Prompt | What user sees | OK? |
|--------|----------------|-----|
| 1st | Signature: protocol / keyID / byte length | **No** |
| 2nd | “Update OpNS Name” | **No** — wrong verb; redundant |
| 3rd+ | Silent BIP-143 | OK once primary approval is right |

---

### `deregisterOpns` — pending

### `sellOpns` — pending

### `sendOpns` — pending

### `cancelOpnsListing` — pending

### `buyOpns` — pending

### `listOpns` (read) — pending (basketAccess only)

### `internalizeOpns` — pending (internalize / basket insert)

---

## Ordinals — pending

## Locks — pending

## BSV21 — pending

## Identity / social / sweep — later

---

## Cross-cutting issues (accumulate as we walk)

1. **PushDrop field-sig before createAction** — registerOpns (and any signed PushDrop lock build) can fire bare `createSignature` prompts with no tx context.
2. **Coarse kind `opns`** — register / deregister / self-move all “Update”.
3. **Output tags untrusted** for kind + display.
4. **No intent claim channel** yet.
5. **WPM encryption** strips descriptions before module.
6. **Double card** — 1Sat asset prompt + WPM spending for fees (product later).

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-07-25 | New living e2e doc; old plan remains prior art |
| 2026-07-25 | Start OpNS with `registerOpns` |
| 2026-07-25 | Register: validate bind is wallet identity; do **not** surface identity key in prompt UI |
| 2026-07-25 | Dual-mode: context flag; createAction is dApp prompt point |
| 2026-07-25 | Admin module path = silent apply, not skip-all passthrough |
| 2026-07-25 | Action owns build; apply narrow (sig-in-script); in-place rewrite |

---

## Next

Walk **`deregisterOpns`** the same way (happens / prompt / data / signing).
