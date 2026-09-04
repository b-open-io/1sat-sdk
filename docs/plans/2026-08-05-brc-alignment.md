# Plan: BRC / wallet alignment (1sat-sdk)

Status: **In progress**  
Date: 2026-08-08 (checkpoint before context compact)  
Branch: `feat/brc-alignment-sdk` (rebased on master; large **uncommitted** WIP)  
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
| Legacy `p 1sat …` baskets | **No dual-read** — migrate once via `migrateLegacyP1SatBaskets`, then forget |
| Module dispatch | Labels only need be sufficient for createAction |
| Action label | bare `p 1sat action` (dispatch only). Action correlator is `id:<actionId>_<i>` tags, minted in ensureActionId/prepare |
| Input label | `p 1sat input <basket> <id>` — **id last** (no spaces in id); basket may contain spaces |
| `id:` tag | SHOULD on managed rows; wallet-unique; **case-insensitive**; generation wallet-defined (SDK may keep `actionId_vout`) |
| Protocol default | Drop `p` prefix on defaults (e.g. `[0,'1sat']`); **caller may override**; CI records what was used |
| Bound createSignature via module | Only when protocol name routes to module (`p …`) or routing is extended; not assumed for plain defaults |
| Intent labels | **Retire** — no `p 1sat intent …` |
| Classification (prompts) | **One parse in module** → serializable `TransactionPrompt` (`panels[]` + rows + fees). UI only renders. No intent taxonomy. |
| Prompt wire field | `PromptRequest.payload` (not `intent`) |
| Ordinal 1-sats | Edge panel only — no separate BSV line for dust |
| BSV value | Lock / unlock / pay panels only for real BSV movement |
| Overlay fee | `1Sat Overlay Fee` row; never a Pay panel (`fee:overlay`) |
| BSV21 | Script-decode amt (never sats); overlay `dec`/`sym`/`icon`; CI for case-preserving `sym` (tags lowercased by BRC-100); Send/Move/Burn |
| BSV21 burn UX | `inputs > outputs` → Burn remainder + note; `outputs > inputs` → **Burn only** (all inputs) + note; no trust badge (avoids duplicate); no overlay verify on bad math |
| Burn panel chrome | `tone: 'danger'` — subtle red border/title |
| Trust badge | Purchases + token-transfer (good math only): seed unverified; overlay = token active + `validateOutputs({ unspent: true })`; sym compare case-insensitive |
| Pre-fund / network fee | **Deferred** — default-basket change is wallet-managed (cannot stuff as `args.inputs`); estimate later |
| Sym display | Prefer overlay → CI → tags; verify upgrades subtitle ticker case from overlay |
| Placeholder seal (output scripts) | **SDK apply only** (Sigma / signed PushDrop) |
| `name:` tags | Stop writing; display name in CI when known |
| `type:` | Full MIME only; strip `;…`; origin inscription; copy on self-keep |
| Origin tag | bare `origin` vs `origin:<outpoint>`; self-keep promote/copy; normalize form (dot vs underscore — open with Brandon / 305) |
| Unresolvable origin | **Stall** — do not file without origin |
| `template:` tag | **Not required**. Classify from scripts (prompt + sign). OpNS CI `template: 'pushdrop'` is a legacy shortcut; converge on script recognition |
| Module P-basket / P-protocol gates | Compat shim for old inventory/keys; not preferred for new filing |
| Protocol grant UI in module | May be thin/missing today (`getPublicKey` pass-through); add if needed for compat — trivial |
| Detect module | `hasOneSatModule(wallet)` — `getPublicKey` + `P1SAT_MODULE_PROTOCOL`; WPM throws if scheme missing |
| **`useOneSatModule`** | **Per-call only** (ActionOptions). Default **false**. Caller owns detect state — **not** on context. Not for identity/social/cosign. |
| CI `template` | **Drop** — never trust for unlock/seal. Script shape only. (Optional later: tag stamped from script on output side.) |

### Shared createAction pipeline (locked — update before compact 2026-08-11)

#### Trust / data model (non-negotiable)

