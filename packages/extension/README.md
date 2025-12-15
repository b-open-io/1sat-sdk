# @1sat/extension

Build browser wallet extensions that implement `window.onesat`. This package provides the core primitives so you can focus on your wallet's UI and key management.

## Installation

```bash
bun add @1sat/extension
```

## Quick Start

Create a wallet extension in 4 files:

```
my-wallet/
├── manifest.json
├── src/
│   ├── inject.ts      # Creates window.onesat
│   ├── content.ts     # Bridges page ↔ background
│   └── background.ts  # Handles requests
└── popup/
    └── index.html     # Your approval UI
```

### 1. Inject Script (inject.ts)

```typescript
import { injectOneSatProvider } from '@1sat/extension'

// Creates window.onesat with all OneSatProvider methods
injectOneSatProvider()
```

That's it. The provider automatically routes all method calls through your content script to the background.

### 2. Content Script (content.ts)

```typescript
import { createContentBridge } from '@1sat/extension'

// Bridges postMessage from page to chrome.runtime
createContentBridge()
```

### 3. Background Script (background.ts)

```typescript
import { createBackgroundHandler, openApprovalPopup } from '@1sat/extension'

createBackgroundHandler({
  // Called for every request - return true to auto-approve, false to show popup
  shouldAutoApprove: (request) => {
    // Auto-approve read-only methods
    return ['getBalance', 'getOrdinals', 'getUtxos'].includes(request.method)
  },

  // Your wallet implementation
  handlers: {
    async connect(request, sender) {
      // Show connection approval popup
      const approved = await openApprovalPopup('/popup/connect.html', {
        origin: sender.origin,
        favIconUrl: sender.tab?.favIconUrl,
      })

      if (!approved) {
        throw new Error('User rejected connection')
      }

      // Return your wallet's addresses
      return {
        paymentAddress: await getPaymentAddress(),
        ordinalAddress: await getOrdinalAddress(),
        identityPubKey: await getIdentityPubKey(),
      }
    },

    async signMessage(request) {
      const { message } = request.params

      // Show signing approval
      const approved = await openApprovalPopup('/popup/sign.html', { message })
      if (!approved) throw new Error('User rejected')

      // Sign with your wallet
      return signBsm(message)
    },

    async signTransaction(request) {
      const { rawtx, broadcast } = request.params

      // Show transaction approval
      const approved = await openApprovalPopup('/popup/transaction.html', { rawtx })
      if (!approved) throw new Error('User rejected')

      // Sign the transaction
      const signed = await signTx(rawtx)

      // Optionally broadcast
      if (broadcast) {
        await broadcastTx(signed)
      }

      return {
        rawtx: signed.toHex(),
        txid: signed.id('hex'),
      }
    },

    async getBalance() {
      // No approval needed - just return data
      return { satoshis: await fetchBalance() }
    },

    // ... implement other methods
  },
})
```

