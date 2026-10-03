# OpNS name record (signed PushDrop)

A published OpNS name carries a **record** on its **current name UTXO**: which
identity the name represents (`identity`), facts about that identity
(`profile`), and optionally an inscription the name publishes. Decided in
[#83](https://github.com/b-open-io/1sat-sdk/issues/83); constants live in
`@1sat/types`, the codec in `@1sat/templates` (`encodeOpnsRecord` /
`decodeOpnsRecord`).

Host billing / paymail server are separate and not specified here.

> The upstream spec `payments.md` in
> [BitcoinSchema/1sat-ordinals](https://github.com/BitcoinSchema/1sat-ordinals)
> (name-service) still describes the positional bind and the old `p 1sat`
> protocol id. It needs the same update as this document.

## Script

```
<lock pubkey> OP_CHECKSIG
"identity" <33-byte identity pubkey>
"profile"  <dag-cbor { domain, displayName?, avatar? }>
<field signature>
OP_2DROP … OP_DROP
[ OP_FALSE OP_IF "ord" OP_1 <content type> OP_0 <content> OP_ENDIF ]   ← optional
```

| Item | Value |
|------|-------|
| Protocol | `P1SAT_PROTOCOL` = `[0, 'onesat']` |
| Counterparty | `anyone` (`OPNS_REGISTER_COUNTERPARTY`) |
| keyID | `opnsRegisterKeyId(inputOutpoint)` → `opns:{txid}_{vout}` of the name UTXO spent to create this output |
| forSelf | `true` |
| Field signature | yes, same derivation; covers the concatenation of every field before it |
| Wallet tag | `opns:published` |

The per-input keyID is what stops a signed record being copied onto another
output. The counterparty must stay `anyone`, or no outsider can derive the
verifying key.

## Fields: key/value pairs

The PushDrop fields (signature excluded) are pairs: a UTF-8 text **key**
followed by its **value**. The key names the value's encoding.

| Key | Value | Required |
|-----|-------|----------|
| `identity` | Raw 33-byte compressed public key (not CBOR) — the claim: this name represents this key | exactly one |
| `profile` | DAG-CBOR map (IPLD deterministic encoding, `@ipld/dag-cbor`) | written by `registerOpns`; optional for readers |

Readers go through the pairs in order and **skip pairs whose key they do not
know**. A record without exactly one `identity` pair, with a dangling key, or
with a malformed known value is not a record. Future concerns append a pair;
they do not restate identity.

### `profile` map

| Field | Type | Notes |
|-------|------|-------|
| `domain` | text | **Required.** A BRC-169 ecosystem domain, lowercase hostname (no scheme, no port). Readers go `https://<domain>/manifest.json` → `metanet.handles.resolve` → messagebox. |
| `displayName` | text | Optional presentation name. |
| `avatar` | bytes (36) | Optional origin outpoint of an image ordinal (txid internal order ‖ vout LE). |

Optional fields are **absent** when unset — no placeholders, no empty values.
Unknown map fields are ignored. A BRC-169 host using OpNS names as handles
serves these as the handle's profile; unlike host-supplied attributes they
are signed by the holder.

The field names inside `profile` are **provisional** (`OPNS_PROFILE_FIELD` in
`@1sat/types`).

## Optional inscription

The same output may carry a standard 1-sat inscription envelope after the
PushDrop (any content type). ORDFS records it as a new rev on the name's
origin chain, so `/<origin>:-1` serves it. Publishing a release or a state is
the caller passing an `ordfs/dir` whose `"."` entry points at the root
outpoint; `registerOpns` does not interpret the content. Without an
inscription the output is the record alone and ORDFS keeps serving the last
rev.

## Verify

1. `OpnsClient.getOrigin(name)` → origin outpoint; `OrdfsClient.getMetadata(origin, -1)` → current outpoint.
2. Load the transaction (BEEF) and the output's locking script.
3. `PushDrop.decode` → fields; pop the trailing signature.
4. `decodeOpnsRecord(fields)` → `identityKey`, `profile`.
5. keyID = `opnsRegisterKeyId(<tx.inputs[0] outpoint>)`.
6. Re-derive the lock pubkey: `ProtoWallet('anyone').getPublicKey({ protocolID, keyID, counterparty: identityKey, forSelf: false })`; it must equal the script's lock pubkey.
7. Verify the field signature over the concatenated fields with the same protocol / keyID / counterparty.

`resolvePaymailBind` in `@1sat/wallet-server` implements this.

## Compatibility

Clean break. The earlier positional bind
(`[identityKey, displayName?, avatarOutpoint?, sig]`) is not read: verifiers
treat it as "no bind". Re-register to publish a record.

## Lifecycle

`registerOpns` creates the record (two phases: the action emits the script
with a zeroed signature field; apply re-locks with the real signature and
carries the inscription envelope over unchanged). Transfer / list / burn /
deregister spend it and re-lock without a record unless registered again.
