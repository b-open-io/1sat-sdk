# Permission module verification (services + live trust)

**Status:** Plan — not started
**Date:** 2026-07-26
**Architecture:** [2026-07-25-p1sat-permissions.md](./2026-07-25-p1sat-permissions.md)
**Found during:** [permission test harness](./2026-07-25-permission-test-harness.md)

---

## Problem

Three findings, one root cause.

1. **The trust badge is dApp-forgeable.** `extractTrust` reads a `trust:` tag from inputs *or*
   outputs. Outputs are dApp-authored, so `trust:verified` renders a green Verified pill with no
   verification behind it. It is the one element whose entire purpose is to assert that the wallet
   checked something.

2. **Nothing is ever verified.** There are no network calls anywhere in `@1sat/permission-module`.
   The OpNS name↔origin check and the BSV21 active check described in the architecture were never
   wired.

3. **They couldn't have been.** `createOneSatPermissionModule` accepts only `wallet`,
   `promptHandler`, `adminOriginator`, `permissionStore`. There is no services handle, so the module
   has no way to reach ORDFS or an overlay. `contentHost` is a URL string for building image links,
   not a client.

Consequence today: on a purchase — the one case where the wallet owns nothing to re-look-up — every
fact on the card comes from the dApp, including the badge that claims otherwise.

## Principle: trust is computed, never stored

Trust is a property of a check performed **at prompt time**, not a property of the asset.

At broadcast time the overlay usually has not indexed the transaction yet, so a truthful `trust:`
tag could not be written even in principle. Any `trust:` tag in storage is therefore either
meaningless or a lie, and must not influence the card.

**Therefore:**
- `extractTrust` stops reading tags entirely and derives state from the live lookup result.
- `stampListingMetaTags` stops *writing* `trust:` onto purchase outputs.
- Nothing persisted can affect the badge.

| State | Meaning |
|---|---|
| `verified` | service answered **for this origin** and agreed with the committed value |
| `mismatch` | service answered for this origin and returned something different |
| `unverified` | no service configured, no response, timed out, **or no record found** |

`unverified` is the safe default and must never read as an endorsement in the UI.

**Not-found is `unverified`, never `mismatch`.** We cannot distinguish "this is wrong" from "the
overlay has not indexed it yet" — a backlog is normal and expected. Only a positive answer that
contradicts the committed value is evidence of anything; absence is evidence of nothing.

### Resolve asynchronously

The card renders immediately with `unverified` and the badge upgrades when the answer arrives.
Nothing blocks on the network: a slow or dead overlay delays the badge, never the prompt.

This also follows from the state model — since absence produces the same state the card already
starts in, there is nothing to wait for.

## Design

### Optional services

Add an optional `services` (or a narrow `ordfs`/`opns`/`bsv21` subset) to
`CreateOneSatPermissionModuleArgs`. Absent, behaviour is byte-identical to today — every card
renders exactly as it does now, with trust `unverified`.

Follow the probe/try-catch shape `resolveListingMeta` already uses: duck-type the method, wrap the
call, return `undefined` on any failure, let the caller carry on. **No verification path may throw,
and none may block the prompt indefinitely** — a wallet with an unreachable overlay must still be
able to approve transactions.

Every lookup gets a short timeout (suggest 1.5–2s, one round trip) and runs concurrently across
assets in the intent.

### What each family checks

| Family | Call | Confirms |
|---|---|---|
| Ordinal | `ordfs.bulkMetadata(origins)` | contentType, contentLength (the missing `size`), origin, name from `map` |
| OpNS | `opns.getOrigin(name)` / `validateOrigins(outpoints)` | the name resolves to the origin being bought |
| BSV21 | `bsv21.validateOutputs(...)` / `getTokenDetails(id)` | token is active/funded; sym and decimals |

`bulkMetadata` accepts a `:seq` suffix (`txid_0:-2`) for origin resolution, so one request covers
every asset on the card.

### Where it applies

- **Purchases** — the reason this exists. Nothing is wallet-owned, so a service is the only source.
- **Transfers / list / cancel** — the wallet re-lookup by `id` is already trustworthy; a service
  answer is confirmation, and should upgrade `unverified` → `verified` rather than being required.
- **Inscribe** — the output *is* the envelope, so type and size parse straight from the script. No
  network call needed; do this independently of services.

## Changes by file

| File | Change |
|---|---|
| `permission-module/src/createOneSatPermissionModule.ts` | accept optional services; thread into `deps` |
| `permission-module/src/enrichIntent.ts` | `extractTrust` derives from lookups, not tags; add verification pass |
| `permission-module/src/handlers.ts` | pass verified fields + trust through to the prompt |
| `permission-module-ui/src/OneSatPermissionPrompt.tsx` | render size; make `unverified` visually distinct from `verified` |
| `actions/src/apply/resolveListingMeta.ts` | stop writing `trust:` in `stampListingMetaTags` |
| hosts (yours-wallet, test-app, wallet-desktop) | pass services when constructing the module |

## Non-goals

- Blocking or rejecting on `mismatch` — surface it, let the user decide.
- Making any host *require* a reachable ORDFS or overlay.
- Content preview fetching beyond what `contentUrls` already does.

## Decided: pass `OneSatServices`

Take the same `OneSatServices` handle the actions context already takes, not a narrow
method-interface.

A narrow interface is the more interesting long-term shape — it is the natural way to let a user
point the wallet at **their own overlays**, since a host could satisfy it with anything that
implements the methods. But that only works if the actions context accepts the same abstraction;
doing it on the module alone would create two different ways to configure the same services. That
belongs in its own piece of work.

**Future direction (not this pass):** a shared narrow service interface accepted by both the module
and `createContext`, enabling user-supplied overlay endpoints.

## Decided: no second confirmation on mismatch

Show the correction and let the user decide. Approving **is** the confirmation — adding a second
gate would train people to click through both.

## Decided: how the badge arrives

The intent carries an optional field that resolves to the trust result. The prompt component
awaits it in an effect and re-renders. `promptHandler`'s signature does not change, and hosts that
ignore the field are unaffected.
