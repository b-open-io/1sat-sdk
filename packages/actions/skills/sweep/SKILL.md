---
name: sweep
description: "This skill should be used when importing or sweeping assets from an external wallet into a BRC-100 wallet — such as 'import from WIF', 'sweep wallet', 'migrate from Yours wallet', 'import ordinals', 'sweep tokens', 'transfer from old wallet', or 'import private key'. Covers sweeping BSV, ordinals, and BSV21 tokens using @1sat/actions sweep module."
disable-model-invocation: true
---

# Sweep & Import

Import BSV, ordinals, and BSV21 tokens from external wallets into a BRC-100 wallet using WIF private keys.

## Actions Overview

| Action | Description |
|--------|-------------|
| `sweepBsv` | Sweep BSV satoshis from external inputs (via private keys) |
| `sweepOrdinals` | Sweep ordinal inscriptions from external inputs |
| `sweepBsv21` | Sweep BSV21 fungible tokens from external inputs |
| `sweepDeposit` | Claim the wallet's own deposit-basket UTXOs into a funding output |
| `prepareSweepInputs` | Helper to build sweep inputs from indexed outputs |

> `sweepBsv` / `sweepOrdinals` / `sweepBsv21` import **external** UTXOs you control via `PrivateKey`s. `sweepDeposit` is different — it claims plain BSV that already landed in *this* wallet's deposit basket (no external keys), see below.

## Signing Keys

The external-sweep request types take `keys: PrivateKey[]` (from `@bsv/sdk`), parallel to `inputs` — not WIF strings. Convert a WIF first:

```typescript
import { PrivateKey } from '@bsv/sdk'

const key = PrivateKey.fromWif('L1aW4aubDFB7yfDYK...')
// keys[i] signs inputs[i]
```

## Sweep BSV

```typescript
import { sweepBsv, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await sweepBsv.execute(ctx, {
  inputs: [
    {
      outpoint: 'txid_vout',        // Outpoint format: txid_vout
      satoshis: 50000,
      lockingScript: '76a914...88ac', // Hex locking script
    },
  ],
  keys: [key],                  // PrivateKey[] parallel to inputs

  // Optional: sweep specific amount (remainder returned to source)
  amount: 25000,
})

if (result.txid) {
  console.log('Swept:', result.txid)
}
```

`SweepBsvRequest` is `{ inputs: SweepInput[]; keys: PrivateKey[]; amount?: number }`. Returns `SweepBsvResponse`: `{ txid?, beef?, error? }` (`beef` is `number[]`).

### Partial vs Full Sweep

- **No `amount`**: Sweeps all input value (minus fees) into the wallet
- **With `amount`**: Sweeps that amount, returns the rest to the source address

## Sweep Ordinals

```typescript
import { sweepOrdinals, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await sweepOrdinals.execute(ctx, {
  inputs: [
    {
      outpoint: 'txid_vout',
      satoshis: 1,                    // Ordinals are always 1 sat
      lockingScript: '76a914...88ac',
    },
  ],
  keys: [key],                        // PrivateKey[] parallel to inputs
})
```

`SweepOrdinalsRequest` is `{ inputs: SweepInput[]; keys: PrivateKey[] }`. `SweepInput` carries only `outpoint`/`satoshis`/`lockingScript` — content type, origin, and name are resolved from ORDFS internally (bulk metadata lookup), not passed on inputs.

### What Happens During Ordinal Sweep

1. Each ordinal gets a unique derived address via the P1SAT protocol (keyID = the input outpoint)
2. Tags are set from resolved metadata: `type:{contentType}`, `origin:{origin}`, `name:{name}`
3. Custom instructions are stored for future spending
4. OpNS ordinals go to the `opns` basket; others go to `ordinals`
5. BSV-20 tokens are rejected (use `sweepBsv21` instead)
6. Output order is preserved (`randomizeOutputs: false`) to maintain ordinal positions

## Sweep BSV21 Tokens

```typescript
import { sweepBsv21, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const result = await sweepBsv21.execute(ctx, {
  inputs: [
    {
      outpoint: 'txid_vout',
      satoshis: 1,
      lockingScript: '76a914...88ac',
      tokenId: 'deployTxid_0',       // Token ID
      amount: '1000000',             // Token amount as string
    },
    // All inputs MUST be the same tokenId
  ],
  keys: [key],                       // PrivateKey[] parallel to inputs
})
```

