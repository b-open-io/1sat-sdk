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
| `deploy1Color` | 1Color (BRC-162) deploy through the wallet's BRC-207 module: fixed supply or authority |
| `send1Color` | 1Color send to a BRC-169 handle (BRC-177 handoff, BRC-232 delivery) |
| `syncTransactionInbox` | Receive BRC-232 deliveries (and handle payments) from `transaction-delivery` |


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

## 1Color (BRC-162)

1Color tokens are the BSV-21 token model in a binary script prefix
(`OneColor` template in `@1sat/templates`). The wallet's BRC-207 `color`
module (`@bsv/color-permission-module`, registered on the wallet's
permissions manager) keeps custody: it derives the keys, files outputs into
their baskets, selects and signs token inputs, asks for consent and submits
to the overlay. The actions are thin BRC-100 calls: `deploy1Color`,
`send1Color`, and `syncTransactionInbox` to receive.

### Names

An asset is named by its deploy outpoint as the canonical BRC-207 asset id
`<txid>_<vout>` (64 lowercase hex, display order; `_0` included). The wire
names come from `@bsv/color-permission-module`:

| Name | Value | Helper |
|------|-------|--------|
| Value basket | `p color <txid>v<vout>` | `assetBasket(assetId, 'value')` |
| Authority basket | `p color <txid>v<vout> authority` | `assetBasket(assetId, 'authority')` |
| Key protocol | `[2, 'p color <assetTag> <prefixHex> <suffixHex>']`, keyID `color` | `colorProtocolID(assetId, prefix, suffix)`, `COLOR_KEY_ID` |
| Action plan | `p color plan <i> <n> <hex>` labels | `ColorPlan.toLabels(plan)` |
| Overlay topics | `tm_color` (deploys), `tm_color_<assetId>` | `colorTopic(assetId)` |

`assetTag` is `<txid>v<vout>`, or `issue` for a deploy's own key (`ISSUE`),
which it keeps after the asset id exists. `prefixHex`/`suffixHex` are the hex
of the UTF-8 remittance strings (fresh random base64 per output). On chain
the id is BRC-162's: the 32-byte txid for vout 0. Outpoints of UTXOs stay
BRC-36 `<txid>.<vout>`; token ids never use the dot form.

### Deploy

```typescript
import { deploy1Color } from '@1sat/actions'

// amount > 0: fixed supply; amount 0: authority (first minting authority)
const dep = await deploy1Color.execute(ctx, {
  amount: '21000000',
  symbol: 'GOLD',
  decimals: 8,
  // icon: { mediaType: 'image/png', bytes: [...] }, // embedded: ["image/png", bytes]
})
// dep.txid, dep.tx (Atomic BEEF), dep.assetId === `${dep.txid}_0`
```

One `createAction`: output 0 is the deploy, locked to the key derived under
`colorProtocolID(ISSUE, prefix, suffix)`, keyID `color`, counterparty self;
the labels are the plan (`assets: [ISSUE]`, the deploy in `ownedOutputs`,
one `deploy-fixed` or `deploy-authority` operation); `randomizeOutputs:
false`. No basket, no customInstructions on the output. The module files the
signed deploy into its asset basket and submits it to `tm_color` and the
asset topic. The deploy holder is always this wallet.

### Send (to a BRC-169 handle)

```typescript
import { send1Color } from '@1sat/actions'

const res = await send1Color.execute(ctx, {
  assetId: '<txid>_0',
  amount: '1000',
  destination: { handle: '@alice@example.com' },
  // expirySeconds: 86400, // default COLOR_SEND_EXPIRY_SECONDS (one year)
  // memo: 'thanks',
})
// res.delivered === 'envelope', res.messageId, res.txid, res.tx (Atomic BEEF)
```

1. Resolve the handle (BRC-169 §5): identity key and messagebox.
2. Derive the recipient's key under `colorProtocolID(assetId, prefix,
   suffix)`, keyID `color`, counterparty = the recipient, and build the
   value output.
3. One `createAction` with that single output; labels = the plan (`assets:
   [assetId]`, no owned outputs, one `transfer`) plus `p nosend expiry
   seconds <n>` (BRC-177); `noSend`, `randomizeOutputs: false`. The module
   selects the token inputs, splits to the exact amount when needed, signs
   and asks for consent. Not broadcast: the recipient submits it.
4. Deliver a signed BRC-169 §7.3 envelope (DAG-CBOR, BRC-231 over BRC-104) to
   the resolved messagebox, box **`transaction-delivery`**
   (`TRANSACTION_DELIVERY_BOX`), `payment: null`. `content` is BRC-78
   encryption of the BRC-232 MIME entity
   (`Content-Type: application/vnd.metanet.transaction+cbor`,
   `Content-Transfer-Encoding: binary`), whose DAG-CBOR body is
   `{ version: 1, txid, beef, outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'p color <assetTag>', customInstructions } }], lifecycles: [], memo? }`.
   `customInstructions` is exactly
   `{"version":1,"assetId":…,"derivationPrefix":…,"derivationSuffix":…,"senderIdentityKey":…}`.
   `contentHash` is the SHA-256 of the MIME bytes.

If delivery fails, the result carries `txid` and `tx` with the error, so the
caller can retry delivery or `abortAction` the send.

### Receive

```typescript
import { syncTransactionInbox } from '@1sat/actions'

const { received, skipped } = await syncTransactionInbox.execute(ctx, {
  overlay: 'https://overlay.example', // the BRC-22 overlay; no default
  messageboxUrl: 'https://messagebox.example', // default https://messagebox.1sat.app
})
```

Lists `transaction-delivery` (BRC-231). For each message: decodes the
DAG-CBOR envelope, verifies its signature against `sender.identityKey`,
decrypts `content`, checks `contentHash` (required for a delivery), and
decodes the BRC-232 body strictly. A `basket insertion` entry must name a
`p color` basket with the exact receipt instructions above and a 1Color
output of that asset; the transaction is first submitted to
`tm_color_<assetId>` at `overlay`, and the STEAK must admit the received
output (without `overlay`, such a message stays in the box with reason
`overlay-required`). Then one `internalizeAction` with every entry copied verbatim (the
module checks ownership and admission). `wallet payment` entries and
BRC-169 handle payments (`payment` set) are internalized as BRC-29 payments.
A message is internalized whole or not at all and acknowledged only after
its internalize succeeds; anything else stays in the box and is reported in
`skipped`.

References: BRC-162 (tokens), BRC-207 (`color` wallet module), BRC-36
(outpoints), BRC-169 (handles, envelope), BRC-232 (transaction delivery,
revised in bsv-blockchain/BRCs#300), BRC-177 (`noSend` expiry), BRC-231
(binary message relay), BRC-78 (encrypted messages).

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @1sat/templates @bsv/sdk
```
