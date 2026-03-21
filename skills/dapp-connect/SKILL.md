---
name: dapp-connect
description: "This skill should be used when building a dApp that connects to a 1Sat wallet — using @1sat/connect for wallet connection via popup or browser extension, @1sat/react for React hooks and components, or integrating with the BigBlocks shadcn registry. Triggers on 'connect wallet', 'dApp integration', 'wallet provider', 'ConnectButton', 'WalletProvider', 'useWallet', 'ConnectDialog', 'SigmaCallback', 'browser extension', 'popup wallet', 'BRC-100', 'Sigma OAuth', 'BigBlocks registry', or 'shadcn wallet components'."
---

# dApp Connect

Build dApps that connect to 1Sat wallets using `@1sat/connect` (vanilla JS) and `@1sat/react` (React).

## Architecture

```
@1sat/react (React components + hooks)
  └── @1sat/connect (Core connection logic)
        ├── BRC-100 auto-detection (extensions, Cicada, localhost, XDM)
        ├── Sigma OAuth (browser redirect flow)
        └── OneSat popup (iframe/redirect transport)
```

## Quick Start (React)

```tsx
import { WalletProvider, ConnectButton } from '@1sat/react'

function App() {
  return (
    <WalletProvider appName="My dApp">
      <ConnectButton />
      <Dashboard />
    </WalletProvider>
  )
}

function Dashboard() {
  const { wallet, status, identityKey } = useWallet()
  if (status !== 'connected' || !wallet) return <p>Not connected</p>
  return <p>Connected: {identityKey?.slice(0, 8)}...</p>
}
```

## React Components

