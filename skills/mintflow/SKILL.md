---
name: mintflow
description: "This skill should be used when minting a tokenized collection or resellable license/access tokens on MintFlow (mintflow.me) — 'mint a collection', 'pre-configure a MintFlow mint', 'deep-link MintFlow', 'create tradeable/resellable BSV license tokens', 'tokenized access passes', 'sell licenses that can be resold', or gating product access on on-chain ordinal ownership. Covers MintFlow's deep-link/proposal pre-configuration, the collection option schema, the one-token-per-SKU access model, image requirements, and self vs hosted minting. MintFlow mints 1Sat Ordinal collections and passes on BSV."
---

# MintFlow

[MintFlow](https://mintflow.me) is a hosted app for "tokenized access + loyalty on
Bitcoin." It mints a **1Sat Ordinal collection** (MAP `subType: "collection"`) and
then per-tier **pass** items into it, built on `@1sat/actions`, `@1sat/templates`,
and `@1sat/react`. Source repo: `~/code/mintflow`.

Use it to sell **transferable, resellable license tokens**: hold the pass ordinal
and you hold the license; transfer it on the 1Sat marketplace to resell. Two mint
paths: **self** (connect a funded wallet, the wallet pays the inscription fee) and
**hosted** ($10 Stripe checkout, custodial mint via Droplit).

## Pre-configure a mint with a deep-link

MintFlow's `/mint` wizard reads a base64url **`init`** query param validated against
`mintInitSchema`. **Without an `init` param the page returns early and shows its
defaults** — so hand-set fields and a bare `?proposalUrl=…` are silently ignored.

For a config that includes images (large data URIs), host a **proposal JSON** and
reference it from *inside* the init payload:

```
init      = { "version": 1, "proposalUrl": "https://YOURSITE/collections/x.json" }
link      = https://mintflow.me/mint?init=<base64url(init)>&step=review
proposal  = { "v": 1, "payload": { "kind": "mintflow-init", "version": 1, "init": { …full MintInitPayload… } } }
```

- **`proposalUrl` is a FIELD of `init`, not a top-level query param.** This is the
  single most common mistake — a top-level `?proposalUrl=` does nothing.
- MintFlow fetches the proposal **client-side** from `mintflow.me`, so the JSON must
  be served with permissive **CORS** (`Access-Control-Allow-Origin: *`).
- Small, image-free configs can embed every field directly in `init` (no proposal
  file); images make the URL too long, so use the proposal for those.
- MintFlow applies the proposal first, then any direct `init` fields as overrides,
  and it is idempotent per init string (guarded in `sessionStorage`).

See [references/collection-mint.md](references/collection-mint.md) for the full
schema, the generator-script pattern, and a worked example.

## Token model for licenses / access (get this right)

To gate product access with **resellable** tokens, mint **one token type per
distinguishable product** — each product is its own tier. Holding a token *is*
access to that product; the holder never spends it. The access gate maps the held
pass's **tier → product_id**.

A single generic token is wrong: it cannot answer *which* product the holder owns,
so per-product gating is impossible and resale is meaningless. If you sell five
packs, that is five tiers, plus one per other SKU (e.g. a desktop app) and one for
an all-access bundle.

- **Resale** = transfer the ordinal on the 1Sat marketplace.
- **Royalties** (`royaltyPercentage` + `royaltyAddress`) pay the issuer on secondary
  sales — set the address to your product-fee address.

## Image requirements

MintFlow displays art in **`aspect-square` tiles** and downsizes to **1024px**
(`image/jpeg`). Provide **full-bleed 1:1 art that fills the frame** — a portrait
emblem centered in a square reads as small and letterboxed in the tile.

Generate the assets with the **gemskills content creator** — `Skill(gemskills:generate-image)`
(or the `gemskills:content` agent) with `--style pixl --aspect 1:1` — then optimize
with the optimizer (`Torque` / `Skill(optimize-images)`). Embed each as a ~512px
JPEG data URI in the proposal to keep inscription bytes small.

## Minting

- **Self:** connect a funded 1Sat wallet (`@1sat/react` `useWallet`). MintFlow calls
  `@1sat/actions` `inscribe.execute` with the cover bytes and a MAP envelope
  `{ app:"1sat.market", type:"ord", subType:"collection", name, subTypeData:{description,quantity,rarityLabels,traits}, royalties }`.
  Collection id becomes `<txid>_0`; "Mint Items Next" mints per-tier passes.
- **Hosted:** $10 Stripe checkout, custodial mint via Droplit (server needs
  `SIGMA_MEMBER_PRIVATE_KEY`). No wallet required from the buyer.

## Prerequisites (self path)

- A 1Sat wallet connected in the browser, **funded with BSV** for the inscription
  fee (a few cents; MintFlow shows the estimate on Review).
- No Sigma/admin login needed for a self-mint. Admin is only for MintFlow's partner
  short-links (`/l/<slug>`) and templates.
