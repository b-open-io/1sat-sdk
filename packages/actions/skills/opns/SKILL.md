---
name: opns
description: "This skill should be used when working with OpNS decentralized names on BSV — claiming or buying a name at 1sat.name, publishing or removing its wallet identity binding, listing or transferring an owned name, looking up resolution, or managing the OpNS wallet basket. Triggers on 'OpNS', '1sat.name', 'claim name', 'buy name', 'register name', 'decentralized domain', 'name service', 'on-chain DNS', 'identity binding', 'name resolution', 'list name', 'transfer name', 'deregister name', or 'opns.idKey'. Uses 1sat.name for acquisition and @1sat/actions for the owned-name lifecycle."
---

# OpNS Names

Claim OpNS names through [1sat.name](https://1sat.name), then publish and manage
the owned name with `@1sat/actions`.

## Distinguish Acquisition from Identity Registration

- **Claim or acquire a name**: mine or buy at [1sat.name](https://1sat.name), or `buyOpns` / `internalizeOpns`.
- **Publish an identity binding**: `registerOpns` on an OpNS UTXO already in the wallet (`id`).

Never pass a bare name string to `registerOpns` as if it creates the name.

## What is OpNS?

- Names are ordinal inscriptions (1-sat) with content type `application/op-ns`
- Identity bind via PushDrop / MAP on self-moves
- Overlay tracks the mine tree; ORDFS resolves ordinal-level state
- Genesis: `58b7558ea379f24266c7e2f5fe321992ad9a724fd7a87423ba412677179ccb25`

## Actions (id-first)

Wallet-owned spends take **`id`** only. Action loads row + BEEF from the OPNS basket.
External buys take **`outpoint`** + optional **`inputBEEF`** (else services fetch).

| Action | Description |
|--------|-------------|
| `listOpns` | List owned names (metadata/tags default; optional BEEF) |
| `internalizeOpns` | File foreign mint AtomicBEEF → OPNS basket + full tags |
| `registerOpns` | Bind wallet identity key (`{ id }`) |
| `deregisterOpns` | Clear identity bind (`{ id }`) |
| `sellOpns` | List for sale (`{ id, price, payAddress? }`) |
| `sendOpns` | Send to counterparty or address (`{ id, counterparty? \| address? }`) |
| `cancelOpnsListing` | Cancel listing back into OPNS basket (`{ id }`) |
| `buyOpns` | Buy external listing → file OPNS basket (`{ outpoint, inputBEEF?, name?, origin? }`) |


## Claim or Buy at 1sat.name

1. Connect a funded BRC-100 wallet.
2. Search normalized name (1–64 letters, digits, hyphens).
3. Available → paid PoW claim; job id is the BRC-105 payment tx.
4. Track job until mint is internalized into the `opns` basket.
5. Listed → buy via site or `buyOpns` with listing outpoint.
6. **My Names**: register/deregister, sell/cancel, send.

Do not hardcode claim price; use site `GET /price` / job response.

## Register Identity

```typescript
import { createContext, listOpns, registerOpns } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const { outputs } = await listOpns.execute(ctx, { names: ['alice'] })
const row = outputs[0]
if (!row) throw new Error('not owned')

const id = row.tags?.find((t) => t.startsWith('id:'))?.slice(3)
if (!id) throw new Error('missing id: tag')

const result = await registerOpns.execute(ctx, { id })
```

Self-moves: `id` → one `loadBasketOutputBeef` → `ordinalSeedTags` + domain tags (`opns`, `opns:published`, listing markers). Stay in OPNS basket. Do **not** use `resolveOrdinalTags` for owned filing.

## Sell / Send / Cancel

```typescript
import { sellOpns, sendOpns, cancelOpnsListing } from '@1sat/actions'

// payAddress optional — default P1SAT keyID `1sat 0`
await sellOpns.execute(ctx, { id, price: 100_000 })

await sendOpns.execute(ctx, { id, address: '1Recipient...' })
// or { id, counterparty: '02abc...' }

await cancelOpnsListing.execute(ctx, { id })
```

Use **`cancelOpnsListing`**, not generic `cancelOrdinalListing`, so filing stays in OPNS.

## Buy External Listing

```typescript
import { buyOpns } from '@1sat/actions'

await buyOpns.execute(ctx, {
  outpoint: 'txid_0',
  // inputBEEF optional if services can fetch
  name: 'alice',
  origin: 'mintTxid_2',
})
```

## Deregister

```typescript
await deregisterOpns.execute(ctx, { id })
```

## Lookup (indexer)

```typescript
import { OpnsClient, OrdfsClient } from '@1sat/client'

const origin = await new OpnsClient('https://api.1sat.app').getOrigin('alice')
const latest = await new OrdfsClient('https://api.1sat.app').getMetadata(origin.outpoint, -1)
const identityKey = latest.map?.['opns.idKey']
```

## Tags

| Tag | Meaning |
|-----|---------|
| `opns` | OpNS asset |
| `type:application/op-ns` | Content type |
| `opns:published` | Identity currently bound |
| `origin:{outpoint}` | Mint origin |
| `name:{value}` | Name string |
| `id:{…}` | Basket tracking id (required for spends) |
| `ordlock` / `price:{n}` | Listed for sale |

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```