### 4. Manifest (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "My Wallet",
  "version": "1.0.0",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["<all_urls>"],

  "background": {
    "service_worker": "dist/background.js",
    "type": "module"
  },

  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["dist/content.js"],
    "run_at": "document_start"
  }],

  "web_accessible_resources": [{
    "resources": ["dist/inject.js"],
    "matches": ["<all_urls>"]
  }],

  "action": {
    "default_popup": "popup/index.html"
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Web Page                                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ dApp code                                                    ││
│  │ const onesat = window.onesat                                 ││
│  │ await onesat.connect()                                       ││
│  │ onesat.on('accountChange', handler)                          ││
│  └──────────────────────────┬──────────────────────────────────┘│
│                             │                          ▲         │
│  ┌──────────────────────────▼──────────────────────────│────────┐│
│  │ inject.ts (window.onesat)                           │        ││
│  │ Requests → postMessage              Events ← listen │        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────┬──────────────────────────▲────────┘
                              │                          │
                     Requests │                          │ Events
                              ▼                          │
┌─────────────────────────────────────────────────────────────────┐
│  content.ts (Content Script)                                     │
│  Bidirectional relay: page ↔ extension                           │
└─────────────────────────────┬──────────────────────────▲────────┘
                              │                          │
          chrome.runtime.send │                          │ chrome.tabs.sendMessage
                              ▼                          │
┌─────────────────────────────────────────────────────────────────┐
│  background.ts (Service Worker)                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ handlers: { connect, sign, send, ... }                       ││
│  │ broadcast('accountChange', data) → all connected tabs        ││
│  └─────────────────────────────────────────────────────────────┘│
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────────┐│
│  │ Approval Popup (when needed)                                 ││
│  │ Your React/HTML UI for user confirmation                     ││
│  │ approveRequest() / rejectRequest()                           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Request Flow:** dApp → inject → content → background → handler → popup → response
**Event Flow:** background.broadcast() → content → inject → dApp event handlers

## API Reference

### injectOneSatProvider(options?)

Injects `window.onesat` into the page. Call this from your inject script.

```typescript
import { injectOneSatProvider } from '@1sat/extension'

injectOneSatProvider({
  // Optional: Add custom properties to the provider
  walletName: 'My Wallet',
  walletVersion: '1.0.0',
})
```

The injected provider implements the full `OneSatProvider` interface:

```typescript
interface OneSatProvider {
  readonly isOneSat: true

  // Connection
  connect(): Promise<ConnectResult>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Signing
  signTransaction(request: SignTransactionRequest): Promise<SignTransactionResult>
  signMessage(message: string): Promise<SignMessageResult>

  // Ordinals
  inscribe(request: InscribeRequest): Promise<InscribeResult>
  sendOrdinals(request: SendOrdinalsRequest): Promise<SendResult>

  // Tokens
  transferToken(request: TransferTokenRequest): Promise<SendResult>

  // Listings (optional)
  createListing(request: CreateListingRequest): Promise<ListingResult>
  purchaseListing(request: PurchaseListingRequest): Promise<SendResult>
  cancelListing(request: CancelListingRequest): Promise<SendResult>

  // Read-only
  getBalance(): Promise<BalanceResult>
  getOrdinals(options?: ListOptions): Promise<OrdinalOutput[]>
  getTokens(options?: ListOptions): Promise<TokenOutput[]>
  getUtxos(): Promise<Utxo[]>

  // Events
  on(event: OneSatEvent, handler: EventHandler): void
  off(event: OneSatEvent, handler: EventHandler): void

  // Utility
  getAddresses(): { paymentAddress: string; ordinalAddress: string } | null
  getIdentityPubKey(): string | null
}
```

### createContentBridge(options?)

Creates the content script bridge. Handles all message routing automatically.

```typescript
import { createContentBridge } from '@1sat/extension'

createContentBridge({
  // Optional: Filter which origins can communicate
  allowedOrigins: ['https://1sat.market', 'https://myapp.com'],

  // Optional: Log messages for debugging
  debug: process.env.NODE_ENV === 'development',
})
```

### createBackgroundHandler(config)

Sets up the background service worker to handle requests. Returns a `broadcast` function for emitting events to connected pages.

```typescript
import { createBackgroundHandler } from '@1sat/extension'

const { broadcast } = createBackgroundHandler({
  // Determine if request needs user approval
  shouldAutoApprove: (request) => boolean,

  // Your method implementations
  handlers: {
    connect: async (request, sender) => ConnectResult,
    disconnect: async (request, sender) => void,
    signTransaction: async (request, sender) => SignTransactionResult,
    signMessage: async (request, sender) => SignMessageResult,
    inscribe: async (request, sender) => InscribeResult,
    sendOrdinals: async (request, sender) => SendResult,
    transferToken: async (request, sender) => SendResult,
    createListing: async (request, sender) => ListingResult,
    purchaseListing: async (request, sender) => SendResult,
    cancelListing: async (request, sender) => SendResult,
    getBalance: async (request, sender) => BalanceResult,
    getOrdinals: async (request, sender) => OrdinalOutput[],
    getTokens: async (request, sender) => TokenOutput[],
    getUtxos: async (request, sender) => Utxo[],
  },

  // Handle events (optional)
  onConnect: (tabId, origin) => void,
  onDisconnect: (tabId, origin) => void,
})

// Later, when user switches account in your UI:
broadcast('accountChange', {
  paymentAddress: newPaymentAddress,
  ordinalAddress: newOrdinalAddress
})
```

### openApprovalPopup(path, data?)

Opens a popup window for user approval. Returns a promise that resolves when the user responds.

```typescript
import { openApprovalPopup } from '@1sat/extension'

// In your handler
async signMessage(request) {
  const approved = await openApprovalPopup('/popup/sign.html', {
    message: request.params.message,
    origin: request.origin,
  })

  if (!approved) {
    throw new UserRejectedError()
  }

  return sign(request.params.message)
}
```

In your popup HTML/React:

```typescript
import { getApprovalData, approveRequest, rejectRequest } from '@1sat/extension/popup'

// Get the data passed to the popup
const data = await getApprovalData()
console.log(data.message, data.origin)

// User clicks approve
document.getElementById('approve').onclick = () => approveRequest()

// User clicks reject
document.getElementById('reject').onclick = () => rejectRequest()
```

### Storage Helpers

Utilities for managing connected sites and wallet state. Uses `chrome.storage.local` for persistence across service worker restarts.

```typescript
import {
  ConnectedSites,
  WalletState,
} from '@1sat/extension/storage'

// Manage connected sites - persisted across sessions
await ConnectedSites.add(origin, { permissions: ['sign'] })
await ConnectedSites.remove(origin)
await ConnectedSites.isConnected(origin)  // Check before auto-approving
await ConnectedSites.getAll()

// Wallet state (you manage the actual keys)
await WalletState.setAddresses({ paymentAddress, ordinalAddress })
await WalletState.getAddresses()
await WalletState.clear()
```

### Session Persistence

Connected sites are automatically persisted. Use this in your handlers:

```typescript
async connect(request, sender) {
  const origin = sender.origin!

  // Check if already connected
  if (await ConnectedSites.isConnected(origin)) {
    // Return cached addresses without showing popup
    return WalletState.getAddresses()
  }

  // Show approval popup for new connections
  const approved = await openApprovalPopup('/popup/connect.html', { origin })
  if (!approved) throw new UserRejectedError()

  // Save connection
  await ConnectedSites.add(origin, { permissions: ['sign', 'inscribe'] })

  return {
    paymentAddress: await getPaymentAddress(),
    ordinalAddress: await getOrdinalAddress(),
    identityPubKey: await getIdentityPubKey(),
  }
}

async disconnect(request, sender) {
  await ConnectedSites.remove(sender.origin!)
  broadcast('disconnect', {})
}
```

## Manifest V3 Service Worker Handling

Chrome's Manifest V3 terminates service workers after 30 seconds of inactivity. This package handles this automatically:

1. **Pending requests are persisted** to `chrome.storage.session`
2. **When popup responds**, the service worker wakes and retrieves the pending request
3. **Responses are delivered** even if the original service worker context died

```typescript
// This "just works" - you don't need to handle it manually
const approved = await openApprovalPopup('/popup/sign.html', { message })
// Even if popup is open for 5 minutes, this resolves correctly
```

For long-running operations in your handlers, use the keep-alive helper:

```typescript
import { keepAlive } from '@1sat/extension'

async signTransaction(request) {
  // Prevents service worker termination during this operation
  return keepAlive(async () => {
    const approved = await openApprovalPopup('/popup/sign.html')
    if (!approved) throw new Error('Rejected')
    return await signTx(request.params.rawtx)
  })
}
```

## Events

The provider emits events that dApps can listen to. Your background script should emit these at appropriate times using the `broadcast()` function.

### Provider Events

| Event | When to Emit | Data |
|-------|-------------|------|
| `connect` | After user approves connection | `{ paymentAddress, ordinalAddress, identityPubKey }` |
| `disconnect` | After disconnect() or user revokes in wallet UI | `{}` |
| `accountChange` | When user switches account in wallet UI | `{ paymentAddress, ordinalAddress }` |

### Emitting Events

```typescript
const { broadcast } = createBackgroundHandler({
  handlers: {
    async connect(request, sender) {
      // ... approval logic ...
      const result = { paymentAddress, ordinalAddress, identityPubKey }

      // Event is emitted automatically on successful connect
      return result
    },
  },
})

// When user switches account in your wallet UI:
broadcast('accountChange', {
  paymentAddress: newPaymentAddress,
  ordinalAddress: newOrdinalAddress,
})

// When user disconnects via your wallet UI:
broadcast('disconnect', {})
```

### Detecting Provider Ready

The inject script dispatches a `onesat:ready` event after initial state sync:

```typescript
// In your dApp
if (window.onesat) {
  // Provider already available
  startApp()
} else {
  // Wait for provider
  window.addEventListener('onesat:ready', startApp)
}

function startApp() {
  // Safe to use window.onesat
  const connected = window.onesat.isConnected()
  const addresses = window.onesat.getAddresses()
}
```

## Error Handling

The package uses standardized error codes compatible with JSON-RPC:

```typescript
import {
  UserRejectedError,     // 4001 - User rejected the request
  UnauthorizedError,     // 4100 - Not connected to this origin
  UnsupportedMethodError, // 4200 - Method not implemented
  DisconnectedError,     // 4900 - Wallet is disconnected
} from '@1sat/extension'

// In your handlers
async signMessage(request, sender) {
  if (!await ConnectedSites.isConnected(sender.origin!)) {
    throw new UnauthorizedError('Please connect first')
  }

  const approved = await openApprovalPopup('/popup/sign.html')
  if (!approved) {
    throw new UserRejectedError()  // Sends { code: 4001, message: 'User rejected' }
  }

  return sign(request.params.message)
}

// Methods you haven't implemented
async createListing() {
  throw new UnsupportedMethodError('Listings not supported')
}
```

Errors are automatically serialized and sent back to the dApp:

```typescript
// In the dApp
try {
  await onesat.signMessage('hello')
} catch (err) {
  if (err.code === 4001) {
    console.log('User rejected')
  }
}
```

## Building Your Extension

### With Bun

```bash
# Bundle all entry points
bun build src/inject.ts --outdir dist
bun build src/content.ts --outdir dist
bun build src/background.ts --outdir dist

# Or use a build script
bun run build
```

### With Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [crx({ manifest })],
})
```

### Load in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select your extension directory

## Example: Minimal Wallet

See [`examples/minimal-wallet`](../../examples/minimal-wallet) for a complete working example with:

- Single-key wallet (auto-generated)
- Connect and sign message approval popups
- Balance display via WhatsOnChain API
- Connected sites management UI
- Test page for integration testing

Here's a simplified version:

```typescript
// background.ts
import { createBackgroundHandler, openApprovalPopup } from '@1sat/extension'
import { PrivateKey } from '@bsv/sdk'

