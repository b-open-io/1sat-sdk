---
name: tokens
description: "This skill should be used when working with BSV21 fungible tokens — sending tokens, checking token balances, listing token UTXOs, purchasing tokens from marketplace, deploying a fixed-supply token, deploying a mintable token, or minting additional supply. Triggers on 'send tokens', 'token balance', 'BSV21', 'BSV-20', 'fungible token', 'transfer tokens', 'deploy token', 'mint token', 'mintable token', 'token listing', 'buy tokens', or 'token UTXO'. Uses @1sat/actions from the 1sat-sdk."
disable-model-invocation: true
---

# Token Operations

Send, receive, list, deploy, and mint BSV21 fungible tokens using `@1sat/actions`.

## Actions Overview

| Action | Description |
|--------|-------------|
| `listTokens` | List all BSV21 token UTXOs in the wallet |
| `getBsv21Balances` | Aggregated balances grouped by token ID |
| `sendBsv21` | Send tokens to a counterparty, address, or paymail |
| `purchaseBsv21` | Purchase tokens from a marketplace listing |
| `deployBsv21Mint` | Deploy a token with fixed supply (deploy+mint) |
| `deployBsv21Auth` | Deploy a mintable token via auth UTXOs (deploy+auth) |
| `mintBsv21` | Spend an auth UTXO to mint more supply or re-issue/transfer authority |

> Burning tokens is not in this module. Burning is `burnOrdinals` in the ordinals module — see `../ordinals-marketplace/SKILL.md`.

## Calling Pattern

```typescript
import { createContext, sendBsv21 } from '@1sat/actions'

// wallet is positional; options (services) second
const ctx = createContext(wallet, { services })
const result = await sendBsv21.execute(ctx, input)
```

Most token actions submit to and validate against the overlay, so `services` is required. Two-phase signing is handled internally by `executeTrackedAction` / `completeSignedAction` — see `../action-patterns/SKILL.md` for that flow.

## Check Token Balances

```typescript
import { getBsv21Balances, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const balances = await getBsv21Balances.execute(ctx, {})

for (const token of balances) {
  const displayAmt = Number(BigInt(token.amt)) / (10 ** token.dec)
  console.log(`${token.sym ?? token.id}: ${displayAmt}`)
}
```

### Balance Response (`Bsv21Balance[]`)

```typescript
interface Bsv21Balance {
  p: string       // Protocol: 'bsv-20'
  id: string      // Token ID (txid_vout)
  sym?: string    // Symbol (e.g., 'MYTOK')
  icon?: string   // Icon URL/outpoint
  dec: number     // Decimal places
  amt: string     // Total amount (raw, as string)
  all: { confirmed: bigint; pending: bigint }
  listed: { confirmed: bigint; pending: bigint }
}
```

`getBsv21Balances` takes no input fields (`GetBsv21BalancesInput = Record<string, never>`); pass `{}`.

## List Token UTXOs

```typescript
import { listTokens, createContext } from '@1sat/actions'

const ctx = createContext(wallet)

const outputs = await listTokens.execute(ctx, { limit: 100 })
// Returns WalletOutput[] with tags like 'bsv21:{tokenId}', 'amt:{amount}', 'dec:{decimals}'
```

`ListTokensInput` is `{ limit?: number }` (default 10000). Returns `WalletOutput[]` directly.

## Send Tokens

```typescript
import { sendBsv21, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await sendBsv21.execute(ctx, {
  tokenId: 'abc123...def456_0',
  recipients: [
    { amount: '1000000', destination: { counterparty: '02abc...' } },
    { amount: '500000', destination: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' } },
  ],
})

if (result.txid) {
  console.log('Sent! txid:', result.txid)
} else {
  console.error('Error:', result.error)
}
```

### Input (`SendBsv21Input`)

```typescript
interface SendBsv21Input {
  tokenId: string                    // txid_vout of the deploy tx
  recipients: SendBsv21Recipient[]
}

interface SendBsv21Recipient {
  amount: bigint | string            // raw token units
  destination: Destination           // lockingScript (hex), counterparty (pubkey), or address
}
```

All token actions return `TokenOperationResponse`: `{ txid?: string; tx?: number[]; error?: string }`. `tx` is AtomicBEEF (`number[]`), not hex.

### How Token Sending Works

1. Wallet lists all token UTXOs for the specified `tokenId`
2. UTXOs are batch-validated against the overlay (confirms unspent and valid)
3. Sufficient UTXOs are selected to cover the requested total
4. A BSV21 transfer inscription is created on each recipient's output
5. If there's change, a token output returns the remainder to the sender
6. An overlay processing fee is paid to the token's fund address (per token output)
7. Transaction is signed, broadcast, and submitted to the overlay for indexing

### Important: Token Amounts

Token amounts are in **raw units** (like satoshis for BSV). If a token has 8 decimals:
- `'100000000'` = 1.0 tokens
- `'50000000'` = 0.5 tokens
- `'1'` = 0.00000001 tokens

## Purchase Tokens from Marketplace

