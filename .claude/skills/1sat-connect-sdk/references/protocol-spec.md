# @1sat/connect Protocol Specification

## Message Types

All messages use `type: 'onesat'` and `version: 1` for identification.

### Request Message (dApp → Popup)

Sent via URL search params when opening the popup, not via postMessage.

```
https://www.1satwallet.com/connect
  ?method=connect
  &requestId=uuid-v4
  &origin=https://mydapp.com
  &appName=My%20dApp
  &params={"challenge":"..."}
```

| Param | Required | Description |
|---|---|---|
| `method` | Yes | RPC method name (connect, signMessage, etc.) |
| `requestId` | Yes | UUID v4 for matching response |
| `origin` | Yes | dApp origin for postMessage targeting |
| `appName` | No | Display name shown in approval UI |
| `params` | No | JSON-encoded method parameters |

### Response Message (Popup → dApp)

Sent via `window.opener.postMessage()`:

```typescript
// Success
{
  type: 'onesat',
  version: 1,
  requestId: 'uuid-v4',
  result: { paymentAddress: '...', ordinalAddress: '...', identityPubKey: '...' }
}

// Error
{
  type: 'onesat',
  version: 1,
  requestId: 'uuid-v4',
  error: { code: 4001, message: 'User rejected' }
}
```

## RPC Methods

### connect

**Params**: `{ challenge?: string }`
**Result**: `{ paymentAddress, ordinalAddress, identityPubKey, signedMessage? }`

When `challenge` is provided, `signedMessage` contains:
```typescript
{
  message: string     // The challenge string
  signature: string   // BSM compact signature (base64)
  address: string     // The signing address (ordinal address)
}
```

BSM signing uses the ordinal private key (`walletKeys.ordPk`).

### signMessage

**Params**: `{ message: string }`
**Result**: `{ message, signature, address }`

BSM (Bitcoin Signed Message) format. Opens a separate popup.

### signTransaction

**Params**: `{ rawtx: string, description?: string }`
**Result**: `{ rawtx: string, txid: string }`

### inscribe

**Params**: `{ dataB64: string, contentType: string, destinationAddress?: string, metaData?: Record<string, string> }`
**Result**: `{ txid: string, origin: string }`

### getBalance

**Params**: none
**Result**: `{ satoshis: number, usd?: number }`

### getOrdinals

**Params**: `{ limit?: number, offset?: number }`
**Result**: `OrdinalOutput[]`

### getTokens

**Params**: `{ limit?: number, offset?: number }`
**Result**: `TokenOutput[]`

### getUtxos

**Params**: none
**Result**: `Utxo[]`

### sendOrdinals

**Params**: `{ outpoints: string[], destinationAddress: string }`
**Result**: `{ txid: string }`

### createListing / purchaseListing / cancelListing

Marketplace operations for ordinal listings.

### transferToken

**Params**: `{ tokenId: string, amount: string, destinationAddress: string }`
**Result**: `{ txid: string }`

## Security Considerations

### Origin Validation

The wallet popup validates `event.origin` against the `origin` parameter from the URL.
Messages from non-matching origins are silently dropped. This prevents cross-origin attacks.

### Challenge Verification (Server-Side)

When using the challenge pattern, the server should:

1. Parse the challenge to extract timestamp and path
2. Verify the timestamp is recent (within 5 minutes)
3. Verify the path matches the expected endpoint
4. Verify the BSM signature using `@bsv/sdk`
5. Recover the public key from the signature
6. Derive the address and compare with the signed address

```typescript
import { BSM, Signature, Utils, BigNumber } from '@bsv/sdk'

const messageBytes = Utils.toArray(message)
const sig = Signature.fromCompact(signatureBase64, 'base64')
const msgHash = BSM.magicHash(messageBytes)

for (let recovery = 0; recovery < 4; recovery++) {
  const candidate = sig.RecoverPublicKey(recovery, new BigNumber(msgHash))
  if (candidate.toAddress().toString() === expectedAddress) {
    return candidate.toString() // hex pubkey
  }
}
```

### Popup Lifecycle

- Popup is tracked via `setInterval` checking `popup.closed` every 500ms
- If popup closes without responding, `PopupClosedError` is thrown
- 5-minute timeout prevents indefinite hangs
- Cleanup runs on timeout, close, or response: clears timers, closes popup if still open
