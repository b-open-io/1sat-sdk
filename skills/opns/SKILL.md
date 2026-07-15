---
name: opns
description: "This skill should be used when working with OpNS decentralized names on BSV — claiming or buying a name at 1sat.name, publishing or removing its wallet identity binding, listing or transferring an owned name, looking up resolution, or managing the OpNS wallet basket. Triggers on 'OpNS', '1sat.name', 'claim name', 'buy name', 'register name', 'decentralized domain', 'name service', 'on-chain DNS', 'identity binding', 'name resolution', 'list name', 'transfer name', 'deregister name', or 'opns.idKey'. Uses 1sat.name for acquisition and @1sat/actions for the owned-name lifecycle."
---

# OpNS Names

Claim OpNS names through [1sat.name](https://1sat.name), then publish and manage
the owned name with `@1sat/actions`.

## Distinguish Acquisition from Identity Registration

The word "register" is ambiguous in OpNS:

- **Claim or acquire a name**: obtain the OpNS ordinal by mining an available
  name or buying a listed name at [1sat.name](https://1sat.name).
- **Publish an identity binding**: call `opnsRegister` on an OpNS ordinal already
  owned by the connected wallet. This binds the wallet's own identity key.

Never pass a name string to `opnsRegister` and imply that it creates the name.
If the requested name is not in the wallet's `opns` basket, acquire it first.

## What is OpNS?

OpNS (Op = "operation", a key field in the original Ordinals protocol; NS = like DNS) is a decentralized name system on BSV where:
- Names are ordinal inscriptions (1-sat outputs) with content type `application/op-ns`
- Names can bind to an identity public key via MAP metadata
- Binding is done on-chain via the `opns.idKey` MAP field
- The overlay only tracks the mine tree (not individual name transfers) — ORDFS handles ordinal-level resolution
- OpNS names can serve as paymail identifiers via BRC-29 address derivation

### Architecture (Current)

- **Mine tree**: Tracked by the OpNS overlay in 1sat-stack (`pkg/opns/`). Once a name's origin is indexed, it's permanent (origins don't change).
- **Name resolution**: Handled by ORDFS, not the overlay. The overlay route is `GET /opns/mine/:name`.
- **Identity binding**: MAP metadata `opns.idKey` on a self-transfer of the OpNS ordinal.
- **Paymail**: OpNS name -> ORDFS MAP metadata lookup -> `idKey` -> BRC-29 address derivation for payment delivery.
- **Genesis**: `58b7558ea379f24266c7e2f5fe321992ad9a724fd7a87423ba412677179ccb25`

## Actions

| Action | Description |
|--------|-------------|
| `getOpnsNames` | List owned OpNS names with BEEF for spending |
| `opnsRegister` | Bind wallet's identity key to an OpNS name |
| `opnsDeregister` | Remove identity binding from an OpNS name |
| `opnsList` | List a name for sale and clear its identity binding |
| `opnsTransfer` | Transfer a name and clear its identity binding |

## Claim or Buy a Name at 1sat.name

Use the hosted [1sat.name](https://1sat.name) flow when the wallet does not yet
own the requested name:

1. Connect and authorize a funded BRC-100 wallet.
2. Search the normalized name. Names use 1-64 letters, digits, or hyphens.
3. If the name is available, review the current flat price shown by the site and
   start the paid proof-of-work claim. The BRC-105 payment transaction is the
   job identifier.
4. Track the job until the minted name is delivered and internalized into the
   wallet's `opns` basket. If another miner wins the name, use the job refund
   flow for the remaining funds.
5. If the name is already listed, buy the listing through the site. A claimed,
   unlisted name is unavailable from the current owner.
6. Open **My Names** to publish or remove the identity binding, list or unlist
   the name, or transfer it.

Do not hardcode a claim price: the site's `GET /price` response is display data,
and the BRC-105 response on `POST /jobs` is the authoritative charge. Do not
reimplement the paid mining orchestrator in a client integration; use the
hosted service contract.

## Register Identity on a Name

```typescript
import { createContext, getOpnsNames, opnsRegister } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// 1. List OpNS ordinals from the wallet with their spending BEEF
const { outputs } = await getOpnsNames.execute(ctx, {})

// 2. Find the exact OpNS name to publish; never take the first name blindly
const requestedName = 'alice'
const opnsOrdinal = outputs.find((output) => {
  if (output.tags?.includes(`name:${requestedName}`)) return true
  try {
    return JSON.parse(output.customInstructions ?? '{}').name === requestedName
  } catch {
    return false
  }
})

if (!opnsOrdinal) {
  throw new Error(`OpNS name ${requestedName} is not owned by this wallet`)
}

// 3. Register identity key — inputBEEF is optional (auto-resolved from wallet)
const result = await opnsRegister.execute(ctx, {
  ordinal: opnsOrdinal,
})

if (result.txid) {
  console.log('Registered! txid:', result.txid)
}
```

### What Registration Does

1. Gets the wallet's identity public key via `wallet.getPublicKey({ identityKey: true })`
2. Transfers the OpNS ordinal to self with MAP metadata: `{ 'opns.idKey': identityPubKey }`
3. Adds the `opns:published` tag to the output
4. Signs and broadcasts the transaction
5. The overlay picks up the transaction via the mine tree — no client-side overlay submission needed

`opnsRegister` always publishes the connected wallet's identity key. It does
not accept an arbitrary identity key. Older wallet entries may lack a `name:`
tag; when needed, match the exact name from `customInstructions.name`.

## List or Transfer an Owned Name

- Use `opnsList` with the exact owned `WalletOutput`, price in satoshis, and a
  payment address. Listing clears `opns.idKey` so the seller's identity stops
  resolving immediately.
- Use `opnsTransfer` with either a recipient identity public key
  (`counterparty`) or P2PKH address. Transfer also clears `opns.idKey`.
- Use the ordinary `cancelListing` action to unlist a name. Refresh the wallet
  output before the next operation because every lifecycle action spends it.

## Deregister Identity from a Name

```typescript
import { opnsDeregister, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await ctx.wallet.listOutputs({
  basket: 'opns',
  includeTags: true,
  includeCustomInstructions: true,
  include: 'entire transactions',
})
const { outputs, BEEF } = result
const opnsOrdinal = outputs.find(o =>
  o.tags?.some(t => t === 'opns:published')
)

// inputBEEF is optional — auto-resolved from wallet via ID tag
const result = await opnsDeregister.execute(ctx, {
  ordinal: opnsOrdinal,
})
```

### What Deregistration Does

1. Transfers the OpNS ordinal to self with MAP metadata: `{ 'opns.idKey': '' }` (empty string)
2. Removes the `opns:published` tag
3. The overlay detects the cleared binding via the mine tree — no client-side overlay submission needed

## Looking Up OpNS Names and Identity Bindings

Use `OpnsClient` to find the immutable name origin, then resolve its latest MAP
metadata through ORDFS:

```typescript
import { OpnsClient, OrdfsClient } from '@1sat/client'

const baseUrl = 'https://api.1sat.app'
const name = 'alice'
const origin = await new OpnsClient(baseUrl).getOrigin(name)
const latest = await new OrdfsClient(baseUrl).getMetadata(origin.outpoint, -1)
const identityKey = latest.map?.['opns.idKey']
```

For paymail, follow the target domain's `/.well-known/bsvalias` capability
document and call its PKI URL for `name@domain`. The paymail host performs the
same OpNS-origin plus latest-ORDFS resolution before returning the public key.

## OpNS Baskets and Tags

OpNS ordinals are stored in the `opns` basket (not `ordinals`):

```typescript
// List only OpNS names
const opnsOutputs = await wallet.listOutputs({
  basket: 'opns',
  includeTags: true,
  includeCustomInstructions: true,
  include: 'entire transactions',
})
```

### Tags on OpNS outputs

| Tag | Meaning |
|-----|---------|
| `type:application/op-ns` | This is an OpNS name |
| `opns:published` | Identity key is currently registered |
| `origin:{outpoint}` | Origin outpoint of the name |
| `name:{value}` | The name string |

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```

OpNS operations require `services` for wallet and transaction context. Overlay submission is handled automatically by the mine tree — client code does not need to submit to the overlay directly.