- **Never trust** CI/keys/scripts from the dApp boundary as authority.
- **Output records** are the unit of work for finalize:
  - From **wallet DB load** (basket + id), or
  - From **wallet create** (e.g. Sigma anchor we just defined/created).
- Those records (outpoint + CI + whatever else sign needs) are passed into the **same** finalize/sign step.
- OK to load once in the right scope and pass along — **no requirement to re-list** if we already have a wallet-scoped record.
- **No lock-key defaults** or other template-specific key hacks when CI is missing — fail loud.

#### Spend identification

| Kind | How identified | Where script/CI come from |
|------|----------------|---------------------------|
| Wallet-held inventory | **basket + id only** | Load from storage (`listOutputs` by basket + `id:` tag) |
| External buy | **outpoint** | Script from **passed-in BEEF** only; no DB; no CI (OrdLock purchase unlock) |
| Sigma anchor | Created in embellish | Record we just created (CI we wrote) — **not** dApp, **not** outpoint-DB scan |

There is **no** “lookup wallet row by outpoint” API for inventory. Outpoint on `args.inputs` is wire only.

#### End-to-end flow (identical logic both scopes)

```
1. Action.execute(ctx, input)
   - Validate caller params
   - Resolve spends domain-specifically (load basket+id OR take buy outpoint+BEEF)
   - Build preliminary CreateActionArgs (inputs/outputs/BEEF/…)
   - Build spend list pointers: basket+id and/or buy outpoints
   - Call executeTrackedAction(wallet, args, funding?, beef?, opts)

2. executeTrackedAction router
   - fundingProvider? → seals → fund → internalize (side door; no module)
   - useOneSatModule? → add p 1sat labels → wallet.createAction (WPM → module)
   - else → local pipeline on ctx.wallet

3. PIPELINE (module after approve on base wallet, or local immediately)
   a. Embellish
      - OpNS PushDrop seal into output scripts
      - Sigma: create anchor FIRST (get outpoint+CI), seal inscription, push input
      - stamp id: / script-derived tags
   b. Collect output records for finalize
      - For each basket+id: load from storage → record (or use record action already loaded in wallet scope)
      - For Sigma anchor: use record just created (in-memory / just written)
      - For buy outpoint: no CI; script from BEEF at sign time
   c. createAction (signAndProcess: false)
   d. Unlock each record (script shape + CI from record) + signAction
   e. Return finished tx
```

Module vs local: **same pipeline steps**. Difference is only:
- Module inserts **prompt/approve** and runs on **base wallet**
- Module sees spends as **labels** (`p 1sat input <basket> <id>`) and must **load records itself** in wallet space
- Local may pass already-loaded wallet-scoped records into the same finalize params (avoid double-load)

#### Explicit non-goals / anti-patterns (do not reintroduce)

- Auto-adding **all** `args.inputs` as spend targets (duplicates inventory spends; was a bug)
- `findKeyCiForOutpoint` scanning baskets (not a real DB API)
- Lock (or any template) **default keys** when CI missing
- Passing CI across the dApp→module boundary as authority (labels are pointers only)
- Re-list after createAction for spendable rows (inputs already consumed)

#### Current code status (honest — 2026-08-11)

| Piece | Status |
|-------|--------|
| Plain baskets, migrate util (per-tx AtomicBEEF), test-app migrate UI (4 baskets) | Landed |
| `useOneSatModule` per-call; module prompt IR; lockBsv module path proven once | Landed |
| Pipeline: embellish → collect `ResolvedSpend[]` → createAction → finish | Landed |
| Lock defaults hack | **Removed** (must stay gone) |
| unlockBsv basket+id + local `preloadedSpends` | Landed — **retest** module on |
| Sigma anchor as in-memory `__pendingResolvedSpends` into finalize | Landed |
| Legacy sign callbacks (sweep, P2MS) | Still special |
| Protocol name | `ONESAT_PROTOCOL = [0,'onesat']` (≥5 chars); module probe `[0,'p 1sat']` |
| BSV21 auth | Same basket `bsv21` + tag `bsv21:auth`; no separate auth basket |
| Dropped | `bsv21-deploy-funding` basket |

