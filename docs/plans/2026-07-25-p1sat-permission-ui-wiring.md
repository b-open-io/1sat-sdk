# P1Sat permission UI wiring

Status: **In progress**  
Goal: Wire `@1sat/permission-module` + `@1sat/permission-module-ui` to match locked architecture + Pencil mockups.  
Architecture (source of truth): [2026-07-25-p1sat-permissions.md](./2026-07-25-p1sat-permissions.md)  
Mockups: [`mockups/p1sat-permissions.pen`](./mockups/p1sat-permissions.pen)

This plan is the resume doc for incomplete sessions. Architecture decisions stay in the permissions plan; this file tracks **implementation steps and done/not-done**.

---

## Scope split

| In this plan | Stays in architecture plan / later |
|--------------|-------------------------------------|
| PromptRequest shape for cards | `isBaseWallet` flag on context |
| Intent label parse (`p 1sat intent …`) | Narrow apply dispatch / PushDrop seal |
| Module re-lookup + trust badges | Sigma multi-tx apply |
| UI components matching `.pen` | Full action label rollout for every op |
| Copy-to-clipboard on truncated ids | Purchase pre-fund / DSAP unify |
| BSV21 icon + indexer fee on card | Stream inscribe gated |

Host (yours-wallet) already renders `OneSatPermissionPrompt` — prefer evolving that component over a parallel UI.

---

## Design → code map (from `.pen`)

| Shared block | UI | Module data |
|--------------|-----|-------------|
| Originator line | `{originator} wants to …` | `PromptRequest.originator` |
| Title | per-intent (see brief table) | from intent id, not freeform dApp string |
| Asset preview | image + title + subtitle | ORDFS / wallet re-lookup; tags = hints only |
| Token preview | icon + sym + id + **copy** | `icon:` tag / overlay icon; content URL |
| Trust badge | verified / unverified / mismatch | purchase + hint paths only |
| Detail rows | key / value | structured fields |
| Copy control | on every truncated id / outpoint / address | full string always in data model |
| Indexer fee | BSV21 only; not network fee | recognize fee out via overlay `fee_address` + `fee_per_output × token outs` |
| Basket list | basket + capability line | existing `basketAccess` |
| Actions | Reject / Approve | host `promptHandler` |
| Out of scope on card | network fee, DSAP, identity hex, raw keyID/protocol as primary | — |

Frame → intent id: see legend in `.pen` (`Frame → Intent Map`).

---

## Current code baseline

| Package | State |
|---------|--------|
| `permission-module` | Enriches via `p 1sat input` labels; kinds like `ordinal-transfer`, `opns` (coarse); no `p 1sat intent` yet; no apply rewrite |
| `permission-module-ui` | `OneSatPermissionPrompt` + inlined CSS; titles lag mockup brief; no trust badges, copy, token icon, indexer fee |
| yours-wallet | Hosts prompt via `oneSatPrompt` bridge — keep |

---

## Phases (check off as you go)

### Phase 0 — Types & intent id

- [x] Add stable intent ids to module types (`opns.register`, `ordinal.transfer`, …) matching architecture matrix
- [x] Parse `p 1sat intent <id>` from createAction labels (`parseIntentLabel` + enrich + handlers)
- [x] Keep backward path for coarse kinds; prefer intent id for titles/summary/apply
- [x] Expand `P1SAT_APPLY_REGISTRY` validate-only for full intent matrix (rewrite still only `opns.register`)

**Resume check:** unit tests parse labels → intent id; unknown intent → reject or unknown card. (tests still thin)

### Phase 1 — Prompt model for UI

- [ ] Define a typed `PromptViewModel` (or tighten `PromptRequest.intent`) the UI can render without re-deriving trust:
  - `title`, `subtitle`, `originator`
  - `featured?` (image/icon, title, subtitle)
  - `rows: { key, value, copyable?: boolean }[]`
  - `trust?: { state: 'verified' \| 'unverified' \| 'mismatch', note? }`
  - `baskets?` for basketAccess
- [ ] Module builds view model after re-lookup; UI stays mostly dumb
- [ ] Always pass **full** strings for copyable fields; UI truncates for display only

