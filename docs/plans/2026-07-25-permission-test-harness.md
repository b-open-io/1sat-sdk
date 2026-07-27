# Permission test harness (test-app + agent-browser)

**Status:** In progress — notes accumulating toward a skill
**Date:** 2026-07-25
**Purpose:** Exercise the P1Sat permission flow (prompt card + apply dispatch) end to end without the
yours-wallet extension. Architecture: [2026-07-25-p1sat-permissions.md](./2026-07-25-p1sat-permissions.md) ·
wiring: [2026-07-25-p1sat-permission-ui-wiring.md](./2026-07-25-p1sat-permission-ui-wiring.md)

> This file is the raw material for a future skill. Keep it factual and verified — every claim below
> was checked against a running harness, not inferred.

---

## Why the port matters

Browser storage is **origin-scoped**. The embedded wallet's key lives in `localStorage` and its UTXO
state in IndexedDB, both under `http://localhost:5174`. If the dev server drifts to another port,
the wallet — and any funds in it — becomes unreachable.

`.claude/launch.json` pins this with `--strictPort`:

```
sdk-test-app → bun run dev -- --port 5174 --strictPort   (cwd: 1sat-sdk/test-app)
```

**Rule: always 5174, always `--strictPort`.** A fallback port is silent data loss.

---

## Browser choice: agent-browser, not the built-in preview pane

| | Built-in Browser pane | agent-browser `--profile` |
|---|---|---|
| Survives page reload | yes | yes |
| Survives browser/app restart | **no** | **yes** (verified) |
| On-disk backing for the origin | none found anywhere under the Claude app | `browser-profile.local/Default/IndexedDB/http_localhost_5174.indexeddb.leveldb` |
| `navigator.storage.persist()` | denied | denied (irrelevant — profile dir is the durability mechanism) |

Verified 2026-07-25: wrote a probe marker to `localStorage` + IndexedDB in the preview pane; it
survived a reload but was never written to disk (`Partitions/launch-preview-static` untouched, no
`http_localhost_5174` dir). With agent-browser, key `KwL7…bx2Q` came back unchanged after a full
`close` → `open` cycle.

`agent-browser state save/load` covers cookies + localStorage **only** — it does not carry IndexedDB,
which is where the wallet's outputs, baskets and `id:` tags live. Use `--profile`, not `--state`.

### Standard invocation

```bash
cd 1sat-sdk/test-app
agent-browser --profile ./browser-profile.local --session onesat open http://localhost:5174
agent-browser --session onesat wait --load networkidle
```

### Do NOT use `--headed` with `--profile`

`agent-browser` drives your **real Google Chrome binary**. With `--headed` it opens a visible window
under our `--user-data-dir`, and macOS then activates *that* instance whenever Chrome is launched
from the Dock — so the user sees an empty profile picker and their own profiles appear to be gone.
Nothing is deleted (real profiles stay in `~/Library/Application Support/Google/Chrome`), but it is
alarming and it hijacks their browser until that instance is quit.

**Run headless** (the default — just omit `--headed`). No window, no app activation, no takeover, and
the profile still persists. Screenshot when a human needs to see something.

Recovery if it happens: quit every Chrome process using our dir, then reopen Chrome normally.

```bash
pgrep -f "browser-profile.local"          # confirm they are ours before killing
pkill -9 -f "agent-browser-darwin"
rm -f <profile>/SingletonLock <profile>/SingletonCookie <profile>/SingletonSocket
```

**Chrome for Testing does not work here.** Playwright ships one at
`~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/`, which would isolate us from the user's
Chrome entirely — but it is version 145 and the profile was written by Chrome 150, so it dies with
`Network service crashed`. Using it means starting a fresh profile and re-syncing the wallet.

Use an **absolute** profile path when not running from `test-app`, and `close` the session before
changing launch options — the daemon ignores new flags while running, and a killed browser leaves
`SingletonLock` behind, which makes the next launch fail with `CDP response channel closed`.

Gotchas:
- `screenshot <name>.png` resolves relative to the daemon's cwd, not yours — pass an absolute path.
- `find text "Admin originator" click` hits the label, which does **not** toggle the checkbox. Use
  `snapshot -i` to get the ref, then `check @eNN`.