#### Implement next — verify

Output-record finalize path is in code. **Retest:**

1. unlock lock (module on) — 1000 sats still locked if prior unlock failed  
2. send ordinal / opns  
3. **never approve burns** in harness

## Work items

### A — Baskets (constants + filing)

1. ~~**Constants** — plain preferred names; no dual-read~~  
2. ~~**Filing** — paths already use constants (values now plain)~~  
3. ~~**Names** — `1sat`, `bsv21` (+ tag `bsv21:auth`), `opns`, `hosting`, `lock`, `sigma`, `bsocial` (+ `bap`, `1sat-deposit`); no separate auth/deploy-funding baskets~~  
3a. ~~**Migrate** — `moveBasketOutputs` / `migrateLegacyP1SatBaskets`; CLI `wallet move-basket` / `migrate-baskets`~~  
3b. ~~Module gate — `isOneSatAssetBasket` (not `p ` prefix)~~

### B — Labels + tracked action

4. ~~Dispatch label bare `p 1sat action`; action id on `id:` tags via `ensureActionId`~~  
5. ~~`p 1sat input <basket> <id>` — full basket, id last~~  
6. ~~Inscribe destination keyID independent of action id (`inscribe-<random>`)~~  
7. ~~Drop intent dispatch — apply seals by script shape; prompts classify by heuristics~~  


### C — Protocol defaults

8. ~~Default protocol = {@link ONESAT_PROTOCOL} `[0,'onesat']` (≥5 chars); module probe = {@link P1SAT_MODULE_PROTOCOL} `[0,'p 1sat']`~~  
9. ~~Sign from CI (unchanged — spend paths parse CI protocolID)~~  
10. ~~Module createSignature stays on P-protocol route when labels/module present; legacy CI `p 1sat` still spends~~

### D — Permission module

11. ~~createAction: labels → enrich → `TransactionPrompt` panels → prompt~~  
12. Basket gates via `isOneSatAssetBasket` (plain names).  
13. ~~createSignature commitment cache (legacy path; prefer pipeline finish)~~  
15. ~~Placeholder seal by script shape (OpNS PushDrop / Sigma) — exists; must join shared pipeline~~  
15a–f. ~~Prompt IR / panels / burn UX~~  
15d. Pre-fund / show network fee (deferred)  

### H — Shared pipeline

27. ~~Rename → `useOneSatModule` (per-call); no context default~~  
28. ~~Unlock by script shape (`unlockByScript` / `buildSpendsForTargets`); drop CI `template` read path~~  
29. ~~`runCreateActionPipeline` / `embellishCreateActionArgs` / `finishCreateAction`~~  
30. ~~`SpendTarget` basket|outpoint; `spendTargetsFromLabels`; module parses labels~~  
31. ~~Module onRequest embellish + onResponse finish → finished tx~~  
32. ~~Local `executeTrackedAction` → pipeline (legacy sign callback still works)~~  
33. ~~Thread spendTargets through ordinals/opns/tokens/locks/inscriptions/collections~~  
34. ~~Funder: seals before `fund`~~  
35. ~~Migrate main actions to spendTargets~~ — remaining special callbacks: **sweep** (imported keys), **mintBsv21 P2MS auth**  
36. ~~Pipeline: resolve CI before createAction; only embellish-added inputs (Sigma) auto-join spends~~



### E — Tags / CI

16. ~~Origin underscore form (`formatOriginOutpoint`); bare→promote on self-keep~~  
17. ~~Drop `name:` on 1sat/inscriptions; CI `name` when known (OpNS keeps `name:` for domain list filter)~~  
18. ~~`type:` single full MIME, strip `;…`~~  
19. ~~`id:` via `stampManagedOutputIds`~~  
20. Do not require `template:` tags; sign/classify via script (retire CI `template` when convenient).  
16b. Stall-if-unresolved on file paths still soft (no origin tag rather than false origin) — harden where we still file without origin.

### F — Collections / indexer

