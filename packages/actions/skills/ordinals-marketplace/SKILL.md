---
name: ordinals-marketplace
description: "This skill should be used when working with 1Sat Ordinals marketplace operations — listing ordinals for sale, purchasing listings, canceling listings, browsing available ordinals, or managing OrdLock marketplace scripts. Triggers on 'list ordinal', 'sell NFT', 'buy ordinal', 'purchase listing', 'cancel listing', 'marketplace', 'OrdLock', 'ordinal price', or 'browse ordinals'. Uses @1sat/actions ordinals module."
disable-model-invocation: true
---

# Ordinals Marketplace

List, purchase, and cancel ordinal listings using `@1sat/actions` and the OrdLock script.

## Actions

| Action | Description |
|--------|-------------|
| `getOrdinals` | List ordinals in the wallet (with BEEF for spending) |
| `transferOrdinals` | Transfer ordinals to new owners |
| `listOrdinal` | List an ordinal for sale at a price |
| `cancelListing` | Cancel an active listing |
| `purchaseOrdinal` | Purchase a listed ordinal |
| `burnOrdinals` | Burn one or more ordinals (send to OP_RETURN) |

## inputBEEF: When Required vs Optional

`inputBEEF` provides the SPV proof chain for the inputs being spent. Whether it's required depends on who owns the input:

- **Optional** for inputs from your own wallet — the action auto-resolves BEEF via the output's ID tag (`listOutputs` with tag filter). Transfer, list, and cancel all work without passing `inputBEEF` when the ordinal is in your wallet.
- **Required** for external inputs not in your wallet — e.g. purchasing a listing from another user or a marketplace. The buyer's wallet has no BEEF for the seller's ordlock UTXO, so the marketplace/overlay must provide it.

## Get Ordinals from Wallet

```typescript
import { getOrdinals, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const { outputs, BEEF } = await getOrdinals.execute(ctx, {
  limit: 100,
})

// Each output has tags like:
// type:image/png, origin:txid_0, name:My NFT
for (const o of outputs) {
  console.log(o.outpoint, o.tags)
}
```

## Transfer Ordinals

```typescript
import { transferOrdinals, getOrdinals, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// 1. Get ordinal and BEEF
const { outputs, BEEF } = await getOrdinals.execute(ctx, {})
const ordinal = outputs[0]

// 2. Transfer — inputBEEF is optional (auto-resolved from wallet via ID tag)
const result = await transferOrdinals.execute(ctx, {
  transfers: [
    { ordinal, counterparty: '02abc...' },
  ],
})

// Or transfer by address (external — not tracked in recipient's wallet)
const result2 = await transferOrdinals.execute(ctx, {
  transfers: [
    { ordinal, address: '1Recipient...' },
  ],
})

// Batch transfer multiple ordinals
const result3 = await transferOrdinals.execute(ctx, {
  transfers: [
    { ordinal: outputs[0], counterparty: '02abc...' },
    { ordinal: outputs[1], address: '1Bob...' },
  ],
})
```

## List Ordinal for Sale

```typescript
import { listOrdinal, getOrdinals, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// 1. Get ordinal and BEEF
const { outputs, BEEF } = await getOrdinals.execute(ctx, {})
const ordinal = outputs[0]

// 2. List for sale — inputBEEF is optional (auto-resolved from wallet)
const result = await listOrdinal.execute(ctx, {
  ordinal,
  price: 100000,  // Price in satoshis
  payAddress: '1YourPaymentAddress...',
})

if (result.txid) {
  console.log('Listed! txid:', result.txid)
}
```

### How Listing Works

1. Creates an OrdLock script that encodes the price and payment address
2. The ordinal is locked in this script — only a valid purchase or cancel can spend it
3. The listing is submitted to the marketplace overlay for indexing
4. Tags are updated: `ordlock` tag is added, basket remains `ordinals`

## Purchase a Listed Ordinal

```typescript
import { purchaseOrdinal, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await purchaseOrdinal.execute(ctx, {
  outpoint: 'txid_0',  // The listed ordinal's outpoint
  marketplaceAddress: '1MarketplaceAddress...',  // Optional marketplace fee address
  marketplaceRate: 0.02,  // Optional marketplace fee rate (2%)
})

if (result.txid) {
  console.log('Purchased! txid:', result.txid)
}
```

### How Purchase Works

1. Fetches the listing BEEF from the overlay
2. Reads the OrdLock script to extract price and payment address
3. Builds a transaction that satisfies the OrdLock:
   - Pays the seller the listed price
   - Pays marketplace fee (if applicable)
   - Transfers the ordinal to the buyer
