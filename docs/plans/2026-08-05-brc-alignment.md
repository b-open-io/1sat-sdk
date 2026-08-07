# Plan: BRC / wallet alignment (1sat-sdk)

Status: **Draft**  
Date: 2026-08-07  
Scope: SDK changes driven by 147 interop + optional P1Sat permission module. Chain specs live under OPL numbering (306–310, etc.); inventory law for collectables is **BRC-147**.

## North star

| Layer | Law |
|-------|-----|
| Collectable **inventory** | Basket `1sat` ([BRC-147](https://github.com/bsv-blockchain/BRCs/pull/206) + live 147). Not a P-basket requirement. |
| **Permission module** (optional, 1sat-sdk) | Rich createAction review via `p 1sat …` **labels**. Not required for holding/transferring 1Sat assets. |
| **Chain** | OPL / upstream 306–310 (origin, envelopes, collections, BSV-21), 304 Sigma, 150/156 provenance. |

Do **not** treat P-spelled storage baskets or forced protocol `p 1sat` as requirements for 1Sat assets. Keep legacy P-basket / `p 1sat` protocol paths as **compat** only.

P1Sat-as-BRC (old 302/303 / draft 313/314) is **not** blocking SDK work; module behavior is product/SDK contract. 147 tag cleanup is the interop surface ([bsv-blockchain/BRCs#206](https://github.com/bsv-blockchain/BRCs/pull/206)).

## Locked decisions

| Topic | Decision |
|-------|----------|
| Collectable basket (new filing) | `1sat` |
| Other asset baskets (bsv21, opns, lock, …) | Prefer plain names; **exact strings decide at implement** — must solve, not pre-fixed here |
| Legacy `p 1sat …` baskets | Read/spend/list compat; dual-read; optional migrate later |
| Module dispatch | Labels only need be sufficient for createAction |
| Action label | bare `p 1sat action` (dispatch only). Action correlator is `id:<actionId>_<i>` tags, minted in ensureActionId/prepare |
| Input label | `p 1sat input <basket> <id>` — **id last** (no spaces in id); basket may contain spaces |
| `id:` tag | SHOULD on managed rows; wallet-unique; **case-insensitive**; generation wallet-defined (SDK may keep `actionId_vout`) |
| Protocol default | Drop `p` prefix on defaults (e.g. `[0,'1sat']`); **caller may override**; CI records what was used |
| Bound createSignature via module | Only when protocol name routes to module (`p …`) or routing is extended; not assumed for plain defaults |
| Intent labels | **Retire** — no `p 1sat intent …` |
| Classification (prompts) | Output locking scripts + spent-input templates; not caller verbs |
| Placeholder seal (output scripts) | **SDK apply only** (Sigma / signed PushDrop) |
| `name:` tags | Stop writing; display name in CI when known |
| `type:` | Full MIME only; strip `;…`; origin inscription; copy on self-keep |
| Origin tag | bare `origin` vs `origin:<outpoint>`; self-keep promote/copy; normalize form (dot vs underscore — open with Brandon / 305) |
| Unresolvable origin | **Stall** — do not file without origin |
| `template:` tag | **Not required**. Classify from scripts (prompt + sign). OpNS CI `template: 'pushdrop'` is a legacy shortcut; converge on script recognition |
| Module P-basket / P-protocol gates | Compat shim for old inventory/keys; not preferred for new filing |
| Protocol grant UI in module | May be thin/missing today (`getPublicKey` pass-through); add if needed for compat — trivial |

## Work items

### A — Baskets (constants + filing)

One decision, two code layers (usually one PR):

1. **Constants** — preferred basket strings in `@1sat/types`; keep old `p 1sat …` as aliases for reads.  
2. **Filing paths** — create / internalize / self-keep write preferred baskets.  
3. **bsv21 / opns / lock / …** — pick plain names at implement time; document in constants when chosen.

### B — Labels + tracked action

4. ~~Dispatch label bare `p 1sat action`; action id on `id:` tags via `ensureActionId`~~  
5. ~~`p 1sat input <basket> <id>` — full basket, id last~~  
6. ~~Inscribe destination keyID independent of action id (`inscribe-<random>`)~~  
7. Drop intent label builders, registry, and apply dispatch-by-intent (still pending).  


### C — Protocol defaults

8. Default protocolID without `p ` prefix; allow override on actions that take protocol.  
9. Sign from CI (whatever was recorded).  
10. Document bound-sign caveat; keep module createSignature path for `p 1sat` and legacy rows.

### D — Permission module

11. createAction: labels → enrich → classify from scripts/spent templates → prompt.  
12. Keep list/internalize basket gates for `p 1sat …` baskets (compat).  
13. createSignature: commitment bind when routed; fallback prompt.  
14. Optional: protocol grant handling if plain defaults leave gaps for legacy `p 1sat` keys.  
15. Placeholder seal remains in apply path (SDK), not a BRC requirement.

### E — Tags / CI

16. Origin normalize + stall if unresolved.  
17. Drop `name:` tag writes; CI `name` when known.  
18. `type:` single full MIME, strip parameters; stop category `type:` if still emitted.  
19. `id:` on managed rows (case-insensitive).  
20. Do not require `template:` tags; sign/classify via script (retire reliance on CI `template` when convenient).

### F — Collections / indexer

21. Collection/item mint apply: real Sigma seal (fix validate-only).  
22. In-envelope MAP: field tag = MAP protocol id, value = script blob; fix indexer `"MAP"` key.  
23. Stack membership parity — note/issue for 1sat-stack (separate track).

### G — Polish

24. Skills / CLI / docs → 147 + module labels + OPL chain numbers.  
25. Tests: label dispatch without P-basket; legacy P-basket read/spend; classification; seal; origin stall.  
26. Optional: BRC-150 package build/verify (size vs CI limits — prefer omit / 156 for deep history).

## Spec / process (non-SDK)

| Item | Status |
|------|--------|
| 147 tag/CI proposal | Draft PR [bsv-blockchain/BRCs#206](https://github.com/bsv-blockchain/BRCs/pull/206) |
| Open with Brandon | Field duplication tags vs CI; origin underscore vs dot; provenance size in CI |
| Old b-open-io / #200 dual-basket framing | Abandoned direction |
| OPL corpus 300–312 | Luke’s batch; 1Sat chain docs without wallet P-basket law |

## Suggested implement order

1. Labels (B) + module classify without intents (D.11, D.15)  
2. Basket constants + filing (A) — collectables `1sat` first; other baskets when touched  
3. Protocol defaults (C)  
4. Tags/CI (E)  
5. Collections Sigma + MAP (F)  
6. Docs/tests (G)

## Non-goals

- Forcing foreign wallets onto the permission module  
- Dual-storage as long-term law  
- Standardizing OpNS / BSV21 basket profiles in this plan  
- Treating placeholder seal or intent enums as BRC requirements  

## Key code touchpoints

- `packages/types/src/constants.ts` — baskets, protocol, label builders  
- `packages/actions/src/utils/createTrackedAction.ts` — labels + id tags  
- `packages/actions/src/utils/signOrdinalInput.ts` — CI template shortcut vs script  
- `packages/permission-module/` — handlers, enrich, apply  
- `packages/actions/` ordinals, inscriptions, opns, collections, apply  
- `packages/wallet/src/indexers/` — Origin, Inscription (MAP), etc.  

## References

- [BRC-147 PR #206](https://github.com/bsv-blockchain/BRCs/pull/206)  
- [opldotdev/BRCs](https://github.com/opldotdev/BRCs)  
- Brandon: storage `1sat`, permissions optional/rich via scheme — not P-basket inventory law  