The profile dir is ~78M and matches the existing `*.local` gitignore rule — no gitignore edit needed.
Subsequent commands only need `--session onesat`; the profile is bound at open.

---

## Harness anatomy

`test-app/src/localCwi/LocalCwiHost.tsx` boots a real gated wallet in the page:

```
createWebWallet (StorageIdb, mainnet)     ← base wallet
  └─ createOneSatPermissionModule          ← the module under test
       └─ LocalWalletPermissionsManager    ← WPM, permissionModules: { '1sat': … }
            └─ window.CWI                  ← exposed when "Local CWI" toggle is on
```

Prompts render `OneSatPermissionPrompt` from `@1sat/permission-module-ui` in an in-page modal
(`LocalCwiHost.tsx:259-270`) — the same component yours-wallet hosts.

### Storage keys (origin `http://localhost:5174`)

| Where | Key | Holds |
|---|---|---|
| localStorage | `1sat-test-app-wif` | the wallet key (generated once, reused) |
| localStorage | `1sat-test-app-local-cwi` | Local CWI toggle |
| localStorage | `1sat-test-app-admin-originator` | admin vs dApp originator toggle |
| IndexedDB | `wallet-toolbox-mainnet` | wallet outputs, baskets, tags |
| IndexedDB | `1sat-wallet-permissions:1sat-test-app` | granted permissions |

### Toggles and what they select

| Toggle | Off | On |
|---|---|---|
| **Local CWI** | `window.CWI` removed; actions use the connected extension | embedded gated wallet, no extension needed |
| **Admin originator** | dApp originator (`window.location.origin`) → **prompt shown**, then apply | `test-app-admin` → **no prompt**, apply still runs |

The admin toggle is the direct test for the architecture rule *"admin originator: still apply, no
prompt"*. Both paths set `isBaseWallet: false` (`useActions.ts:32,40`), so apply runs in the **module**,
not the action.

`withOriginator.ts` proxies the wallet to bind a fixed originator as BRC-100's 2nd arg on every call.
Without it, `WalletClient` overwrites the originator and every request looks like the same caller —
which would make the admin-vs-dApp distinction untestable.

---

## Scripting against the wallet

`window.CWI` is the gated WPM instance, so the whole BRC-100 surface is reachable from `eval`. Use
`--stdin` heredocs — shell quoting corrupts anything with nested quotes or arrow functions.

```bash
agent-browser --session onesat eval --stdin <<'EVALEOF'
(async () => {
  const { publicKey } = await window.CWI.getPublicKey({ identityKey: true });
  const outs = await window.CWI.listOutputs({ basket: 'p 1sat ordinals', includeTags: true });
  return JSON.stringify({ publicKey, count: outs.totalOutputs });
})()
EVALEOF
```

Calling `createAction` through `window.CWI` with a `p 1sat intent …` label is the cheapest way to
drive a single intent's card without going through the UI — useful for the intents that have no UI
trigger.

**Caveat:** a prompt blocks on `promptHandler`, which resolves from a React modal. An `eval` that
triggers a prompt will hang until something clicks Approve/Reject, so drive the click in a separate
command rather than awaiting the createAction inline.

---

## Verified environment facts

- test-app deps are all `workspace:*`, and `vite.config.ts` aliases every `@1sat/*` to
  `packages/*/src` — **uncommitted SDK source is what runs**. No build or publish needed.
- No `.env` and no `import.meta.env` references — nothing to configure.
- Embedded wallet storage is **local-only** `StorageIdb`: `createWebWallet` is called with no
  `activeRemote` and no `backups` (`LocalCwiHost.tsx:140-144`). Losing the profile dir loses the
  basket rows and `id:` tags that every id-first intent resolves against — the key alone won't
  restore them.
- Published `@1sat/actions@0.0.192`, `@1sat/permission-module@0.0.43`,
  `@1sat/permission-module-ui@0.0.39` contain **zero** occurrences of `p 1sat intent`. yours-wallet
  pins those published versions, so it cannot exercise this work until a bump + publish.
- Workspace `package.json` versions already equal the published ones — a publish needs a bump first.

