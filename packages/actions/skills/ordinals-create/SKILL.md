---
name: ordinals-create
description: "This skill should be used when a user wants to mint, inscribe, or create an ordinal or NFT on BSV blockchain — such as 'mint this image as an ordinal', 'create an NFT on BSV', 'inscribe this file on-chain', 'I want to permanently store a file on blockchain', or 'how much does it cost to mint'. Uses @1sat/actions from the 1sat-sdk to construct and broadcast inscription transactions via a BRC-100 wallet. For indexed 1Sat collections, also load the collections skill before recommending an action."
allowed-tools: "Bash(bun:*)"
disable-model-invocation: true
---

# Wallet Create Ordinals

Mint new ordinals/NFTs on BSV blockchain using `@1sat/actions` from the `1sat-sdk`.

## When to Use

- Mint new NFT inscriptions
- Create ordinal collections
- Inscribe images, text, or files on-chain
- Store files permanently on blockchain

## Usage

```bash
# Mint image ordinal
bun run <SKILL_DIR>/scripts/mint.ts <wif> <image-path>

# Mint with metadata
bun run <SKILL_DIR>/scripts/mint.ts <wif> <file-path> <metadata-json>
```

## Actions Overview

| Action | Description |
|--------|-------------|
| `inscribe` | Create a single inscription from base64 content |
| `listOrdinals` | List owned ordinals after mint (metadata/tags; print `id`) |
| `mintCollection` | Create a collection parent inscription |
| `mintCollectionItem` | Create an item inscription linked to a parent collection |

CLI: `ordinals inscribe` (was `ordinals mint`). Marketplace send/sell/buy: see `../ordinals-marketplace/SKILL.md`.

## Calling Pattern

```typescript
import { createContext, inscribe } from '@1sat/actions'

// wallet is positional; options (services) second
const ctx = createContext(wallet, { services })
const result = await inscribe.execute(ctx, input)
```

Two-phase signing is handled internally — see `../action-patterns/SKILL.md` for that flow.

## Inscribe (`inscribe`)

The `inscribe` action from `@1sat/actions` handles single inscription creation:

```typescript
import { inscribe, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Inscribe a file
const result = await inscribe.execute(ctx, {
  base64Content: btoa(fileContent),   // or readFileSync(path).toString('base64')
  contentType: 'image/png',           // MIME type
  map: {                              // Optional MAP metadata (Record<string,string>)
    app: 'myapp',
    type: 'image',
    name: 'My NFT'
  },
  signWithBAP: true,                  // Optional: sign with BAP identity (Sigma protocol)
  destination: { address: ownerAddress }, // Optional: where to lock. Defaults to self.
})

if (result.txid) {
  console.log('Inscribed:', result.txid)
} else {
  console.error('Error:', result.error)
}
```

### Input (`InscribeRequest`) / Response (`InscribeResponse`)

```typescript
interface InscribeRequest {
  base64Content: string       // base64 encoded content (required)
  contentType: string         // MIME type (required)
  map?: Record<string, string> // optional MAP metadata
  signWithBAP?: boolean        // sign with BAP identity (Sigma)
  destination?: Destination    // lockingScript (hex), counterparty (pubkey), or address; defaults to self
}

interface InscribeResponse {
  txid?: string
  tx?: number[]   // AtomicBEEF, not hex
  error?: string
}
```

Decoded content must be within `MAX_INSCRIPTION_BYTES` or the action returns an error. The inscription is recorded in the `ordinals` basket with tags `type:{contentType}`, `origin`, and `name:{map.name}` when provided.

## Sigma-Signed Inscriptions

Set `signWithBAP: true` to sign the inscription with the wallet's BAP identity using the Sigma protocol.

This uses a two-transaction flow: an anchor transaction is created first (not broadcast), then the inscription transaction spends the anchor output, embedding a Sigma signature in the locking script. Both transactions are broadcast together atomically.

The signature proves authorship and is verifiable on-chain using the `sigma-protocol` library.

```typescript
const result = await inscribe.execute(ctx, {
  base64Content: fileB64,
  contentType: 'image/png',
  map: { app: 'myapp', name: 'Signed NFT' },
  signWithBAP: true,
})
```