let privateKey: PrivateKey | null = null

createBackgroundHandler({
  shouldAutoApprove: (req) => ['getBalance', 'getAddresses'].includes(req.method),

  handlers: {
    async connect(request, sender) {
      if (!privateKey) {
        // First time - generate or import key
        const approved = await openApprovalPopup('/popup/setup.html')
        if (!approved) throw new Error('Setup cancelled')
        privateKey = PrivateKey.fromRandom()
      }

      const address = privateKey.toAddress().toString()
      return {
        paymentAddress: address,
        ordinalAddress: address,
        identityPubKey: privateKey.toPublicKey().toString(),
      }
    },

    async signMessage(request) {
      if (!privateKey) throw new Error('Not connected')

      const approved = await openApprovalPopup('/popup/sign.html', {
        message: request.params.message,
      })
      if (!approved) throw new Error('Rejected')

      const sig = privateKey.sign(request.params.message)
      return {
        message: request.params.message,
        signature: sig.toString(),
        address: privateKey.toAddress().toString(),
      }
    },

    async getBalance() {
      // Fetch from indexer
      const address = privateKey?.toAddress().toString()
      const res = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/balance`)
      const data = await res.json()
      return { satoshis: data.confirmed + data.unconfirmed }
    },

    // ... other handlers
  },
})
```

## Testing

Test your extension with any dApp using the 1sat SDK:

```typescript
// In a dApp
import { createOneSat } from '@1sat/sdk'

const onesat = createOneSat({ appName: 'Test App' })

// If your extension is installed, this uses it
// Otherwise falls back to popup wallet
const { paymentAddress } = await onesat.connect()
console.log('Connected:', paymentAddress)
```

## TypeScript

Full TypeScript support included. Import types as needed:

```typescript
import type {
  OneSatProvider,
  ConnectResult,
  SignTransactionRequest,
  SignTransactionResult,
  SignMessageResult,
  InscribeRequest,
  InscribeResult,
  SendOrdinalsRequest,
  SendResult,
  BalanceResult,
  OrdinalOutput,
  TokenOutput,
  Utxo,
  OneSatEvent,
  ExtensionRequest,
  ExtensionResponse,
} from '@1sat/extension'
```

## Related

- [@1sat/sdk](../sdk) - Main SDK for dApps
- [@1sat/connect](../connect) - Popup wallet connection
- [1sat.market](https://1sat.market) - Reference wallet implementation

## License

MIT
