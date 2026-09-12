---
name: ordinals-marketplace
description: "This skill should be used when working with 1Sat Ordinals marketplace operations — listing ordinals for sale, purchasing listings, canceling listings, browsing available ordinals, or managing OrdLock marketplace scripts. Triggers on 'list ordinal', 'sell NFT', 'buy ordinal', 'purchase listing', 'cancel listing', 'marketplace', 'OrdLock', 'ordinal price', or 'browse ordinals'. Uses @1sat/actions ordinals module."
disable-model-invocation: true
---

# Ordinals Marketplace

List, buy, send, and cancel ordinals with `@1sat/actions` (OrdLock).

## Actions (id-first)

| Action | Description |
|--------|-------------|
| `listOrdinals` | List wallet ordinals (metadata/tags default; optional BEEF) |
| `sendOrdinals` | Send ordinals (`id` per transfer, or pre-loaded row) |
| `sellOrdinal` | Put on market (`{ id, price, payAddress? }`) |
| `cancelOrdinalListing` | Cancel listing (`{ id }`) |
| `buyOrdinal` | Buy external listing (`{ outpoint, inputBEEF? }`) |
| `burnOrdinals` | Burn (`{ ids }` or pre-loaded rows) |


## BEEF rules

- **Wallet-owned** spend: pass **`id`** only — action loads row + BEEF from the `1sat` basket.
- **External** (buy): **`outpoint`** + **`inputBEEF`** if set; else services fetch; else error.

## List

```typescript
import { listOrdinals, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const { outputs } = await listOrdinals.execute(ctx, { limit: 100 })

for (const o of outputs) {
  const id = o.tags?.find((t) => t.startsWith('id:'))?.slice(3)
  console.log(id, o.outpoint, o.tags)
}
```

## Send

```typescript
import { sendOrdinals } from '@1sat/actions'

await sendOrdinals.execute(ctx, {
  transfers: [{ id, counterparty: '02abc...' }],
})

await sendOrdinals.execute(ctx, {
  transfers: [{ id, address: '1Recipient...' }],
})
```

Self-sends carry tags and stay in the `1sat` basket (no `resolveOrdinalTags` for owned filing).

## Sell

```typescript
import { sellOrdinal } from '@1sat/actions'

// payAddress optional — default P1SAT keyID `1sat 0`
await sellOrdinal.execute(ctx, { id, price: 100_000 })
```

Adds `ordlock` + `price:{n}` tags; keeps the `1sat` basket.

## Buy

```typescript
import { buyOrdinal } from '@1sat/actions'

await buyOrdinal.execute(ctx, {
  outpoint: 'txid_0',
  // inputBEEF?: number[]
  marketplaceAddress: '1Market...', // optional
  marketplaceRate: 0.02,
})
```

OrdLock v2 purchases are laid out as front funding inputs, then the listing,
with the seller payout at the listing's input index (SIGHASH_SINGLE) and the
ordinal routed into the receive output. The action submits the draft shape
(listing input; receive, payout, fee outputs) and the apply step
(`applyOrdLockV2Purchase`) rewrites it after approval: front funding is a
wallet-owned P2PKH output in the `1sat-deposit` basket under a short
`hold:<unix ms>` tag, reused when one covers the price and otherwise created
by a preparation createAction on the base wallet. The cushion returns to the
same basket under a fresh hold; `sweepDeposit` reclaims anything whose hold
has lapsed. The unlock refuses to sign unless the listed satoshi lands on the
basketed 1-sat receive output.

## Cancel

```typescript
import { cancelOrdinalListing } from '@1sat/actions'

await cancelOrdinalListing.execute(ctx, { id })
```

## Burn

```typescript
import { burnOrdinals } from '@1sat/actions'

await burnOrdinals.execute(ctx, { ids: [id] })
```

## Tags

| Tag | Meaning |
|-----|---------|
| `id:{…}` | Tracking id |
| `ordlock` | Listed |
| `price:{n}` | List price (sats) |
| `type:{contentType}` | MIME |
| `origin:{outpoint}` | Origin |
| `name:{value}` | MAP name |

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```