All components from `@1sat/react` are **deliberately unstyled** — they provide functional primitives with minimal inline styles. Themed UI wrappers are distributed via the [BigBlocks registry](https://registry.bigblocks.dev) as shadcn-compatible registry items.

### WalletProvider

App-level context provider. Wrap the application root.

```tsx
<WalletProvider
  appName="My dApp"               // Shown in wallet approval
  autoReconnect={true}             // Auto-reconnect on mount
  providers={customProviders}      // Custom wallet providers (optional)
>
  {children}
</WalletProvider>
```

### ConnectButton

Unstyled button that triggers wallet connection. Supports render-prop children for full customization.

```tsx
<ConnectButton
  className="my-button"
  connectLabel="Connect"
  connectingLabel="Connecting..."
  connectedLabel={(key) => `${key.slice(0,6)}...${key.slice(-4)}`}
  onConnect={(result) => console.log(result)}
  onDisconnect={() => console.log('disconnected')}
  disconnectOnClick={true}          // Click to disconnect when connected
/>
```

### ConnectDialog

Controlled dialog for wallet provider selection. Requires `open` and `onOpenChange` props.

```tsx
<ConnectDialog
  open={isOpen}
  onOpenChange={setIsOpen}
>
  {({ providers, connect }) => (
    <div>
      {providers.map(p => (
        <button key={p.type} onClick={() => connect(p.type)}>
          {p.name} {p.detected ? '(detected)' : ''}
        </button>
      ))}
    </div>
  )}
</ConnectDialog>
```

### ConnectDialogProvider + useConnectDialog

App-level provider that auto-opens the dialog when status becomes 'selecting'.

```tsx
<WalletProvider appName="My dApp">
  <ConnectDialogProvider>
    <App />
  </ConnectDialogProvider>
</WalletProvider>

// In any child component:
function ConnectTrigger() {
  const { openConnectDialog } = useConnectDialog()
  return <button onClick={openConnectDialog}>Connect</button>
}
```

### WalletSelector

Render-prop only component (no default UI). Lists providers with detection status.

### SigmaCallback

Page component for Sigma OAuth redirect. Place at the OAuth callback route.

```tsx
// app/auth/callback/page.tsx
import { SigmaCallback } from '@1sat/react'

export default function AuthCallback() {
  return (
    <SigmaCallback
      redirectTo="/"
      onComplete={(result) => console.log('Connected:', result)}
      loadingContent={<p>Completing authentication...</p>}
      renderError={(error) => <p>Error: {error.message}</p>}
    />
  )
}
```

## useWallet Hook

Primary hook for accessing wallet context:

```typescript
interface WalletContextValue {
  wallet: WalletInterface | null          // @bsv/sdk WalletInterface
  status: WalletStatus                    // 'disconnected'|'detecting'|'selecting'|'connecting'|'connected'
  identityKey: string | null              // Identity pubkey
  providerType: string | null             // 'brc100'|'onesat'|'sigma'|custom
  availableProviders: AvailableProvider[]
  connect: (providerType?: string) => Promise<void>
  applyResult: (result: ConnectWalletResult) => void
  disconnect: () => void
  error: Error | null
}
```

## Vanilla JS

```typescript
import { createOneSat } from '@1sat/connect'

const onesat = createOneSat({ appName: 'My dApp' })

// Connect (auto-detects extension or opens popup)
const { paymentAddress, ordinalAddress, identityPubKey } = await onesat.connect()

// Operations
const { satoshis } = await onesat.getBalance()
const { signature } = await onesat.signMessage('Hello world')
const { rawtx, txid } = await onesat.signTransaction({ rawtx, description: 'Payment' })

await onesat.disconnect()
```

## Connection Flow

`WalletProvider` uses a two-tier detection flow:

1. **BRC-100 auto-detect** — scans for extensions, Cicada, localhost wallets, XDM
2. **Manual selection** — if nothing detected, status becomes `'selecting'` and `ConnectDialogProvider` auto-opens the provider selector
3. **Sigma OAuth** — redirect-based flow for Sigma Identity wallets, completed by `SigmaCallback`

## Provider Detection

```typescript
import { isOneSatInjected, waitForOneSat, createOneSat } from '@1sat/connect'

if (isOneSatInjected()) { /* Extension present */ }

// Wait up to 3s for extension
const provider = await waitForOneSat(3000)

// Or let createOneSat handle detection
const onesat = createOneSat()
```

## OneSatProvider Interface

Full provider interface for dApp operations:

```typescript
interface OneSatProvider {
  connect(): Promise<ConnectResult>
  disconnect(): Promise<void>
  isConnected(): boolean
  signTransaction(request: SignTransactionRequest): Promise<SignTransactionResult>
  signMessage(message: string): Promise<SignMessageResult>
  inscribe(request: InscribeRequest): Promise<InscribeResult>
  sendOrdinals(request: SendOrdinalsRequest): Promise<SendResult>
  createListing(request: CreateListingRequest): Promise<ListingResult>
  purchaseListing(request: PurchaseListingRequest): Promise<SendResult>
  cancelListing(request: CancelListingRequest): Promise<SendResult>
  transferToken(request: TransferTokenRequest): Promise<SendResult>
  getBalance(): Promise<BalanceResult>
  getOrdinals(options?: ListOptions): Promise<OrdinalOutput[]>
  getTokens(options?: ListOptions): Promise<TokenOutput[]>
  getUtxos(): Promise<Utxo[]>
  on(event: OneSatEvent, handler: EventHandler): void
  off(event: OneSatEvent, handler: EventHandler): void
  getAddresses(): { paymentAddress: string; ordinalAddress: string } | null
  getIdentityPubKey(): string | null
}
```

## Events

```typescript
onesat.on('connect', (result) => console.log('Connected:', result.paymentAddress))
onesat.on('disconnect', () => console.log('Disconnected'))
onesat.on('accountChange', (result) => console.log('Account:', result.paymentAddress))
```

## Persistent Connection

```typescript
import { saveConnection, loadConnection, clearConnection, hasStoredConnection } from '@1sat/connect'

const result = await onesat.connect()
saveConnection({ paymentAddress: result.paymentAddress, ordinalAddress: result.ordinalAddress, identityPubKey: result.identityPubKey, timestamp: Date.now() })

// On page load
if (hasStoredConnection()) {
  const stored = loadConnection()
  // Auto-reconnect using stored.providerType
}

clearConnection() // On disconnect
```

## BigBlocks Registry Integration

`@1sat/react` components are unstyled primitives. The [BigBlocks registry](https://registry.bigblocks.dev) serves shadcn-themed versions installable via:

```bash
bunx shadcn@latest add https://registry.bigblocks.dev/r/connect-wallet.json
```

BigBlocks components wrap `@1sat/react` primitives in shadcn UI (Button, Dialog, Drawer, DropdownMenu) with full theme support. The source for `@1sat/react` stays in this repo — BigBlocks serves them without duplicating code.

## Requirements

```bash
# Vanilla JS
bun add @1sat/connect

# React
bun add @1sat/react  # includes @1sat/connect

# Browser extensions
bun add @1sat/extension
```