4. Signs and broadcasts

## Cancel a Listing

```typescript
import { cancelListing, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Get the listed ordinal from wallet — filter by 'ordlock' tag
const { outputs } = await ctx.wallet.listOutputs({
  basket: '1sat',
  includeTags: true,
  includeCustomInstructions: true,
  tagsJSON: JSON.stringify(['ordlock']),
})
const listing = outputs[0]

// Cancel — inputBEEF is optional (auto-resolved from wallet via ID tag)
const result = await cancelListing.execute(ctx, { listing })

if (result.txid) {
  console.log('Cancelled! txid:', result.txid)
}
```

`CancelListingInput` is `{ listing: WalletOutput; inputBEEF?: number[] }`. `cancelListing` returns `OrdinalOperationResponse` (`{ txid?, tx?, error? }`).

### How Cancel Works

1. Reads the signing-side derivation (protocolID/keyID/counterparty) from the listing's `customInstructions`
2. Signs the OrdLock input using `OrdLock.cancelWithWallet` from `@1sat/templates`
3. Builds a fresh derivation for the returned output (keyID = the listing's outpoint) — the cancelled output records its own derivation, not the signing one
4. Transfers the ordinal back to the wallet under the resolved basket/tags

> Cancel derivation is internal. There is no exported `deriveCancelAddress` action — the cancel address is derived inside `cancelListing` from the listing output. Just pass the listing `WalletOutput`.

## OrdLock Script

The OrdLock script encodes a marketplace listing:

```
<lockPrefix> <payAddress> <price> <lockSuffix>
```

- The script is satisfied by either:
  - **Purchase**: Transaction includes an output paying the seller at `payAddress` for `price` satoshis
  - **Cancel**: Signed by the cancel key, derived from the listing output's `customInstructions`

## Burn Ordinals

```typescript
import { burnOrdinals, getOrdinals, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const { outputs } = await getOrdinals.execute(ctx, {})

// Sends the ordinal(s) to an OP_FALSE OP_RETURN with MAP { type: 'ord', op: 'burn' }
const result = await burnOrdinals.execute(ctx, {
  ordinals: [outputs[0]],
  // inputBEEF optional — auto-resolved from wallet via ID tag
  // app: 'myapp'  // optional MAP app name, default '1sat'
})
```

`BurnOrdinalsRequest` is `{ ordinals: WalletOutput[]; inputBEEF?: number[]; app?: string }`. Returns `OrdinalOperationResponse`. Burning is irreversible.

## Browsing Marketplace via API

Use the 1sat-stack API to browse listings:

```typescript
// Get ordinals by owner
const res = await fetch('https://api.1sat.app/1sat/owner/1Address.../txos')
const txos = await res.json()

// Filter for listings (have ordlock data)
const listings = txos.filter(t => t.data?.ordlock)

// Get specific ordinal content
const content = await fetch('https://api.1sat.app/1sat/content/txid_0')
```

## Tags on Marketplace Outputs

| Tag | Meaning |
|-----|---------|
| `ordlock` | Currently listed for sale |
| `type:{contentType}` | MIME type of the inscription |
| `origin:{outpoint}` | Origin outpoint of the ordinal |
| `name:{value}` | Name from MAP metadata |

## BigBlocks Registry Blocks

The [BigBlocks registry](https://registry.bigblocks.dev) provides 30 ready-to-use shadcn blocks that wrap the hook patterns from this SDK into polished, theme-aware UI. Install via CLI:

```bash
npx bigblocks add <block>
# or
bunx shadcn@latest add https://registry.bigblocks.dev/r/<block>.json
```

Marketplace-related blocks:

| Block | Description |
|-------|-------------|
| `create-listing` | List ordinals for sale via OrdLock |
| `buy-listing` | Purchase ordinals from the global orderbook |
| `market-grid` | Responsive grid of NFT listings with ORDFS thumbnails and buy actions |
| `ordinals-grid` | Owned ordinals grid with content type badges and selection |
| `inscribe-file` | Full inscription flow with File / BSV20 / BSV21 tabs |
| `deploy-token` | BSV21 token deployment |
| `send-bsv21` | BSV21 token send form with decimal-aware amount input |
| `token-list` | BSV20/BSV21 token holdings list with balances and icons |
| `opns-manager` | OpNS name management with register/deregister |

These blocks depend on `@1sat/react` for wallet context and `@1sat/actions` for transaction building. Install them into any Next.js project with shadcn configured. See the full 30-block registry at https://bigblocks.dev.

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```

Marketplace operations require `services` for overlay submission and BEEF fetching.