21. ~~Collection/item mint: real Sigma seal via `mintWithSigma` (placeholder + apply)~~  
22. ~~In-envelope MAP: indexer accepts `MAP_PREFIX` and legacy `"MAP"`~~  
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

1. ~~Labels (B) + module classify / TransactionPrompt IR (D)~~ **landed (uncommitted)**  
2. Basket constants + filing (A) — collectables `1sat` first; other baskets when touched  
3. Protocol defaults (C)  
4. Tags/CI (E)  
5. Collections Sigma + MAP (F)  
6. Docs/tests (G)  
7. Pre-fund / network fee (15d) when toolbox path is clear  

## Session checkpoint (2026-08-08) — for compact resume

### Pipeline (locked)

```
createAction onRequest (dApp)
  → enrichIntent (wallet lookup + script decode)
  → resolveTokenMeta (overlay dec/sym/icon)
  → buildTransactionPrompt (panels; burn conservation)
  → PromptRequest { kind, originator, payload: TransactionPrompt, summary }
  → UI renders payload only; verifyIntent if payload.trust + payload.verify
  → applyCreateAction (seals)
```

Admin originator: no prompt, apply only.

### Exercised in test-app (port 5174, profile `browser-profile.local`)

| Flow | Result |
|------|--------|
| Lock BSV | Lock panel, full sats, Until height |
| Inscribe + Sigma | Inscribe + Sign BAP identity (Sigma) |
| OpNS publish/unpublish | Publish / Unpublish (not Move) |
| BSV21 send | Send amt+sym, overlay fee row, Verified |
| Burn remainder | Move + Burn (`inputs > outputs`), Verified |
| Bad math | Burn only (`outputs > inputs`), no badge |

### Uncommitted file set (high level)

- **New:** `permission-module/src/promptModel.ts`, `buildPromptIntent.ts`; `test-app/.../BurnPromptTest.tsx`  
- **Module/UI:** enrich, handlers, verify, types, index, apply.test; OneSatPermissionPrompt rewrite; styles  
- **Plans:** this file + STATUS.md  
- **Tooling (master rebase):** wallet/wallet-browser/client deep-import fix for `@bopen-io/wallet-toolbox-client` (root exports only); test-app dep aligned  

### Do not lose

- CI preserves case for `sym`/`name`; tags are lowercased — always prefer CI/overlay for display  
- Ordinal dust ≠ BSV pay line  
- `fee:overlay` ≠ Pay panel  
- Bad math: no verify, no mismatch badge — Burn panel is the signal  
- BurnPromptTest: dynamic UTXO pick, reject-only; keep in test-app  
- Pre-fund: cannot put default-basket change UTXOs in `args.inputs` (toolbox rejects managed change)  

### Next after compact

1. **Commit** WIP on `feat/brc-alignment-sdk` (user approved leaving BurnPromptTest)  
2. Continue plan **A** (baskets) or **C** (protocol defaults) or **E** (tags/CI)  
3. Optional: unit tests for burn conservation + BSV21 decode in permission-module  

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
  - `promptModel.ts` — `TransactionPrompt`, `PromptPanel`, `PromptFunding`  
  - `buildPromptIntent.ts` — panels (ordinal / token / value / burn)  
  - `enrichIntent.ts` — script decode (OrdLock, Lock, BSV21, Sigma, PushDrop)  
  - `verifyIntent.ts` — purchase + BSV21 overlay validation  
- `packages/permission-module-ui/` — render-only `OneSatPermissionPrompt`  
- `packages/actions/` ordinals, inscriptions, opns, tokens, collections, apply  
- `packages/wallet/src/indexers/` — Origin, Inscription (MAP), etc.  
- `test-app/` — Local CWI harness; `BurnPromptTest` for burn UX  

## References

- [BRC-147 PR #206](https://github.com/bsv-blockchain/BRCs/pull/206)  
- [opldotdev/BRCs](https://github.com/opldotdev/BRCs)  
- Brandon: storage `1sat`, permissions optional/rich via scheme — not P-basket inventory law  