## Known harness gaps (found 2026-07-25)

### 0. First run grants a manifest grouped permission (expect several approvals)

On a fresh profile the app's manifest triggers `onGroupedPermissionRequested` for identity-key
retrieval plus the five `p 1sat *` baskets. The manager re-raises the request for whatever subset is
still missing, so expect to approve **more than once** before it settles. After that the grants
persist in IndexedDB `1sat-wallet-permissions:1sat-test-app` and a reload prompts nothing:

```
basket:<origin>:p 1sat bsocial | bsv21 | lock | opns | ordinals
proto:<origin>:false:1,identity key retrieval:
spend:<origin>
```

Wiping that store is how you replay the first-run grant flow.

### 1. Core WPM permission requests hang — no callbacks bound (FIXED 2026-07-25)

`LocalCwiHost` wires only the **1sat module's** `promptHandler`. It never calls
`manager.bindCallback(...)`, so the six core `WalletPermissionsManager` events have no listener.
yours-wallet binds all of them (`background.ts:375-408`); test-app binds none.

`WalletPermissionsManager` defaults every `seek*` flag to **true** and merges user config over the
defaults (`out/src/WalletPermissionsManager.js:104-127`), so passing `{ permissionModules }` does
**not** disable them. Any sought core permission therefore emits to zero listeners and never resolves.

Demonstrated: `getPublicKey({ identityKey: true })` under the dApp originator hangs forever (admin
originator resolves fine). That is what freezes `deriveDepositAddresses`, and with it both
`WalletInfo` ("Loading…" forever) and the Deposit / Owner Sync panel ("Deriving…").

Consequence for testing: a hang is indistinguishable from a deadlock inside the 1sat module, and the
dual-gate flow the architecture specifies for purchases (**1sat card + normal DSAP**) cannot be
exercised at all.

**Fix applied:** `LocalCwiHost` now binds all six events to a queued in-page card
(`localCwi/CorePermissionPrompt.tsx`), granting via `grantPermission` /
`grantGroupedPermission` / `grantCounterpartyPermission` and rejecting via the matching `deny*`.
The blocked callback resolves only **after** the manager records the grant — same ordering as
yours-wallet. Core cards are deliberately plain (JSON detail rows, amber "WPM · core" badge) so
they're visually distinct from 1Sat intent cards.

### 2. `default` basket is admin-only for dApp originators — **by design**

`listOutputs({ basket: 'default' })` under a dApp originator throws
*Basket "default" is admin-only.* — an unconditional guard in `LocalWalletPermissionsManager`, not a
missing grant and not a bug. A dApp is not supposed to read the funding basket.

**Flip the Admin originator toggle to read balance.** Harness panels should surface the failure
rather than route around it with an admin-wrapped wallet — hiding it would misrepresent the
permission boundary under test.

### 3. Several panels still gate on the extension connection

`WalletInfo` and `UtxosList` gate on `useWallet().status === 'connected'`, which is never true in
embedded mode — they render "Connect your Yours Wallet to begin testing" / "Connect wallet first"
even with a working local wallet. Panels that work in embedded mode use `useOneSatContext()`
instead (`OpnsPanel`, `DepositSync`).

## Findings from the first live run (2026-07-25)

Wallet: `02985fd6…7a58`, funded 75,472 sats. dApp originator unless noted.

### A. `ordinal.inscribe-sigma` fails in apply — WPM-encrypted `customInstructions`

**Blocking.** After approving the card, apply throws
`Unexpected token 'p', "prVkL+1pcM"... is not valid JSON`.

