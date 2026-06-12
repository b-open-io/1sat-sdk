---
name: payments
description: "This skill should be used when sending BSV with the 1sat-sdk — single payments, batch payments to multiple recipients, paymail sends, OP_RETURN data, custom locking scripts, inscriptions attached to a payment, sweeping a wallet's whole balance to one destination, or deriving deposit addresses to receive BSV. Triggers on 'send BSV', 'payment', 'batch payment', 'pay to paymail', 'OP_RETURN', 'send all BSV', 'sweep balance', 'deposit address', 'receive BSV', or 'derive address'. Uses @1sat/actions."
---

# Payments

Send BSV and derive deposit addresses with `@1sat/actions`.

## Calling Pattern

```typescript
import { createContext, sendBsv } from '@1sat/actions'

const ctx = createContext(wallet, { services }) // wallet positional, options second
const result = await sendBsv.execute(ctx, input)
```

`services` is optional for these actions but provide it if you have it. The wallet is any BRC-100 compatible `WalletInterface`.

## sendBsv

Send BSV to one or more destinations in a single transaction. **Single-phase** — it calls `wallet.createAction` directly and does not use two-phase signing. Plain sends carry no P1Sat semantics (no asset inputs, no basketed outputs).

### Input

```typescript
interface SendBsvInput {
  requests: SendBsvRequest[]
  fundingProvider?: FundingProvider // optional external funder
}

interface SendBsvRequest {
  address?: string   // destination P2PKH address
  paymail?: string   // destination paymail
  satoshis: number   // amount in satoshis (required)
  script?: string    // custom locking script (hex)
  data?: string[]    // OP_RETURN data elements
  inscription?: {    // attach an inscription (requires `address`)
    base64Data: string
    mimeType: string
    map?: Record<string, string>
  }
  fundingProvider?: FundingProvider
}
```

Each request resolves to exactly one output, chosen by which field is set (precedence): `paymail` → `script` → `address` (with optional `inscription`) → `data` (OP_RETURN). A request with none of these returns `{ error: 'invalid-request' }`.

### Response

```typescript
interface SendBsvResponse {
  txid?: string
  tx?: number[]   // AtomicBEEF (BRC-95)
  error?: string
}
```

### Examples

```typescript
// Simple payment
await sendBsv.execute(ctx, {
  requests: [{ address: '1Recipient...', satoshis: 50000 }],
})

// Batch payment to multiple recipients
await sendBsv.execute(ctx, {
  requests: [
    { address: '1Alice...', satoshis: 10000 },
    { address: '1Bob...', satoshis: 20000 },
  ],
})

// Paymail (resolves the recipient's outputs via P2P payment destination,
// then delivers the BEEF P2P after broadcast)
await sendBsv.execute(ctx, {
  requests: [{ paymail: 'alice@example.com', satoshis: 25000 }],
})

// Custom locking script (hex)
await sendBsv.execute(ctx, {
  requests: [{ script: '76a914...88ac', satoshis: 5000 }],
})

// OP_RETURN data
await sendBsv.execute(ctx, {
  requests: [{ data: ['hello', 'world'], satoshis: 0 }],
})

// Payment with an inscription on the output
await sendBsv.execute(ctx, {
  requests: [{
    address: '1Recipient...',
    satoshis: 1,
    inscription: {
      base64Data: btoa('Hello on-chain'),
      mimeType: 'text/plain',
    },
  }],
})
```

### Notes

- **Paymail** sends call `getP2pPaymentDestination` to fetch the recipient's outputs and a reference, then deliver the transaction BEEF P2P (`sendBeefP2P`) after broadcast. The AtomicBEEF returned by `createAction` is converted to plain BEEF (BRC-62) before delivery.
- **fundingProvider**: when set, the provider funds and broadcasts the transaction instead of the wallet. Can be passed at the input level or per-request.
- Returns `{ error: 'no-requests' }` for an empty `requests` array, `{ error: 'invalid-data' }` for malformed OP_RETURN data, and `{ error: 'no-txid-returned' }` if the wallet returns no txid.

## sendAllBsv

Sweep the wallet's entire spendable balance to a single destination address. **Single-phase** like `sendBsv`. Uses the wallet's max-fundable sentinel so the output is adjusted to all available funds minus fees.

### Input

```typescript
interface SendAllBsvInput {
  destination: string // P2PKH address (paymail not supported)
  fundingProvider?: FundingProvider
}
```

Returns `SendBsvResponse`. Paymail destinations are rejected — use `sendBsv` with a fixed amount instead.

```typescript
import { createContext, sendAllBsv } from '@1sat/actions'

const ctx = createContext(wallet, { services })
await sendAllBsv.execute(ctx, { destination: '1Recipient...' })
```

## deriveDepositAddresses

Derive P1SAT wallet-bound deposit addresses from the wallet's identity key, for **receiving** BSV (or ordinals/tokens). KeyID format is `<prefix> <index>` (plaintext). This is a read-only derivation — it does not build a transaction.

### Input

```typescript
interface DeriveDepositAddressesInput {
  prefix?: string      // KeyID prefix; default "1sat" (DEFAULT_DEPOSIT_PREFIX)
  startIndex?: number  // first index to derive; default 0
  count?: number       // number of addresses to derive; default 1
}
```

The default prefix `"1sat"` is chosen so any wallet binding the same identity key (yours-wallet, wallet-desktop, CLI, MCP server) derives the **same** default deposit addresses without coordination. Supply a custom prefix only when you want a distinct address set (e.g. `"mcp"`).

### Result

```typescript
interface DeriveDepositAddressesResult {
  derivations: AddressDerivation[]
}

interface AddressDerivation {
  address: string            // base58check address
  index: number              // key index
  derivationPrefix: string   // the prefix used
  derivationSuffix: string   // String(index)
  senderIdentityKey: string  // wallet's root identity public key
  publicKey: string          // derived public key for this address
}
```

```typescript
import { createContext, deriveDepositAddresses } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// One default deposit address
const { derivations } = await deriveDepositAddresses.execute(ctx, {})

// Five addresses under a custom prefix
const { derivations: mcpAddrs } = await deriveDepositAddresses.execute(ctx, {
  prefix: 'mcp',
  startIndex: 0,
  count: 5,
})
```

## Related

- Action/context pattern, two-phase signing, registry, baskets and tags: see ../action-patterns
- Inscriptions as standalone outputs: see ../inscriptions

## Requirements

```bash
bun add @1sat/actions @bsv/sdk
```