```typescript
import { purchaseBsv21, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await purchaseBsv21.execute(ctx, {
  tokenId: 'abc123...def456_0',
  outpoint: 'txid_vout',           // OrdLock UTXO holding the listed tokens
  amount: '1000000',                // tokens in the listing
  marketplaceAddress: '1Market...', // optional marketplace fee address
  marketplaceRate: 0.02,            // optional marketplace fee rate (0-1)
})
```

`PurchaseBsv21Request` requires `tokenId`, `outpoint`, and `amount`; `marketplaceAddress`/`marketplaceRate` are optional. Requires `services` — the listing is an external UTXO, so the BEEF is fetched from the overlay.

## Deploy a Fixed-Supply Token (deploy+mint)

`deployBsv21Mint` mints the entire supply in the deploy transaction. No further minting is possible — total supply is locked at deploy time.

```typescript
import { deployBsv21Mint, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await deployBsv21Mint.execute(ctx, {
  symbol: 'MYTOKEN',
  amount: '2100000000000000',         // total fixed supply, raw units (bigint | string)
  decimals: 8,                        // optional, default 0
  icon: 'iconTxid_0',                 // optional icon URL/outpoint or data URI
  destination: { address: ownerAddress }, // optional, defaults to self
})

console.log('Deployed token:', result.tokenId) // `${txid}_0`
```

### Input (`DeployBsv21MintInput`) / Response (`DeployBsv21Response`)

```typescript
interface DeployBsv21MintInput {
  symbol: string
  amount: bigint | string
  decimals?: number          // 0-18
  icon?: string
  destination?: Destination  // defaults to self
}

interface DeployBsv21Response {
  txid?: string
  tx?: number[]
  tokenId?: string           // `${txid}_${deployVout}`
  error?: string
}
```

Deploy uses a funding intermediate then a synchronous broadcast via `services.postBeef`, so `services` is required.

## Deploy a Mintable Token (deploy+auth)

`deployBsv21Auth` emits a single `deploy+auth` output that doubles as the genesis auth UTXO. Initial supply is zero — the auth holder mints supply later via `mintBsv21`.

```typescript
import { deployBsv21Auth, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await deployBsv21Auth.execute(ctx, {
  symbol: 'MINTABLE',
  decimals: 8,                        // optional, default 0
  icon: 'iconTxid_0',                 // optional
  destination: { address: authHolder }, // optional auth holder, defaults to self
})

console.log('Token ID:', result.tokenId)
console.log('Auth UTXO for future mints:', result.authOutpoint) // = tokenId; deploy output is the first auth
```

### Input (`DeployBsv21AuthInput`) / Response (`DeployBsv21AuthResponse`)

```typescript
interface DeployBsv21AuthInput {
  symbol: string
  decimals?: number
  icon?: string
  destination?: Destination  // auth holder, defaults to self
}

interface DeployBsv21AuthResponse extends DeployBsv21Response {
  authOutpoint?: string      // auth UTXO needed for future mints
}
```

## Mint, Re-issue, or End Minting (`mintBsv21`)

Spend an existing auth UTXO to mint new supply, transfer/continue authority, or permanently end minting. Requires `services`.

```typescript
import { mintBsv21, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Mint more supply; a continuing self-auth is emitted by default
const result = await mintBsv21.execute(ctx, {
  tokenId: 'deployTxid_0',
  mint: { amount: '1000000', destination: { address: recipient } },
})
console.log('New auth UTXO:', result.authOutpoint)

// Transfer mint authority to another counterparty (no mint)
await mintBsv21.execute(ctx, {
  tokenId: 'deployTxid_0',
  auth: { destination: { counterparty: '02other...' } },
})

// Permanently end minting (no continuing auth output) — must be explicit
await mintBsv21.execute(ctx, {
  tokenId: 'deployTxid_0',
  mint: { amount: '1000000', destination: { address: recipient } },
  endMinting: true,
})
```

### Input (`MintBsv21Input`) / Response (`MintBsv21Response`)

```typescript
interface MintBsv21Input {
  tokenId: string
  mint?: { amount: bigint | string; destination: Destination } // omit to skip minting
  auth?: { destination: Destination }                          // omit = continuing self-auth
  endMinting?: boolean   // required when no auth output should be emitted (destructive)
}

interface MintBsv21Response {
  txid?: string
  tx?: number[]
  authOutpoint?: string  // outpoint of the new auth UTXO, if emitted
  error?: string
}
```

Validation rules from source: at least one of `mint`/`auth` must be provided; `endMinting` without a `mint` returns `cannot-end-minting-without-mint`. `mint.amount` must be positive.

## Token Selection (send)

When sending tokens, the SDK selects UTXOs automatically. The selection:
- Batch-validates candidates against the overlay (confirms unspent)
- Picks UTXOs until the total covers the requested amount
- Returns `insufficient-tokens` if not enough validated UTXOs

## Overlay Integration

BSV21 tokens require overlay validation. The `services` object handles this:

```typescript
import { OneSatServices } from '@1sat/wallet'

const services = new OneSatServices('main')

// Token details (symbol, decimals, icon, fee info)
const details = await services.bsv21.getTokenDetails(tokenId)

// Validate outputs exist and are unspent
const valid = await services.bsv21.validateOutputs(tokenId, outpoints, { unspent: true })
```

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @1sat/templates @bsv/sdk
```