**Resume check:** snapshot/fixtures for `opns.register`, `ordinal.transfer`, `ordinal.purchase` (3 trust states), `bsv21.transfer`, `basketAccess`.

### Phase 2 — UI chrome (match `.pen`)

- [x] Evolve `OneSatPermissionPrompt` + `styles.ts` (dark/light already present)
- [x] Components: trust badges, token preview (48px circle), copy button on truncated values
- [x] Copy UX: click icon → clipboard; brief checkmark; no large toast
- [x] Titles/subtitles from mockup brief table (via `p1satIntent` + INTENT_TITLES)
- [x] Hide network fee / estimated fee on 1sat card
- [x] BSV21: icon when `contentUrls` has icon/token id; placeholder when absent; indexer fee from module fields or transfer heuristic

**Resume check:** visual parity with priority frames in `.pen` (publish name, send ordinal, buy ordinal × trust, basket access, send tokens). Spot-check in yours-wallet popup.

### Phase 3 — Module enrichment by intent

Wire re-lookup + card facts per family (validate-only apply can stay stub until Phase 4):

- [ ] **OpNS:** register / deregister / list / transfer / cancel / purchase  
  - name from wallet id re-lookup  
  - purchase: overlay name↔origin trust
- [ ] **Ordinals:** transfer / list / cancel / purchase / burn / inscribe / mint-*  
  - ORDFS preview when origin known  
  - purchase trust states  
  - inscribe: parse type/size from **script** (authority)
- [ ] **BSV21:** transfer / purchase / mint / deploy  
  - icon from tags/overlay  
  - indexer fee: match output to `fee_address`, amount `fee_per_output * tokenOutCount`  
  - purchase: overlay active badge when validated
- [ ] **Locks:** lock / unlock  
- [ ] **basketAccess:** keep list UX; multi-basket card title

**Resume check:** each intent has a fixture prompt that matches brief primary facts.

### Phase 4 — Apply skeleton (thin)

- [ ] Dispatch apply by intent id after approve
- [ ] Most intents: validate-only (no rewrite)
- [ ] `opns.register`: PushDrop seal in place (canonical rewrite)
- [ ] Mutate args **in place** (no array replace)
- [ ] Admin originator: apply, no prompt

**Resume check:** `opns.register` gated path one card + seal on base; see architecture worked example.

### Phase 5 — Hosts & actions labels

- [ ] Actions emit `p 1sat intent …` (+ input labels) on createAction paths in matrix order
- [ ] `isBaseWallet`: action applies iff true; module handles gated (architecture)
- [ ] yours-wallet: no host changes beyond dependency bump if PromptRequest stays compatible
- [ ] CLI / base wallet: flag true; no double prompt

**Resume check:** end-to-end one dApp op through yours-wallet popup matches mockup.

---

## Implementation order (recommended)

1. Phase 0–1 (types + view model) — unblocks UI  
2. Phase 2 UI for priority intents with **fixture** PromptRequests (no full module yet)  
3. Phase 3 module for same priority set  
4. Phase 4 apply for `opns.register` only  
5. Expand intents + Phase 5 labels  

Canonical first op: **`opns.register`** (architecture).

---

## Out of scope reminders

- Network fee / DSAP spending prompts  
- Identity pubkey hex on card  
- Raw protocolID / keyID as primary UI  
- Purchase pre-fund single-popup  
- Stream inscribe on gated wallet  

---

## Session log

| Date | Done | Next |
|------|------|------|
| 2026-07-25 | Architecture locked; `.pen` mockups | — |
| 2026-07-25 | Phase 0: full `P1SAT_INTENTS`, apply registry, UI titles from `p1satIntent` | — |
| 2026-07-25 | Phase 2 UI: copy controls, trust badges/notes, token featured, indexer fee, no network fee | Module optional fields `trust` / `indexerFeeSats`; yours-wallet spot-check |

---

## Quick resume

1. Read architecture plan + this file’s unchecked boxes  
2. Open `docs/plans/mockups/p1sat-permissions.pen`  
3. Continue from first unchecked phase item  
4. Update session log when stopping mid-phase  
