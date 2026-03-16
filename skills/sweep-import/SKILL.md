---
name: sweep-import
description: "This skill should be used when importing or sweeping assets from an external wallet into a BRC-100 wallet — such as 'import from WIF', 'sweep wallet', 'migrate from Yours wallet', 'import ordinals', 'sweep tokens', 'transfer from old wallet', or 'import private key'. Covers sweeping BSV, ordinals, and BSV21 tokens using @1sat/actions sweep module."
disable-model-invocation: true
---

# Sweep & Import

Import BSV, ordinals, and BSV21 tokens from external wallets into a BRC-100 wallet using WIF private keys.

## Actions Overview

| Action | Description |
|--------|-------------|
| `sweepBsv` | Sweep BSV satoshis from external inputs |
| `sweepOrdinals` | Sweep ordinal inscriptions from external inputs |
| `sweepBsv21` | Sweep BSV21 fungible tokens from external inputs |
| `prepareSweepInputs` | Helper to build sweep inputs from indexed outputs |

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
  wif: 'L1aW4aubDFB7yfDYK...',  // WIF private key controlling the inputs

  // Optional: sweep specific amount (remainder returned to source)
  amount: 25000,
})

if (result.txid) {
  console.log('Swept:', result.txid)
}
```

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
      contentType: 'image/png',       // Optional: content type
      origin: 'originTxid_0',        // Optional: origin outpoint
      name: 'My NFT',                // Optional: name from MAP metadata
    },
  ],
  wif: 'L1aW4aubDFB7yfDYK...',
})
```

### What Happens During Ordinal Sweep

1. Each ordinal gets a unique derived address via `ONESAT_PROTOCOL`
2. Tags are preserved: `type:{contentType}`, `origin:{origin}`, `name:{name}`
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
  wif: 'L1aW4aubDFB7yfDYK...',
})
```

### Token Sweep Details

- All inputs must have the same `tokenId`
- Inputs are validated against the overlay (must be unspent and valid)
- Tokens are consolidated into a single output
- An overlay processing fee is paid automatically
- Transaction is submitted to the overlay for indexing

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

// 5. Sweep each type
const wif = 'L1OldWallet...'

if (bsvInputs.length) await sweepBsv.execute(ctx, { inputs: bsvInputs, wif })
if (ordInputs.length) await sweepOrdinals.execute(ctx, { inputs: ordInputs, wif })

// Group tokens by tokenId
const byToken = Map.groupBy(tokInputs, i => i.tokenId)
for (const [tokenId, inputs] of byToken) {
  await sweepBsv21.execute(ctx, { inputs, wif })
}
```

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```

The sweep module requires `services` for BEEF fetching and overlay validation.
