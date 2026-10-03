---
name: tokens
description: "This skill should be used when working with BSV21 fungible tokens — sending tokens, checking token balances, listing token UTXOs, purchasing tokens from marketplace, deploying a fixed-supply token, deploying a mintable token, or minting additional supply. Triggers on 'send tokens', 'token balance', 'BSV21', 'BSV-20', 'fungible token', 'transfer tokens', 'deploy token', 'mint token', 'mintable token', 'token listing', 'buy tokens', or 'token UTXO'. Uses @1sat/actions from the 1sat-sdk."
disable-model-invocation: false
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

External UTXO: BEEF from services/overlay.

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

## Mandala send (BRC-162)

`sendMandala` spends the wallet's Mandala outputs for a token. Every output of a
token, deploy included, lives in its own basket named by the bare token id
(the deploy txid, lowercase hex; `mandalaTokenBasket(tokenId)` in
`@1sat/types`). Tokens are indexed by transaction label, not by basket:
`listActions({ labels: ['mandala'] })` lists tracked tokens, and each token's
actions also carry `mandala:<txid>` (`mandalaTokenLabel`). `sendMandala` adds
both labels, and a future recipient-side flow will internalize received
tokens with the same two labels. Token
change goes back to a wallet-derived key in the token's basket. Its
customInstructions hold only the derivation (`protocolID`, `keyID`); amounts
are read from the script.

```typescript
import { sendMandala } from '@1sat/actions'

// Peer send: not broadcast. Delivered as Atomic BEEF to the recipient's
// payment_inbox; the recipient broadcasts when it internalizes.
const peer = await sendMandala.execute(ctx, {
  tokenId: '<deploy txid>',
  amount: '1000',
  destination: { identityKey: '02abc...', messagebox: 'https://messagebox.example' },
  // expiry: { seconds: 86400 }, // BRC-177; default 7 days
})
// peer.delivered === 'message', peer.messageId, peer.tx (Atomic BEEF)

// Address: broadcast by the wallet.
await sendMandala.execute(ctx, {
  tokenId: '<deploy txid>',
  amount: '1000',
  destination: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
})

// Address via an overlay: submitted (BRC-22) to <overlay>/submit with
// X-Topics: tm_<tokenId> instead of the wallet's broadcast.
await sendMandala.execute(ctx, {
  tokenId: '<deploy txid>',
  amount: '1000',
  destination: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
  overlay: 'https://overlay.example',
})
// delivered === 'overlay'
```

- `overlay` applies only to address destinations. Peer sends never broadcast
  (the recipient does), so `overlay` is ignored there.

- The recipient key is BRC-42 under `MANDALA_PROTOCOL` (`[2, 'mandala']`),
  keyID `<derivationPrefix> <derivationSuffix>`, counterparty = recipient.
- Peer sends are BRC-177 protected `noSend` actions (`p nosend expiry …`
  label): the wallet funds them from one exact anchor output, with no change.
  If the recipient does not broadcast before the expiry, the wallet reclaims
  the anchor; `abortAction` reclaims early.
- The message body is the PeerPay shape plus `protocol`, `outputIndex` and
  `senderIdentityKey`:
  `{ customInstructions: { derivationPrefix, derivationSuffix, protocol: 'mandala' }, transaction, outputIndex, amount: 1, senderIdentityKey }`.
- BRC-169 handle destinations are not wired yet. `resolveHandle`
  (`@1sat/client`) and `signEnvelope` (§7.3 DAG-CBOR envelope) exist for them.

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @1sat/templates @bsv/sdk
```
