---
name: token-operations
description: "This skill should be used when working with BSV21 fungible tokens — sending tokens, checking token balances, listing token UTXOs, purchasing tokens from marketplace, deploying new tokens, or burning tokens. Triggers on 'send tokens', 'token balance', 'BSV21', 'BSV-20', 'fungible token', 'transfer tokens', 'deploy token', 'burn tokens', 'token listing', 'buy tokens', or 'token UTXO'. Uses @1sat/actions and @1sat/core packages from the 1sat-sdk."
disable-model-invocation: true
---

# Token Operations

Send, receive, list, deploy, and manage BSV21 fungible tokens using `@1sat/actions`.

## Actions Overview

| Action | Description |
|--------|-------------|
| `listTokens` | List all BSV21 token UTXOs in the wallet |
| `getBsv21Balances` | Aggregated balances grouped by token ID |
| `sendBsv21` | Send tokens to a counterparty, address, or paymail |
| `purchaseBsv21` | Purchase tokens from a marketplace listing |

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

### Balance Response

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

## List Token UTXOs

```typescript
import { listTokens, createContext } from '@1sat/actions'

const ctx = createContext(wallet)

const outputs = await listTokens.execute(ctx, { limit: 100 })
// Returns WalletOutput[] with tags like 'id:{tokenId}', 'amt:{amount}', 'dec:{decimals}'
```

## Send Tokens

```typescript
import { sendBsv21, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Send by counterparty public key (preferred - wallet can derive keys)
const result = await sendBsv21.execute(ctx, {
  tokenId: 'abc123...def456_0',  // Token ID (deploy txid_vout)
  amount: '1000000',              // Raw amount as string (respects decimals)
  counterparty: '02abc...',       // Recipient's identity public key
})

// Send by address (external - not tracked in recipient's wallet)
const result = await sendBsv21.execute(ctx, {
  tokenId: 'abc123...def456_0',
  amount: '500000',
  address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
})

if (result.txid) {
  console.log('Sent! txid:', result.txid)
} else {
  console.error('Error:', result.error)
}
```

### How Token Sending Works

1. Wallet lists all token UTXOs for the specified `tokenId`
2. UTXOs are validated against the overlay service (confirms they're unspent and valid)
3. Sufficient UTXOs are selected to cover the requested `amount`
4. A BSV21 transfer inscription is created on the recipient's output
5. If there's change, a second token output returns the remainder to the sender
6. An overlay processing fee is paid to the token's fund address
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
  outpoint: 'txid_vout',           // Listed token outpoint
  amount: '1000000',                // Tokens in the listing
  marketplaceAddress: '1Market...', // Optional: marketplace fee address
  marketplaceRate: 0.02,            // Optional: 2% marketplace fee
})
```

## Deploy a New Token (low-level)

> No action exists for token deployment yet. Use `@1sat/core` directly with raw private keys.

```typescript
import { deployBsv21Token } from '@1sat/core'

const result = await deployBsv21Token({
  symbol: 'MYTOKEN',
  decimals: 8,
  icon: 'iconTxid_0',              // Outpoint of icon inscription
  utxos: paymentUtxos,
  initialDistribution: {
    address: ownerAddress,
    tokens: 21_000_000,             // Display amount
  },
  destinationAddress: ownerAddress,
  paymentPk: paymentPrivateKey,
  changeAddress: changeAddress,
})

console.log('Deployed token:', result.tx.id('hex'))
```

## Burn Tokens (low-level)

> No action exists for token burning yet. Use `@1sat/core` directly with raw private keys.

```typescript
import { transferOrdTokens, TokenType } from '@1sat/core'

const result = await transferOrdTokens({
  protocol: TokenType.BSV21,
  tokenID: 'abc123...def456_0',
  decimals: 8,
  utxos: paymentUtxos,
  inputTokens: tokenUtxos,
  distributions: [],            // Empty = no recipients
  burn: true,                   // Burns all input tokens
  paymentPk: paymentPrivateKey,
  ordPk: ordPrivateKey,
  changeAddress: changeAddress,
})
```

## Token Selection

When sending tokens, the SDK selects UTXOs automatically. The selection:
- Validates each candidate against the overlay (confirms unspent)
- Picks UTXOs until the total covers the requested amount
- Returns `insufficient-tokens` error if not enough validated UTXOs

## Overlay Integration

BSV21 tokens require overlay validation. The `services` object handles this:

```typescript
import { OneSatServices } from '@1sat/wallet'

const services = new OneSatServices('main')

// Token details (symbol, decimals, icon, fee info)
const details = await services.bsv21.getTokenDetails(tokenId)

// Validate outputs exist and are unspent
const valid = await services.bsv21.validateOutputs(tokenId, outpoints, { unspent: true })

// After sending, transactions are automatically submitted to the overlay
```

## Requirements

```bash
bun add @1sat/actions @1sat/core @1sat/wallet @bsv/sdk
```
