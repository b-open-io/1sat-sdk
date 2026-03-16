---
name: wallet-create-ordinals
description: "This skill should be used when a user wants to mint, inscribe, or create an ordinal or NFT on BSV blockchain — such as 'mint this image as an ordinal', 'create an NFT on BSV', 'inscribe this file on-chain', 'how do I create an ordinal collection', 'I want to permanently store a file on blockchain', or 'how much does it cost to mint'. Uses @1sat/actions from the 1sat-sdk to construct and broadcast inscription transactions via a BRC-100 wallet."
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

## Using @1sat/actions (Programmatic)

The `inscribe` action from `@1sat/actions` handles inscription creation:

```typescript
import { inscribe, createContext } from '@1sat/actions'
import { OneSatWallet } from '@1sat/wallet'

// Set up context with BRC-100 wallet
const ctx = createContext(wallet, { chain: 'main' })

// Inscribe a file
const result = await inscribe.execute(ctx, {
  base64Content: btoa(fileContent),   // or readFileSync(path).toString('base64')
  contentType: 'image/png',           // MIME type
  map: {                              // Optional MAP metadata
    app: 'myapp',
    type: 'image',
    name: 'My NFT'
  },
  signWithBAP: true,                  // Optional: sign with BAP identity (Sigma protocol)
})

if (result.txid) {
  console.log('Inscribed:', result.txid)
} else {
  console.error('Error:', result.error)
}
```

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

## Deploying a BSV21 Token

To create (deploy) a new fungible token, use `deployBsv21Token` from `@1sat/core`:

```typescript
import { deployBsv21Token, type DeployBsv21TokenConfig } from '@1sat/core'

// DeployBsv21TokenConfig requires: symbol, icon, utxos, initialDistribution
const result = await deployBsv21Token({
  symbol: 'MYTOKEN',
  decimals: 8,
  icon: iconOutpoint,         // outpoint of icon inscription, or IconInscription object
  utxos: paymentUtxos,
  initialDistribution: {
    address: ownerAddress,
    tokens: 21_000_000,
  },
  destinationAddress: ownerAddress,
  paymentPk: paymentPrivateKey,
  changeAddress: changeAddress,
})
```

## Requirements

- BRC-100 compatible wallet (`@1sat/wallet`, `@1sat/wallet-node`, or `@1sat/wallet-remote`)
- File to inscribe (image, text, etc.)
- `@1sat/actions` for inscription creation; `@1sat/core` for token deployment
- Sufficient BSV balance for inscription cost + fees

## Cost

Inscription cost depends on file size:
- Stored on-chain permanently
- Fee rate is configurable via `satsPerKb` (default varies)
- Larger files = higher cost

## Identity & Provenance

### AIP Signatures for Authorship

Ordinals can include AIP (Author Identity Protocol) signatures to prove authorship via BAP identity. The AIP signature links the ordinal to the creator's BAP identity key — verifiable by anyone on-chain.

```
OP_RETURN | <inscription data> | "|" | AIP_PREFIX | "BITCOIN_ECDSA" | <signing_address> | <signature>
```

The signing address resolves to a BAP identity via the overlay, establishing provenance.

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
