---
name: opns
description: "This skill should be used when working with OpNS decentralized names on BSV — claiming or buying a name at 1sat.name, publishing or removing its wallet identity binding, listing or transferring an owned name, looking up resolution, or managing the OpNS wallet basket. Triggers on 'OpNS', '1sat.name', 'claim name', 'buy name', 'register name', 'decentralized domain', 'name service', 'on-chain DNS', 'identity binding', 'name resolution', 'name profile', 'publish release to name', 'list name', 'transfer name', or 'deregister name'. Uses 1sat.name for acquisition and @1sat/actions for the owned-name lifecycle."
---

# OpNS Names

Claim OpNS names through [1sat.name](https://1sat.name), then publish and manage
the owned name with `@1sat/actions`.

## Distinguish Acquisition from Identity Registration

- **Claim or acquire a name**: mine or buy at [1sat.name](https://1sat.name), or `buyOpns` / `internalizeOpns`.
- **Publish an identity binding**: `registerOpns` on an OpNS UTXO already in the wallet (`id`).

Never pass a bare name string to `registerOpns` as if it creates the name.

## What is OpNS?

- Names are ordinal inscriptions (1-sat) with content type `application/op-ns`
- Published names are locked in the plain signed PushDrop whose fields are key/value pairs: `identity` (pubkey) + `profile` (DAG-CBOR `{ domain, name?, avatar? }`), optionally followed by an inscription. Field codecs are in `@1sat/utils` (`encodeProfile`/`decodeProfile`, `isIdentityKey`, `fieldPairs`); `registerOpns` owns the layout — spec: `docs/protocols/opns-paymail-bind.md`
- Overlay tracks the mine tree; ORDFS resolves ordinal-level state
- Genesis: `58b7558ea379f24266c7e2f5fe321992ad9a724fd7a87423ba412677179ccb25`

## Actions (id-first)

Wallet-owned spends take **`id`** only. Action loads row + BEEF from the OPNS basket.
External buys take **`outpoint`** + optional **`inputBEEF`** (else services fetch).

| Action | Description |
|--------|-------------|
| `listOpns` | List owned names (metadata/tags default; optional BEEF) |
| `internalizeOpns` | File foreign mint AtomicBEEF → OPNS basket + full tags |
| `registerOpns` | Publish identity + profile fields (`{ id, profile: { domain, name?, avatar? }, inscription? }`) |
| `deregisterOpns` | Clear identity bind (`{ id }`) |
| `sellOpns` | List for sale (`{ id, price, payAddress? }`) |
| `sendOpns` | Send to counterparty or address (`{ id, counterparty? \| address? }`) |
| `cancelOpnsListing` | Cancel listing back into OPNS basket (`{ id }`) |
| `buyOpns` | Buy external listing → file OPNS basket (`{ outpoint, inputBEEF?, name?, origin? }`) |


## Claim or Buy at 1sat.name

1. Connect a funded BRC-100 wallet.
2. Search normalized name (1–64 letters, digits, hyphens).
3. Available → paid PoW claim; job id is the BRC-105 payment tx.
4. Track job until mint is internalized into the `opns` basket.
5. Listed → buy via site or `buyOpns` with listing outpoint.
6. **My Names**: register/deregister, sell/cancel, send.

Do not hardcode claim price; use site `GET /price` / job response.

## Register Identity

```typescript
import { createContext, listOpns, registerOpns } from '@1sat/actions'

const ctx = createContext(wallet, { services })

const { outputs } = await listOpns.execute(ctx, { names: ['alice'] })
const row = outputs[0]
if (!row) throw new Error('not owned')

const id = row.tags?.find((t) => t.startsWith('id:'))?.slice(3)
if (!id) throw new Error('missing id: tag')

const result = await registerOpns.execute(ctx, {
  id,
  profile: {
    domain: '1sat.name',   // required: BRC-169 domain (lowercase hostname)
    name: 'Alice',         // optional presentation name
    avatar: 'txid_0',      // optional image ordinal origin (stored as 36 bytes)
  },
})
```

The PushDrop fields are `["identity", <identity key>, "profile", <dag-cbor>, <sig>]`.
Unset optionals are absent from the CBOR map (no placeholders). `profile`
field names are provisional.

### Publish content on the name (optional inscription)

`inscription: { contentType, content }` appends a standard 1-sat inscription
envelope after the PushDrop; ORDFS serves it as the name's latest rev
(`/<origin>:-1`). The action does not interpret the content. A release or
state is an `ordfs/dir` whose `"."` entry points at the root outpoint:

```typescript
import { DIR_CONTENT_TYPE, DIR_VERSION, dirEncode, registerOpns } from '@1sat/actions'

await registerOpns.execute(ctx, {
  id,
  profile: { domain: '1sat.name' },
  inscription: {
    contentType: DIR_CONTENT_TYPE, // 'ordfs/dir'
    content: dirEncode({
      version: DIR_VERSION,
      entries: [{
        name: new TextEncoder().encode('.'),
        isDir: true,
        ref: { kind: 'outpoint', txid: rootTxid, vout: 0 },
      }],
    }),
  },
})
```

Self-moves: `id` → one `loadBasketOutputBeef` → `ordinalSeedTags` + domain tags (`opns`, `opns:published`, listing markers). Stay in OPNS basket. Do **not** use `resolveOrdinalTags` for owned filing.

## Sell / Send / Cancel

```typescript
import { sellOpns, sendOpns, cancelOpnsListing } from '@1sat/actions'

// payAddress optional — default P1SAT keyID `1sat 0`
await sellOpns.execute(ctx, { id, price: 100_000 })

await sendOpns.execute(ctx, { id, address: '1Recipient...' })
// or { id, counterparty: '02abc...' }

await cancelOpnsListing.execute(ctx, { id })
```

Use **`cancelOpnsListing`**, not generic `cancelOrdinalListing`, so filing stays in OPNS.

## Buy External Listing

```typescript
import { buyOpns } from '@1sat/actions'

await buyOpns.execute(ctx, {
  outpoint: 'txid_0',
  // inputBEEF optional if services can fetch
  name: 'alice',
  origin: 'mintTxid_2',
})
```

## Deregister

```typescript
await deregisterOpns.execute(ctx, { id })
```

## Lookup (resolve a name to its identity + profile)

The fields live in the locking script of the name's **current** UTXO: origin
→ ORDFS tip (`-1`) → BEEF → script → decode.

```typescript
import { BeefClient, OpnsClient, OrdfsClient } from '@1sat/client'
import { pushDropDecode } from '@1sat/actions'
import { outpointFromBytes } from '@1sat/templates'
import { IDENTITY_FIELD, PROFILE_FIELD } from '@1sat/types'
import { decodeProfile, fieldPairs, isIdentityKey } from '@1sat/utils'
import { Transaction, Utils } from '@bsv/sdk'

const base = 'https://api.1sat.app'
const { outpoint: origin } = await new OpnsClient(base).getOrigin('alice')
const tip = await new OrdfsClient(base).getMetadata(origin, -1)
const [txid, vout] = tip.outpoint.replace('_', '.').split('.')
const tx = Transaction.fromBEEF(Array.from(await new BeefClient(base).getBeef(txid)))
const { fields } = pushDropDecode(tx.outputs[Number(vout)].lockingScript)
let identityKey: string | undefined
let profile
for (const [key, value] of fieldPairs(fields.slice(0, -1))) { // drop signature
  if (key === IDENTITY_FIELD && isIdentityKey(value)) identityKey = Utils.toHex(value)
  else if (key === PROFILE_FIELD) profile = decodeProfile(value) // unknown keys skipped
}
const avatarOrigin = profile?.avatar && outpointFromBytes(profile.avatar)
```

Decoding does not verify the signature. To trust the result, re-derive the
lock key and verify the field signature as in
`docs/protocols/opns-paymail-bind.md` (`resolvePaymailBind` in
`@1sat/wallet-server` does both). Pre-#83 positional binds do not decode —
treat them as unbound.

## Tags

| Tag | Meaning |
|-----|---------|
| `opns` | OpNS asset |
| `type:application/op-ns` | Content type |
| `opns:published` | Identity currently bound |
| `origin:{outpoint}` | Mint origin |
| `name:{value}` | Name string |
| `id:{…}` | Basket tracking id (required for spends) |
| `ordlock` / `price:{n}` | Listed for sale |

## Requirements

```bash
bun add @1sat/actions @1sat/wallet @bsv/sdk
```