`SweepBsv21Request` is `{ inputs: SweepBsv21Input[]; keys: PrivateKey[] }`, where `SweepBsv21Input extends SweepInput` with `tokenId: string` and `amount: string`. Returns `SweepBsv21Response`.

### Token Sweep Details

- All inputs must have the same `tokenId`
- Inputs are validated against the overlay (must be unspent and valid)
- Tokens are consolidated into a single output
- An overlay processing fee is paid automatically
- Transaction is submitted to the overlay for indexing

## Sweep Deposit (own deposit basket)

`sweepDeposit` is not an external import. Inbound plain-BSV payments are parked in the wallet's `DEPOSIT_BASKET` (by `internalizeBeef`) until claimed. `sweepDeposit` spends every deposit-basket UTXO, signs them under the P1SAT protocol, and lets the wallet create a single BRC-29-derived change output in the funding basket. It needs no external keys or WIF.

```typescript
import { sweepDeposit, createContext } from '@1sat/actions'

const ctx = createContext(wallet)

const result = await sweepDeposit.execute(ctx, {
  limit: 50,   // optional cap on UTXOs swept per tx, default 50
})

console.log(`Swept ${result.swept} deposit UTXOs, txid: ${result.txid}`)
```

`SweepDepositInput` is `{ limit?: number }` (default 50). Returns `SweepDepositResult`: `{ txid?: string; swept: number; error? }`. A failed sweep is harmless — the deposits stay in the basket and the next call retries. When the basket is empty it returns `{ swept: 0 }` with no txid.

## Building Sweep Inputs

If you have `IndexedOutput` objects (from the 1sat-stack API), use `prepareSweepInputs`:

```typescript
import { prepareSweepInputs, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })

// Fetch UTXOs from the API
const res = await fetch('https://api.1sat.app/1sat/owner/1Address.../txos')
const utxos = await res.json() // IndexedOutput[]

// Convert to sweep inputs (fetches locking scripts from BEEF)
const inputs = await prepareSweepInputs(ctx, utxos)

// Now use with sweepBsv, sweepOrdinals, or sweepBsv21
```

## Complete Migration Example

```typescript
import {
  sweepBsv, sweepOrdinals, sweepBsv21, prepareSweepInputs, createContext
} from '@1sat/actions'
import { createNodeWallet } from '@1sat/wallet-node'

// 1. Create destination wallet
const { wallet, services } = await createNodeWallet({ mnemonic: newMnemonic })
const ctx = createContext(wallet, { services })

// 2. Fetch all UTXOs from old address
const oldAddress = '1OldAddress...'
const res = await fetch(`https://api.1sat.app/1sat/owner/${oldAddress}/txos`)
const allUtxos = await res.json()

// 3. Separate by type
const bsvUtxos = allUtxos.filter(u => u.satoshis > 1 && !u.data?.bsv21)
const ordUtxos = allUtxos.filter(u => u.satoshis === 1 && u.data?.inscription)
const tokUtxos = allUtxos.filter(u => u.data?.bsv21)

// 4. Build inputs
const bsvInputs = await prepareSweepInputs(ctx, bsvUtxos)
const ordInputs = await prepareSweepInputs(ctx, ordUtxos)
const tokInputs = await prepareSweepInputs(ctx, tokUtxos)

// 5. Sweep each type — keys must be parallel to inputs (one PrivateKey per input)
import { PrivateKey } from '@bsv/sdk'
const key = PrivateKey.fromWif('L1OldWallet...')

if (bsvInputs.length)
  await sweepBsv.execute(ctx, { inputs: bsvInputs, keys: bsvInputs.map(() => key) })
if (ordInputs.length)
  await sweepOrdinals.execute(ctx, { inputs: ordInputs, keys: ordInputs.map(() => key) })

// Group tokens by tokenId
const byToken = Map.groupBy(tokInputs, i => i.tokenId)
for (const [tokenId, inputs] of byToken) {
  await sweepBsv21.execute(ctx, { inputs, keys: inputs.map(() => key) })
}
```

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```

The sweep module requires `services` for BEEF fetching and overlay validation.