## What Gets Created

Minting creates:
- On-chain inscription of file/data
- Unique ordinal ID (txid + output index)
- Permanent, immutable storage
- Tradeable NFT asset

## Collections

A collection is an ordinal inscription carrying MAP metadata with `subType="collection"`; a collection item is an inscription with `subType="collectionItem"` whose `subTypeData.collectionId` points at the parent collection's origin outpoint.

Both actions create one-satoshi inscriptions with collection MAP and a valid,
transaction-bound SIGMA signature, matching the shipped `1sat-stack`
collection overlay's admission shape. Load
`../../client/skills/collections/SKILL.md` for the full indexing contract.

### Create a Collection (`mintCollection`)

```typescript
import { mintCollection, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await mintCollection.execute(ctx, {
  base64Content: btoa(artwork),  // collection icon/image
  contentType: 'image/png',
  name: 'My Collection',
  description: 'A series of generative art pieces',
  quantity: 100,                 // total items in the collection
  traits: { background: { /* ... */ } }, // optional CollectionTraits
  rarityLabels: [],              // optional
  royalties: [],                 // optional Royalty[]
  app: '1sat-wallet',            // optional MAP app, default '1sat-wallet'
})

console.log('Collection origin:', result.collectionId) // "<txid>_0"
```

`MintCollectionInput` requires `base64Content`, `contentType`, `name`, `description`, `quantity` (must be >= 1). Returns `MintCollectionOutput`: `{ txid?, collectionId?, error? }`.

### Create a Collection Item (`mintCollectionItem`)

```typescript
import { mintCollectionItem, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await mintCollectionItem.execute(ctx, {
  base64Content: btoa(itemArt),
  contentType: 'image/png',
  name: 'Item #1',
  collectionId: 'collectionTxid_0', // parent collection origin outpoint
  mintNumber: 1,                     // optional
  rank: 1,                           // optional
  rarityLabel: 'rare',               // optional free-form label
  traits: [],                        // optional CollectionItemTrait[]
  attachments: [],                   // optional CollectionItemAttachment[]
  app: '1sat-wallet',                // optional
})
```

`MintCollectionItemInput` requires `name`, `collectionId`, and exactly one
content source:

- `base64Content` plus `contentType` embeds new content.
- `ref` creates an `ord-fs/json` body such as `{ ".": "<txid>_<vout>" }` or
  `{ ".": "_0" }`, allowing an existing or same-transaction output to be the
  item's default content.

An invalid `collectionId` or ORDFS reference returns an error. The item embeds
the collection outpoint as the inscription `parent`, carries the collection
MAP fields, and is signed with SIGMA. Returns `MintCollectionItemOutput`:
`{ txid?, error? }`.

## Requirements

- BRC-100 compatible wallet (`@1sat/wallet`, `@1sat/wallet-node`, or `@1sat/wallet-remote`)
- File to inscribe (image, text, etc.)
- `@1sat/actions` for inscription and collection creation
- Sufficient BSV balance for inscription cost + fees

> To deploy a BSV21 fungible token, use the token actions (`deployBsv21Mint`, `deployBsv21Auth`, `mintBsv21`) — see `../tokens/SKILL.md`.

## Cost

Inscription cost depends on file size:
- Stored on-chain permanently
- Fee rate is configurable via `satsPerKb` (default varies)
- Larger files = higher cost

## Identity & Provenance

Collection actions add SIGMA automatically. For an ordinary inscription, use
the inscription action's `signWithBAP: true` path. AIP is a different protocol
and does not satisfy the collection overlay's SIGMA admission requirement.

### NFTs as Subscription Tokens

Ordinals with specific origin txids can serve as subscription NFTs for Sigma Identity:
- The **origin txid** of the NFT determines the subscription tier (Free/Plus/Pro)
- Sigma queries 1sat-stack for NFTs owned by connected wallets
- Origin matching against tier config grants access to features
- This enables transferable, resalable subscriptions via ordinal ownership

When minting subscription NFTs, ensure the collection's origin txid is registered in the Sigma subscription config.

## Output

Returns:
- Transaction ID (`txid`)
- Raw transaction hex (`rawtx`, optional)
- Error string (`error`, if failed)