Cause: `encryptWalletMetadata` defaults **true**, so `customInstructions` written through the gated
wallet are encrypted at rest. [`resolveCurrentKeyId`](../../packages/actions/src/signing/aip.ts#L55)
does `JSON.parse(output.customInstructions)` on the BAP `type:id` output — but apply runs on the
**base** wallet (correctly, per architecture), which returns the raw ciphertext and cannot decrypt it.

Proven by reading the same output both ways:

| Reader | `customInstructions` |
|---|---|
| gated WPM (`window.CWI`) | `{"protocolID":[1,"sigma"…` — parses |
| base wallet (inside apply) | `prVkL+1pcM…` — throws |

Generalizes beyond sigma: **any apply implementation that reads CI written through the gated wallet
hits this.** The architecture anticipated WPM encryption for *module params*; this is the mirror
image — apply reading wallet-stored CI. Only bites when the identity was published through the gated
wallet; a CLI-published identity stores plaintext CI and apply succeeds.

### B. Sigma and plain inscribe render identical cards

`ordinal.inscribe` and `ordinal.inscribe-sigma` both produce: title "Create inscription", subtitle
"…wants to inscribe content into your wallet", rows **Type** and **Recipient**. The brief calls for
*same as inscribe (+ signed)* on the sigma variant. Nothing indicates the inscription will be signed
with the user's BAP identity — the one thing that actually differs between the two operations.

Also: the brief specifies *type, size (from script)*; **size is absent**, and the type row comes from
dApp-supplied output tags rather than the parsed inscription envelope.

### C. Preconditions are checked after approval, not before

The first sigma attempt (no identity yet) showed a normal "Create inscription" card, and only after
Approve failed with *"No BAP identity published."* The user approves, waits, then gets an error.

### D. Non-intent createActions show an opaque generic card

Both the deposit sweep (`Inputs / Outputs 0 / 0`) and `publishIdentity` (`0 / 1`) rendered the
unknown-intent fallback: title "Transaction Request", subtitle "wants to approve transaction". These
are real spends — identity publication especially — presented with no meaningful facts.

### E. Prompt sequences observed

| Operation | Cards, in order |
|---|---|
| first load (fresh profile) | grouped manifest permission, re-raised for the missing subset until satisfied |
| `syncAddresses` | basket `1sat-deposit` insertion ("Received 75472 sats") → generic Transaction Request (sweep) |
| `inscribe` plain | **one** card: Create inscription ✓ |
| `publishIdentity` | basket `bap` listing → protocol `[1,'sigma']` publicKey → generic Transaction Request |
| `inscribe` sigma | one card: Create inscription → apply throws (finding A) |

Plain inscribe producing exactly one card is the design goal met.

## Flow results (2026-07-26 overnight run)

Wallet `02985fd6…7a58`, dApp originator, embedded gated wallet. Every row below was driven
through the UI and the resulting tags read back from the wallet.

| Flow | Intent | Cards | Result |
|------|--------|-------|--------|
| `syncAddresses` | — | basket `1sat-deposit` insertion → generic Transaction Request (sweep) | processed 1 |
| `inscribe` plain | `ordinal.inscribe` | **1** — Create inscription (Type, Recipient) | ✅ |
| `inscribe` sigma | `ordinal.inscribe-sigma` | **1** — identical card to plain | ✅ after fixes below |
| `publishIdentity` | — (no intent) | `bap` listing → protocol `[1,'sigma']` → generic Transaction Request | ✅ |
| `registerOpns` | `opns.register` | **1** — "Publish name", Name + Origin | ✅ PushDrop sealed by apply |
| `deregisterOpns` | `opns.deregister` | **1** — "Unpublish name" | ✅ |
| `sellOrdinal` | `ordinal.list` | **1** — "List for sale", Price + Origin + Type | ✅ |
| `cancelOrdinalListing` | `ordinal.cancel-listing` | **1** — "Cancel listing", Original price | ✅ |
| `sendOrdinals` | `ordinal.transfer` | **1** — "Send ordinal", Recipient from script | ✅ |
| `lockBsv` | `lock.lock` | **1** — "Lock BSV", Amount + until block | ✅ |
| `unlockBsv` | `lock.unlock` | basket `p 1sat lock` | `no-matured-locks` (tip 959478 < 959600) — correct |
| `sendBsv` | — | **none** | ✅ — inside the manifest's 100k spend grant |
| `signBsm` | — | core protocol `[1,'message signing']` | ✅ |

Every P1Sat intent produced **exactly one** card. That is the central design goal met.

### Tag correctness (read back from the wallet, not asserted)

- `registerOpns` → carried `origin:`/`type:`/`name:`, added `opns` + `opns:published`, fresh `id:`
- `sellOrdinal` → bare genesis `origin` correctly **promoted** to `origin:<genesis outpoint>`, added
  `ordlock` + `price:7500`, fresh `id:`, `sha256:` correctly dropped on the move
- `cancelOrdinalListing` → `ordlock`/`price:` dropped, `origin:` held, fresh `id:`
- A bare `origin` tag on a fresh inscription is **intentional** — the genesis output can't know its
  own outpoint, so `ordinalSeedTags` promotes it on first move. Not a defect.

### Not reachable in this harness

`ordinal.burn`, `ordinal.mint-collection`, `ordinal.mint-item`, all four `bsv21.*`, `opns.list` /
`opns.transfer` / `opns.cancel-listing` / `opns.purchase`, and both purchase intents have **no UI
trigger**. `ordinal.purchase` / `opns.purchase` additionally need an external listing. Driving them
means adding buttons or using `window.CWI` scripting.

### Harness note: the manifest pre-grants spending

The test-app manifest requests `Spend up to 100,000 satoshis for testing` with `expiry: 0`. It is
granted during the first-run grouped prompt, so payment flows do **not** prompt until it is
exhausted. To exercise DSAP prompts, clear `spend:<origin>` from the permissions store or exceed the
cap.

## Fixes applied

1. **`resolveCurrentKeyId` no longer reads customInstructions** ([signing/aip.ts](../../packages/actions/src/signing/aip.ts)).
   The `seq:N` record declares `<BAP_KEY_ID>-N`, and `seq:` is already on the tags, so the keyID is
   computed rather than parsed out of the (WPM-encrypted) CI. Removes the whole decrypt question
   from this path.
2. **Anchor keyID derived from the action id** ([apply/inscribeSigma.ts](../../packages/actions/src/apply/inscribeSigma.ts)).
   Was `anchor-${Date.now()}`, passed from apply back to the action through a label — which cannot
   work, because `WalletPermissionsManager` rebuilds `labels` into a new array before the module
   sees the args. Now `sigmaAnchorKeyId(actionId)`, derived independently on both sides.
   `SIGMA_ANCHOR_KEY_LABEL_PREFIX` / `readSigmaAnchorKeyId` deleted.
3. **Action id stamped before apply** ([apply/prepare.ts](../../packages/actions/src/apply/prepare.ts)).
   `ensureActionId` reads-or-mints from a `p 1sat action-id <id>` label. Needed because apply runs
   *ahead of* `createTrackedAction` on a base wallet, so the id has to exist earlier than it used to.

4. **Listing price comes from the OrdLock script, not the `price:` tag.**
   The card previously rendered `tagValue(listingOutput.tags, 'price')` — what the dApp
   *claimed*, not what the chain enforces. A dApp could tag `price:5000` while writing a
   script that sells for 50.
   - `enrichIntent.decodeOutput` now runs `OrdLock.decode()` and carries
     `listingPriceSats` / `listingSeller` on the enriched output, through `handlers.ts` to the UI.
   - `OneSatPermissionPrompt` reads `listingPriceSats` only; the tag is no longer a source.
   - `sellOrdinal` and `sellOpns` now derive their `price:` tag by decoding the script they
     just built, so the tag cannot drift from the script.
   - `@1sat/templates` added as a `permission-module` dependency for `OrdLock`.

   **Cancel-listing is deliberately left on the tag.** Its price comes from the *input*, which
   the module re-looks up from wallet storage — not from the dApp. Reading the script there
   would require fetching the source tx.

   Verified by tamper test: with a shim rewriting the outgoing tag to `price:1`, the card still
   displayed **12,345 sats**. Re-run cleanly afterwards — action wrote `price:12345`,
   txid `0889ddce…8165`.

5. **Lock height comes from the Lock script, not the `until:` tag** — same treatment as the
   price. `enrichIntent` carries `lockUntilHeight` from `Lock.decode()`, the card reads that,
   and `lockBsv` derives its `until:` tag by decoding the script it built. The card also now
   selects lock outputs by "script decodes as a Lock" rather than by basket, since the basket
   is caller-asserted too.

6. **Apply stamps caller-asserted tags from the script before they reach storage**
   ([apply/stampScriptTags.ts](../../packages/actions/src/apply/stampScriptTags.ts)).
   Correcting only the card was not enough: `args.outputs[].tags` were still passing through
   untouched, so a lying `price:` landed in wallet storage on approve — and the cancel card
   reads that stored tag, so the lie would resurface later as "Original price".

   `stampScriptDerivedTags` walks the outputs, decodes each locking script, and rewrites
   `price:` (OrdLock) and `until:` (Lock) to match. It runs once at the end of
   `applyP1SatIntent`, **after** the intent-specific apply, so seals like PushDrop and sigma are
   already in place and the tags reflect the script that actually gets committed. It is driven
   by what each script decodes as, not by the declared intent, so it can't drift as intents are
   added.

   Verified: with the tag tampered to `price:1`, a listing at 31,337 sats showed **31,337** on
   the card and stored **`price:31337`**.

### Tamper testing

The harness can impersonate a malicious dApp by wrapping `window.CWI.createAction` and mutating
args after the action builds them but before the manager sees them:

```js
const orig = window.CWI.createAction.bind(window.CWI)
window.CWI.createAction = (args, originator) => {
  for (const o of args.outputs || []) {
    if (o.tags) o.tags = o.tags.map(t => t.startsWith('price:') ? 'price:1' : t)
  }
  return orig(args, originator)
}
```

This is the only way to tell a *trustworthy* card from one that merely agrees with the dApp —
in normal operation our own action writes both the tag and the script, so they always match.
Reload to clear the shim.

### Which args mutations survive the manager

`finalArgs = { ...args, options, labels: [...] }` — a shallow copy. `inputs` and `outputs` cross as
the **same array references**, so in-place writes are visible to both sides. `labels` is rebuilt, so
apply→action writes there are lost. This is why `id:` tags work and the anchor label never could.

## Deterministic derivations — remaining work

`resolveDestination` now takes an optional `actionId` and falls back to `Date.now()`. The inscribe
path mints its id up front and passes it; **verified** on both plain and sigma.

Five sites still derive keyIDs from wall-clock. Each needs the same one-line treatment — mint
`randomActionId()` at the top of the action, pass it into the derivation, and stamp
`buildActionIdLabel(actionId)` on the args:

| Site | Current |
|------|---------|
| [tokens/index.ts:549](../../packages/actions/src/tokens/index.ts#L549) | `${tokenId}-${Date.now()}` |
| [tokens/index.ts:565](../../packages/actions/src/tokens/index.ts#L565) | change keyID |
| [sweep/index.ts:723](../../packages/actions/src/sweep/index.ts#L723) | `${tokenId}-${Date.now()}` |
| [collections/index.ts:267](../../packages/actions/src/collections/index.ts#L267) | `Date.now().toString()` |
| [collections/index.ts:445](../../packages/actions/src/collections/index.ts#L445) | `Date.now().toString()` |

**Deliberately not changed overnight.** None of these paths has a UI trigger and the wallet holds no
BSV21, so the edits could not be verified. They are consistency improvements, not bug fixes — unlike
the sigma anchor, all five store their keyID in the output's `customInstructions`, so they are
already recoverable from the wallet record.

## Open decisions

- Whether to do the five remaining derivations, and how to test them (add UI, or script `window.CWI`).
- Sigma and plain inscribe render identical cards; the brief calls for *(+ signed)* on sigma.
- Inscription `size` is missing from the card, and `Type` comes from dApp tags rather than the parsed
  envelope. Same question for listing `price:` and lock `until:`.
- Non-intent createActions (deposit sweep, `publishIdentity`) render the generic "Transaction
  Request" card with no facts.
- Failed sigma attempts leave orphaned 2-sat anchors in `p 1sat sigma` — 3 accumulated tonight.
  Apply creates the anchor before it can fail, and nothing cleans up.

## Open items for the skill

- Funding: how to fund minimally and how to recover the key if the profile is lost.
- Remote backup (`activeRemote` / `backups`) so basket rows survive profile loss — undecided.
- Seeding the WIF from outside the browser so the identity is reproducible in a fresh profile.
- Which intents have no UI trigger and must be driven via `window.CWI` scripting.
