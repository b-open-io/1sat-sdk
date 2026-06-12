---
name: signing
description: "This skill should be used when signing messages, authenticating HTTP requests, or doing counterparty cryptography with a BRC-100 wallet. Covers BSM (Bitcoin Signed Message) signing, BRC-77 auth tokens for signed HTTP requests, deriving a counterparty's Type-42 public key (ECDH friend key), and encrypting/decrypting data for a counterparty. Triggers on 'sign message', 'BSM', 'Bitcoin Signed Message', 'auth token', 'BRC-77', 'signed request', 'friend public key', 'Type-42', 'ECDH', 'encrypt for counterparty', 'decrypt from counterparty', or 'shared secret'. Uses @1sat/actions signing module."
---

# Signing

Message signing, request authentication, and counterparty cryptography using `@1sat/actions`.

These actions only call the wallet's signing/key/crypto primitives — none of them build or broadcast transactions, so a plain `createContext(wallet)` is enough (no `services` required). All of them catch errors and return an `error` string rather than throwing.

```typescript
const ctx = createContext(wallet)
```

## signBsm

Signs a message in BSM (Bitcoin Signed Message) format. Hashes the message with `BSM.magicHash`, signs with the message-signing protocol, then returns a compact recoverable signature plus the signing address/pubkey. The `tag` selects the derivation key (`keyID = "${tag.label}:${tag.id}:${tag.domain}"`); without a tag the keyID is `'identity'`.

```typescript
import { createContext, signBsm } from '@1sat/actions'

const ctx = createContext(wallet)

// Input: SignBsmRequest
const res = await signBsm.execute(ctx, {
  message: 'hello world',
  encoding: 'utf8',        // optional: 'utf8' | 'hex' | 'base64' (default 'utf8')
  tag: {                   // optional derivation tag
    label: 'app',
    id: 'session-1',
    domain: 'example.com',
    meta: {},
  },
})

// Result: SignBsmResponse (Partial<SignedMessage> & { error?: string })
// {
//   address?: string       // signing address
//   pubKey?: string        // compressed pubkey hex
//   message?: string       // echoed message
//   sig?: string           // compact recoverable signature, base64
//   derivationTag?: { label; id; domain; meta }
//   error?: string
// }
```

`signBsm` is also referenced in the [../action-patterns](../action-patterns) primer; this is its canonical home.

## getAuthToken

Generates a BRC-77 auth token for signing an HTTP request. It builds the message `requestPath|timestamp|bodyHash` (where `bodyHash` is the hex sha256 of the body, or empty if no body), signs it with a fresh random keyID under protocol `[2, 'message signing']`, and packs a BRC-77 envelope into the returned token.

```typescript
import { createContext, getAuthToken } from '@1sat/actions'

const ctx = createContext(wallet)

// Input: AuthTokenRequest
const res = await getAuthToken.execute(ctx, {
  requestPath: '/api/resource?id=1', // include query params
  body: '{"foo":"bar"}',             // optional
  bodyEncoding: 'utf8',              // optional: 'utf8' | 'hex' | 'base64' (default 'utf8')
  timestamp: '2026-06-11T00:00:00Z', // optional ISO8601, defaults to now
})

// Result: AuthTokenResponse
// {
//   authToken?: string   // "<senderPubKeyHex>|brc77|<timestamp>|<requestPath>|<base64Envelope>"
//   error?: string
// }
```

The token's signature is computed over `requestPath`, `timestamp`, and `bodyHash`, so the verifier must reconstruct the same triple. The envelope is `BRC77_VERSION || senderPubKey || 0x00 || keyID || derSignature`, base64-encoded.

## getFriendPublicKey

Derives a counterparty's public key using Type-42 (BRC-42) key derivation — the ECDH-style "friend key" for a given protocol/keyID against a counterparty identity key. Use this to compute the address/pubkey a counterparty would derive for you (or vice versa) under a shared protocol.

```typescript
import { createContext, getFriendPublicKey } from '@1sat/actions'

const ctx = createContext(wallet)

// Input: FriendPubKeyRequest
const res = await getFriendPublicKey.execute(ctx, {
  friendIdentityKey: '02ab...', // counterparty identity key (compressed hex)
  protocolID: [2, 'my protocol'],
  keyID: 'invoice-42',
})

// Result: FriendPubKeyResponse
// { publicKey?: string; error?: string }
```

Internally calls `wallet.getPublicKey({ protocolID, keyID, counterparty: friendIdentityKey, forSelf: false })`.

## encryptForCounterparty

Encrypts plaintext bytes for a counterparty using Type-42 derived keys. Pass `counterparty: 'self'` to encrypt to your own key.

```typescript
import { createContext, encryptForCounterparty } from '@1sat/actions'

const ctx = createContext(wallet)

// Input: EncryptRequest
const res = await encryptForCounterparty.execute(ctx, {
  plaintext: [/* number[] bytes */],
  protocolID: [2, 'my protocol'],
  keyID: 'message-1',
  counterparty: '02ab...', // identity key hex or 'self'
})

// Result: EncryptResponse
// { ciphertext?: number[]; error?: string }
```

Internally calls `wallet.encrypt({ protocolID, keyID, counterparty, plaintext })`.

## decryptFromCounterparty

Decrypts ciphertext bytes from a counterparty. Use the same `protocolID`, `keyID`, and counterparty the data was encrypted under.

```typescript
import { createContext, decryptFromCounterparty } from '@1sat/actions'

const ctx = createContext(wallet)

// Input: DecryptRequest
const res = await decryptFromCounterparty.execute(ctx, {
  ciphertext: [/* number[] bytes */],
  protocolID: [2, 'my protocol'],
  keyID: 'message-1',
  counterparty: '02ab...', // identity key hex or 'self'
})

// Result: DecryptResponse
// { plaintext?: number[]; error?: string }
```

Internally calls `wallet.decrypt({ protocolID, keyID, counterparty, ciphertext })`.

## Requirements

```bash
bun add @1sat/actions @bsv/sdk
```

These actions need only `createContext(wallet)` — no `services`.
