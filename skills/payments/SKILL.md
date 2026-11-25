---
name: payments
description: "This skill should be used when sending BSV with the 1sat-sdk — single payments, batch payments to multiple recipients, payments to a BRC-169 handle (@handle@domain), paymail sends, receiving handle payments from the transaction-delivery box, OP_RETURN data, custom locking scripts, inscriptions attached to a payment, sweeping a wallet's whole balance to one destination, or deriving deposit addresses to receive BSV. Triggers on 'send BSV', 'payment', 'batch payment', 'pay a handle', 'BRC-169', 'transaction-delivery', 'pay to paymail', 'OP_RETURN', 'send all BSV', 'sweep balance', 'deposit address', 'receive BSV', or 'derive address'. Uses @1sat/actions."
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

Send BSV to one or more destinations in a single transaction. **Single-phase** — it calls `wallet.createAction` directly and does not use two-phase signing. Plain sends carry no P1Sat semantics (no asset inputs, no basketed outputs). A payment to a BRC-169 handle is different: see [Paying a handle](#paying-a-handle-brc-169).

### Input

```typescript
interface SendBsvInput {
  requests: SendBsvRequest[]
  fundingProvider?: FundingProvider // optional external funder
}

interface SendBsvRequest {
  address?: string   // destination P2PKH address
  handle?: string    // BRC-169 handle: '@handle@domain' or 'handle@domain' (see below)
  paymail?: string   // destination paymail — deprecated; tried as a handle first
  memo?: string      // memo for a handle payment (text/plain envelope content)
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

Each request resolves to exactly one output, chosen by which field is set (precedence): `handle`/`paymail` → `script` → `address` (with optional `inscription`) → `data` (OP_RETURN). A request with none of these returns `{ error: 'invalid-request' }`.

### Destination rules: handle first, then paymail

- `'@handle@domain'` (optional `+tag`: `'@handle+tag@domain'`) is **BRC-169 only** — resolution errors are returned, there is no paymail fallback.
- A bare `'handle@domain'` — in `handle` or in the existing `paymail` field — is tried as BRC-169 first: `GET https://<domain>/manifest.json`; when it carries `metanet.handles` the payment goes to the handle, otherwise (404, not JSON, or no `metanet.handles`) it is sent by paymail exactly as before.
- Paymail is to be deprecated. New code should use `handle`.

### Response

```typescript
interface SendBsvResponse {
  txid?: string
  tx?: number[]   // AtomicBEEF (BRC-95)
  delivered?: 'envelope' // handle payments: delivered to the handle's messagebox, not broadcast
  messageId?: string     // handle payments: messagebox message id
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

// BRC-169 handle (protected noSend BRC-29 payment, delivered in a signed
// envelope to the handle's transaction-delivery box; the recipient broadcasts)
const paid = await sendBsv.execute(ctx, {
  requests: [{ handle: '@alice@example.com', satoshis: 25000, memo: 'lunch' }],
})
// paid.delivered === 'envelope', paid.messageId

// Paymail (deprecated; tried as a BRC-169 handle first, then resolves the
// recipient's outputs via P2P payment destination and delivers the BEEF P2P
// after broadcast)
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

### Paying a handle (BRC-169)

BRC-169 §6.1, delivered the same way as `send1Color`:

1. `resolveHandle` → the recipient's identity key and messagebox.
2. A BRC-29 output: `getPublicKey({ protocolID: [2, '3241645161d8'], keyID: '<derivationPrefix> <derivationSuffix>', counterparty: identityKey })` with fresh random base64 prefix/suffix, P2PKH to that key, `satoshis` as requested.
3. One `createAction` with that single output, `options: { noSend: true, randomizeOutputs: false }`, label `p nosend expiry seconds 31536000` (`METANET_SEND_EXPIRY_SECONDS`): a BRC-177 protected `noSend` action the wallet funds. The sender never broadcasts it.
4. A signed §7.3 DAG-CBOR envelope to the resolved messagebox, box **`transaction-delivery`** (`TRANSACTION_DELIVERY_BOX`): `payment: { derivationPrefix, derivationSuffix, protocol: '3241645161d8', satoshis, beef }` (byte strings; `beef` is the action's Atomic BEEF), `content` = BRC-78 encryption of `Content-Type: text/plain; charset=utf-8` + the memo, `contentHash` = SHA-256 of those bytes.

A handle payment must be the only request (`{ error: 'handle-payment-must-be-the-only-request' }` otherwise); `fundingProvider` does not apply to it. When delivery fails the result carries `txid`, `tx` and `error: 'delivery-failed: …'`, so the caller can retry delivery or `abortAction` the send.

### Receiving handle payments: syncTransactionInbox

```typescript
import { createContext, syncTransactionInbox } from '@1sat/actions'

const { received, skipped, error } = await syncTransactionInbox.execute(ctx, {
  overlay: 'https://overlay.example', // optional; needed for 1Color receipts (submitted there first)
  messageboxUrl: 'https://messagebox.1sat.app', // default
})
```

Lists `transaction-delivery`, verifies each envelope's signature against `sender.identityKey`, decrypts `content`, checks `contentHash`, then internalizes `payment` as a `wallet payment` of output 0 with `paymentRemittance { derivationPrefix, derivationSuffix, senderIdentityKey }`, label `metanet payment`, the memo in the description. BRC-232 transaction deliveries in the same box (1Color tokens, BRC-29 outputs) are processed as the tokens skill describes. A message is acknowledged only after its internalize succeeds; anything else (JSON envelope, bad signature or hash, nothing to internalize) stays in the box and is listed in `skipped` with the reason. `1sat messagebox sync` runs it after the PeerPay sync (pass `--overlay <url>` to receive 1Color tokens; without an overlay, messages with 1Color receipts stay in the box with reason `overlay-required`).

### Message boxes

| Box | Carries | Synced by |
|-----|---------|-----------|
| `transaction-delivery` | BRC-232 deliveries (1Color tokens, BRC-29 outputs) and BRC-169 payments to a handle | `syncTransactionInbox` |
| `payment_inbox` | legacy PeerPay / paymail remittances | `syncMessages` |

### Notes

- **Paymail** sends call `getP2pPaymentDestination` to fetch the recipient's outputs and a reference, then deliver the transaction BEEF P2P (`sendBeefP2P`) after broadcast. The AtomicBEEF returned by `createAction` is converted to plain BEEF (BRC-62) before delivery.
- **fundingProvider**: when set, the provider funds and broadcasts the transaction instead of the wallet. Can be passed at the input level or per-request.
- Returns `{ error: 'no-requests' }` for an empty `requests` array, `{ error: 'invalid-data' }` for malformed OP_RETURN data, and `{ error: 'no-txid-returned' }` if the wallet returns no txid.

## sendAllBsv

Sweep the wallet's entire spendable balance to a single destination address. **Single-phase** like `sendBsv`. `createAction`s one output with `satoshis: 2099999999999999`; storage shrinks that to leftover-after-fee. Call this on the underlying Wallet, not WalletPermissionsManager — WPM rejects the rewritten amount.

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
