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
| `fileMandalaDeploy` | Retry a Mandala deploy's filing into its token basket |
| `sendMandala` | Mandala send to a BRC-169 handle (protected noSend, BRC-232 delivery) |
| `syncMandalaInbox` | Receive BRC-232 deliveries from `mandala_inbox` |


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

## Mandala (BRC-162)

Mandala tokens are the BSV-21 token model in a binary script prefix
(`Mandala` template in `@1sat/templates`). Four actions cover the wallet
side: `deployMandala`, `fileMandalaDeploy`, `sendMandala`, `syncMandalaInbox`.

### Names

A token is named by its deploy outpoint. Wallet-side names write it as two
space-separated words, because BRC-43 protocol names allow only letters,
digits and spaces:

| Name | Value | Helper (`@1sat/types`) |
|------|-------|------------------------|
| Basket | `mandala <txid> <vout>` | `mandalaTokenBasket(token)` |
| Key protocol | `[2, 'mandala <txid> <vout>']` | `mandalaProtocol(token)` |
| Action labels | `mandala` and `mandala <txid> <vout>` | `MANDALA_LABEL`, `mandalaTokenLabel(token)` |

`token` is `{ txid, vout }` or an outpoint string, `txid.vout` or `txid_vout`;
the txid is lowercased. `parseMandalaName(name)` recovers `{ txid, vout }`
from any of the three names.

**Outpoints are BRC-36** (`<txid>.<vout>`; BRC-162 defers to BRC-36). The
Mandala actions return tokens in that form (`deployMandala` returns
`tokenId: '<txid>.0'`, `syncMandalaInbox` reports `tokenIds` the same way),
and their inputs also accept the `txid_vout` form the rest of 1Sat emits,
normalizing it. On chain the id is BRC-162's: the 32-byte txid for vout 0.

Labels index tokens (`listActions({ labels: ['mandala'] })` lists what the
wallet tracks; labels survive outputs being spent). The per-token basket
holds the token's outputs. customInstructions carry only the key derivation
(`protocolID`, `keyID`, `counterparty`): amount and id are read from the
script, `sym`/`dec`/`icon` from the deploy payload.

### Deploy

```typescript
import { deployMandala, fileMandalaDeploy } from '@1sat/actions'

// amount > 0: fixed supply; amount 0: authority (first minting authority)
const dep = await deployMandala.execute(ctx, { amount: '21000000', symbol: 'GOLD', decimals: 8 })
// dep.txid, dep.tokenId === `${dep.txid}.0`

// If the filing step failed (dep.error starts with 'file-failed'), retry it:
await fileMandalaDeploy.execute(ctx, { txid: dep.txid!, tx: dep.tx })
```

- One `createAction`: the deploy output at vout 0 (`randomizeOutputs: false`),
  **no basket** (a wallet cannot later move an output out of a basket),
  label `mandala`, broadcast normally. Its key derives under
  `MANDALA_DEPLOY_PROTOCOL` = `[2, 'mandala deploy']`, keyID
  `mandala-deploy-<hex>`, because the outpoint is unknown while it is built.
- Then `internalizeAction` on the same transaction: vout 0 by `basket
  insertion` into `mandala <txid> 0`, same customInstructions, labels
  `mandala` and `mandala <txid> 0`. If it fails, the result carries `txid`,
  `tx` and the error; `fileMandalaDeploy({ txid, tx? })` re-runs it (BEEF from
  `tx`, else `ctx.services.getBeefForTxid`; customInstructions read back with
  `listActions`).
- `overlay` (optional base URL): the deploy is created with `noSend`,
  submitted BRC-22 to `<overlay>/submit` with `X-Topics: tm_mandala,tm_<txid>`,
  then internalized.

### Send (to a BRC-169 handle)

```typescript
import { sendMandala } from '@1sat/actions'

const res = await sendMandala.execute(ctx, {
  tokenId: '<txid>.0', // BRC-36; '<txid>_0' also accepted
  amount: '1000',
  destination: { handle: '@alice@example.com' },
  // expirySeconds: 86400, // default MANDALA_SEND_EXPIRY_SECONDS (one year)
  // memo: 'thanks',
})
// res.delivered === 'envelope', res.messageId, res.txid, res.tx (Atomic BEEF)
```

1. Resolve the handle (BRC-169 §5): identity key and messagebox.
2. If no single output in the token's basket holds exactly `amount`, split
   first: an ordinary broadcast action into an exact output and a remainder,
   both back to the wallet under `mandalaProtocol(token)`.
3. The protected send: one `createAction` with exactly one input (the exact
   output) and one output, locked to the key derived under
   `mandalaProtocol(token)` with keyID `<derivationPrefix> <derivationSuffix>`
   (fresh random base64, BRC-29 style) and counterparty = the recipient.
   `noSend`, labels `mandala`, `mandala <txid> <vout>` and
   `p nosend expiry seconds <n>` (BRC-177; the wallet funds it). Not
   broadcast: the recipient broadcasts by internalizing.
4. Deliver a signed BRC-169 §7.3 envelope (DAG-CBOR, BRC-231 over BRC-104) to
   the resolved messagebox, box **`mandala_inbox`** (`MANDALA_INBOX`), with
   `payment: null`. `content` is BRC-78 encryption of a MIME entity,
   `Content-Type: application/vnd.metanet.transaction+cbor`, whose DAG-CBOR
   body is the BRC-232 delivery
   `{ memo?, txid: bstr(32), beef, outputs: [{ outputIndex, protocol: 'basket insertion', protocolID, keyID, counterparty: <sender identity key> }] }`.
   `contentHash` is the SHA-256 of the MIME bytes.

If delivery fails, the result carries `txid` and `tx` with the error, so the
caller can retry delivery or `abortAction` the send.

### Receive

```typescript
import { syncMandalaInbox } from '@1sat/actions'

const { received, skipped } = await syncMandalaInbox.execute(ctx, {
  messageboxUrl: 'https://messagebox.example', // default https://messagebox.1sat.app
})
```

Lists `mandala_inbox` (BRC-231), and for each message: decodes the DAG-CBOR
envelope, verifies its signature against `sender.identityKey`, decrypts
`content`, checks `contentHash`, parses the MIME entity, requires the
BRC-232 content type, and internalizes the body's outputs: `wallet payment`
with its `paymentRemittance`; `basket insertion` under a `mandala <txid>
<vout>` protocol into that basket with the triple as customInstructions and
labels `mandala` + `mandala <txid> <vout>`, after checking the output's
script names the same token. A message is internalized whole or not at all
and acknowledged only after its internalize succeeds; anything else (other
content types or protocolIDs, a token mismatch, a bad signature, JSON
envelopes) stays in the box and is reported in `skipped`. SPV is
`internalizeAction`'s.

References: BRC-162 (Mandala), BRC-36 (outpoints), BRC-169 (handles, envelope), BRC-232
(transaction delivery, draft: bsv-blockchain/BRCs#300), BRC-177 (`noSend`
expiry), BRC-231 (binary message relay), BRC-78 (encrypted messages).

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @1sat/templates @bsv/sdk
```
