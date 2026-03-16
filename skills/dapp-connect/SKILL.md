---
name: dapp-connect
description: "This skill should be used when building a dApp that connects to a 1Sat wallet — using @1sat/connect for wallet connection via popup or browser extension, @1sat/react for React hooks and ConnectButton, or @1sat/extension for building browser wallet extensions. Triggers on 'connect wallet', 'dApp integration', 'wallet provider', 'ConnectButton', 'React hooks', 'useBalance', 'useOrdinals', 'browser extension', 'popup wallet', 'window.onesat', or 'OneSatProvider'."
---

# dApp Connect

Build dApps that connect to 1Sat wallets using `@1sat/connect` (vanilla JS) and `@1sat/react` (React).

## Quick Start (React)

```tsx
import { OneSatProvider, ConnectButton, useBalance, useOrdinals } from '@1sat/react'

function App() {
  return (
    <OneSatProvider appName="My dApp">
      <ConnectButton />
      <Dashboard />
    </OneSatProvider>
  )
}

function Dashboard() {
  const { satoshis } = useBalance()
  const { ordinals } = useOrdinals()

  return (
    <div>
      <p>Balance: {satoshis} sats</p>
      <p>Ordinals: {ordinals?.length}</p>
    </div>
  )
}
```

## Vanilla JS

```typescript
import { createOneSat } from '@1sat/connect'

// Auto-detects extension or falls back to popup
const onesat = createOneSat({ appName: 'My dApp' })

// Connect (opens popup if no extension)
const { paymentAddress, ordinalAddress, identityPubKey } = await onesat.connect()

// Check balance
const { satoshis } = await onesat.getBalance()

// Sign a message
const { signature, address } = await onesat.signMessage('Hello world')

// Sign a transaction
const { rawtx, txid } = await onesat.signTransaction({
  rawtx: rawTransactionHex,
  description: 'Payment transaction',
})

// Disconnect
await onesat.disconnect()
```

## Provider Detection

`createOneSat()` detects the wallet automatically:

1. **Browser extension** — If `window.onesat.isOneSat` is true, uses the injected provider
2. **Popup fallback** — Otherwise, creates a popup-based provider

```typescript
import { isOneSatInjected, waitForOneSat, createOneSat } from '@1sat/connect'

// Check immediately
if (isOneSatInjected()) {
  console.log('Extension detected!')
}

// Wait for extension to load (max 3s)
try {
  const provider = await waitForOneSat(3000)
} catch {
  console.log('No extension, using popup')
}

// Or just use createOneSat() which handles detection automatically
const onesat = createOneSat()
```

## React Hooks

All hooks from `@1sat/react`:

| Hook | Returns | Description |
|------|---------|-------------|
| `useOneSatContext()` | `OneSatContextValue` | Provider connection state |
| `useBalance()` | `{ satoshis, usd? }` | BSV balance |
| `useOrdinals()` | `OrdinalOutput[]` | List ordinals |
| `useTokens()` | `TokenOutput[]` | List token outputs |
| `useUtxos()` | `Utxo[]` | List payment UTXOs |
| `useSignTransaction()` | `(req) => Promise<result>` | Sign transactions |
| `useSignMessage()` | `(msg) => Promise<result>` | Sign messages (BSM) |
| `useInscribe()` | `(req) => Promise<result>` | Create inscriptions |
| `useSendOrdinals()` | `(req) => Promise<result>` | Send ordinals |
| `useTransferToken()` | `(req) => Promise<result>` | Transfer tokens |
| `useCreateListing()` | `(req) => Promise<result>` | List ordinals for sale |
| `usePurchaseListing()` | `(req) => Promise<result>` | Buy listed ordinals |
| `useCancelListing()` | `(req) => Promise<result>` | Cancel listings |

## OneSatProvider Interface

The full provider interface available to dApps:

```typescript
interface OneSatProvider {
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

  // Marketplace
  createListing(request: CreateListingRequest): Promise<ListingResult>
  purchaseListing(request: PurchaseListingRequest): Promise<SendResult>
  cancelListing(request: CancelListingRequest): Promise<SendResult>

  // Tokens
  transferToken(request: TransferTokenRequest): Promise<SendResult>

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

## Events

```typescript
onesat.on('connect', (result) => {
  console.log('Connected:', result.paymentAddress)
})

onesat.on('disconnect', () => {
  console.log('Disconnected')
})

onesat.on('accountChange', (result) => {
  console.log('Account changed:', result.paymentAddress)
})
```

## Transport Modes

For popup-based connections, configure the transport:

```typescript
import { createOneSat, createEmbedTransport, createRedirectTransport } from '@1sat/connect'

// Auto-detect best transport
const onesat = createOneSat({ appName: 'My dApp' })

// Or force embed (iframe) transport
const embedTransport = createEmbedTransport({ walletUrl: 'https://1sat.market' })

// Or force redirect transport (for mobile)
const redirectTransport = createRedirectTransport({ walletUrl: 'https://1sat.market' })
```

## Building a Browser Extension

Use `@1sat/extension` to build wallet extensions:

```typescript
// inject.ts - Injects window.onesat into web pages
import { injectOneSatProvider } from '@1sat/extension'
injectOneSatProvider()

// content.ts - Bridges messages between page and extension
import { createContentBridge } from '@1sat/extension'
createContentBridge()

// background.ts - Handles wallet operations
import { createBackgroundHandler, openApprovalPopup } from '@1sat/extension'

const handler = createBackgroundHandler({
  handlers: {
    async connect(request, sender) {
      const approved = await openApprovalPopup('/popup/connect.html')
      if (!approved) throw new UserRejectedError()
      return { paymentAddress, ordinalAddress, identityPubKey }
    },
    async signTransaction(request, sender) { /* ... */ },
    async getBalance(request, sender) { /* ... */ },
    // ... implement all OneSatProvider methods
  }
})
```

## Persistent Connection

```typescript
import { saveConnection, loadConnection, clearConnection } from '@1sat/connect'

// Save after connecting
const result = await onesat.connect()
saveConnection({ paymentAddress: result.paymentAddress, ... })

// Restore on page load
const stored = loadConnection()
if (stored) {
  // Auto-reconnect
}

// Clear on disconnect
clearConnection()
```

## Requirements

```bash
# For vanilla JS dApps
bun add @1sat/connect

# For React dApps
bun add @1sat/react  # includes @1sat/connect

# For building extensions
bun add @1sat/extension
```
