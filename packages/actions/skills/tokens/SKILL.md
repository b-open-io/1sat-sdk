---
name: tokens
description: "This skill should be used when working with BSV21 fungible tokens — sending tokens, checking token balances, listing token UTXOs, purchasing tokens from marketplace, deploying a fixed-supply token, deploying a mintable token, or minting additional supply. Triggers on 'send tokens', 'token balance', 'BSV21', 'BSV-20', 'fungible token', 'transfer tokens', 'deploy token', 'mint token', 'mintable token', 'token listing', 'buy tokens', or 'token UTXO'. Uses @1sat/actions from the 1sat-sdk."
disable-model-invocation: true
---

# Token Operations (BSV21)

Send, list, deploy, and mint BSV21 tokens with `@1sat/actions`.
CLI group is **`bsv21`** (was `tokens`).

## Actions

| Action | Description |
|--------|-------------|
| `listBsv21` | List BSV21 token UTXOs |
| `getBsv21Balances` | Aggregated balances by token ID |
| `sendBsv21` | Send by value (tokenId + amounts + destinations) |
| `buyBsv21` | Buy marketplace OrdLock listing |
| `deployBsv21Mint` | Fixed-supply deploy+mint |
| `deployBsv21Auth` | Mintable deploy+auth |
| `mintBsv21` | Spend auth to mint / re-issue / end |
| `deployMandala` | Mandala (BRC-162) deploy: fixed supply or authority |


Fungible API stays **value-based** (not spend-by-id). Basket UTXOs still carry `id:` internally. **Self destinations must be basketed/tagged.**

## Balances

```typescript
import { getBsv21Balances, createContext } from '@1sat/actions'

const ctx = createContext(wallet, { services })
const balances = await getBsv21Balances.execute(ctx, {})

for (const token of balances) {
  const displayAmt = Number(BigInt(token.amt)) / 10 ** token.dec
  console.log(`${token.sym ?? token.id}: ${displayAmt}`)
}
```

## List UTXOs

```typescript
import { listBsv21 } from '@1sat/actions'

const outputs = await listBsv21.execute(ctx, { limit: 100 })
// tags: bsv21:{tokenId}, amt:{amount}, dec:{decimals}, id:…
```

## Send

```typescript
import { sendBsv21 } from '@1sat/actions'

const result = await sendBsv21.execute(ctx, {
  tokenId: 'abc123...def456_0',
  recipients: [
    { amount: '1000000', destination: { counterparty: '02abc...' } },
    { amount: '500000', destination: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' } },
  ],
})
```

Amounts are **raw units** (respect `dec`). Overlay validation requires `services`.

## Buy listing

```typescript
import { buyBsv21 } from '@1sat/actions'

await buyBsv21.execute(ctx, {
  tokenId: 'abc123...def456_0',
  outpoint: 'txid_vout',
  amount: '1000000',
  marketplaceAddress: '1Market...', // optional
  marketplaceRate: 0.02,
})
```

External UTXO: BEEF from services/overlay. OrdLock v2 listings use the same
front-funding layout as `buyOrdinal` (see ordinals-marketplace): funding held
in the `1sat-deposit` basket, payout at the listing's input index, and the
BSV-21 transfer output receiving the listed satoshi.

## Deploy fixed supply

```typescript
import { deployBsv21Mint } from '@1sat/actions'

const result = await deployBsv21Mint.execute(ctx, {
  symbol: 'MYTOKEN',
  amount: '2100000000000000',
  decimals: 8,
  icon: 'iconTxid_0',
})
// result.tokenId
```

## Deploy mintable + mint

```typescript
import { deployBsv21Auth, mintBsv21 } from '@1sat/actions'

const dep = await deployBsv21Auth.execute(ctx, { symbol: 'MINTABLE', decimals: 8 })

await mintBsv21.execute(ctx, {
  tokenId: dep.tokenId!,
  mint: { amount: '1000000', destination: { address: recipient } },
})
```

## Mandala (BRC-162) deploy

```typescript
import { deployMandala } from '@1sat/actions'

// amount > 0: fixed supply; amount 0: authority (first minting authority)
const dep = await deployMandala.execute(ctx, {
  amount: '21000000',
  symbol: 'GOLD',
  decimals: 8,
})
// dep.tokenId === dep.txid
```

- The deploy output is always vout 0. **The token id is the deploy txid alone**
  (the 32-byte wire id) — never `txid_0`.
- Funded through a side door: `createWalletFundingProvider(ctx)` (default; pass
  `fundingProvider` to override) creates one funding UTXO in the `funding`
  basket, builds and broadcasts the deploy spending it, and the wallet then
  internalizes vout 0.
- Filed in the `mandala` basket with tags `mandala:<txid>` and `mandala:deploy`
  (+ `mandala:auth` for an authority deploy). customInstructions carry the key
  derivation plus `amt`/`dec`/`sym`/`icon`.
- `overlay` (optional, an overlay base URL): broadcast the deploy as a BRC-22
  submit to `<overlay>/submit` with `X-Topics: tm_mandala,tm_<txid>` (bare
  comma-separated string) instead of the default broadcaster; a STEAK response
  is success. This `overlay` input is the pattern other broadcasting actions
  will adopt.
- If broadcast succeeds and internalize fails, the wallet never learns of the
  output (known gap).

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @1sat/templates @bsv/sdk
```
