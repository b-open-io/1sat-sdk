---
name: dapp-connect
description: "This skill should be used when building a dApp that connects to a 1Sat wallet — using @1sat/connect for wallet connection via popup or browser extension, @1sat/react for React hooks and components, or integrating with the BigBlocks shadcn registry. Triggers on 'connect wallet', 'dApp integration', 'wallet provider', 'ConnectButton', 'WalletProvider', 'useWallet', 'ConnectDialog', 'SigmaCallback', 'browser extension', 'popup wallet', 'BRC-100', 'Sigma OAuth', 'BigBlocks registry', or 'shadcn wallet components'."
---

# dApp Connect

Connect a dApp to an **existing** BRC-100 wallet (browser extension, desktop wallet, or Sigma Identity) using `@1sat/connect` (vanilla JS) and `@1sat/react` (React).

This skill is about *connecting to* a wallet a user already has. To *create and run* a wallet programmatically (local/remote storage, address sync, backups), see `../../../wallet/skills/wallet-setup`.

## Architecture

```
@1sat/react (React components + hooks)
  └── @1sat/connect (connection core: connectWallet)
        ├── BRC-100 auto-detect — WalletClient('auto'): extensions, desktop (localhost), XDM, React Native
        ├── Sigma OAuth — browser redirect flow + CWI iframe
        └── Custom providers — CWI iframe bridge (url) or a custom connect() fn
```

`connectWallet` races auto-detect and every configured provider with `Promise.any`; first to authenticate wins, and its `provider` type is saved to `localStorage` for warm reconnects.

## Quick Start (React)

```tsx
import { WalletProvider, ConnectButton, useWallet } from '@1sat/react'

function App() {
  return (
    <WalletProvider autoReconnect>
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

App-level context provider. Wrap the application root. Props (`WalletProviderProps`):

```tsx
<WalletProvider
  autoReconnect={false}            // re-run last successful connection on mount (default false)
  autoDetect={true}               // include WalletClient('auto') in the connect race (default true)
  providers={customProviders}      // WalletProviderConfig[] — custom/Sigma providers (optional)
>
  {children}
</WalletProvider>
```

There is **no** `appName` prop on `WalletProvider`. With `autoReconnect`, mount reads the stored provider type: `brc100` re-runs auto-detect; a custom type must be present in `providers`; `sigma` is guarded against redirect loops via a sessionStorage flag.

### ConnectButton

Unstyled button that triggers wallet connection. Supports render-prop children for full customization.

```tsx
<ConnectButton
  className="my-button"
  style={{ /* inline styles */ }}
  connectLabel="Connect"                       // default 'Connect Wallet'
  connectingLabel="Connecting..."              // default 'Connecting...'
  connectedLabel={(key) => `${key.slice(0,6)}...${key.slice(-4)}`}  // ReactNode | (identityKey) => ReactNode; defaults to a truncated key
  onConnect={() => console.log('connected')}   // no args
  onDisconnect={() => console.log('disconnected')}
  onError={(err) => console.error(err)}        // connect/disconnect errors
  disconnectOnClick={true}                     // click to disconnect when connected (default true)
/>
```

Render-prop form receives `{ isConnected, isConnecting, identityKey, connect, disconnect }`. `isConnecting` is true while status is `detecting` or `connecting`. When connected and no specific provider is configured, clicking calls the plain `connect()` which re-runs detection — there is no built-in provider picker on the button; pair it with `ConnectDialogProvider` (below) for selection.

### ConnectDialog

Controlled dialog (native `<dialog>`) for wallet provider selection. Requires `open` and `onOpenChange`. Render-prop `children` is **optional** — omit it for a basic unstyled provider list.

```tsx
<ConnectDialog
  open={isOpen}
  onOpenChange={setIsOpen}
>
  {({ providers, error, close }) => (
    <div>
      {providers.map(p => (
        <button
          key={p.type}
          disabled={p.isConnecting}
          onClick={p.connect}          // each provider carries its own bound connect()
        >
          {p.icon && <img src={p.icon} alt="" />}
          {p.name}{p.isConnecting && ' ...'}
        </button>
      ))}
      {error && <p>{error.message}</p>}
      <button onClick={close}>Cancel</button>
    </div>
  )}
</ConnectDialog>
```

Render props are `{ providers, error, close }`. Each provider is `{ type, name, icon?, isConnecting, connect }` — `connect` takes no arguments (it's pre-bound to that provider's type). There is no `detected` flag; the dialog lists the providers configured on `WalletProvider`.

### ConnectDialogProvider + useConnectDialog

App-level provider that mounts a `ConnectDialog` and auto-opens it when status becomes `'selecting'` (auto-detect found nothing). Place it **inside** `WalletProvider`. Pass `renderDialog` to customize the dialog content (same render props as `ConnectDialog`).

```tsx
<WalletProvider autoReconnect>
  <ConnectDialogProvider
    renderDialog={({ providers, error, close }) => (/* custom UI */ null)}  // optional
  >
    <App />
  </ConnectDialogProvider>
</WalletProvider>

// In any child component:
function ConnectTrigger() {
  const { openConnectDialog } = useConnectDialog()
  return <button onClick={openConnectDialog}>Connect</button>
}
```

`useConnectDialog()` returns `{ openConnectDialog }` and throws if used outside `ConnectDialogProvider`.

### WalletSelector

Headless, render-prop-only component (no default UI at all — `children` is required). Reads `availableProviders`, `connect`, and `error` from context; tracks a per-provider connecting state; calls `onClose` after a provider connects. Use it to build a bespoke selector when `ConnectDialog`'s `<dialog>` shell doesn't fit.

```tsx
<WalletSelector onClose={() => setOpen(false)}>
  {({ providers, error }) => (
    <ul>
      {providers.map(p => (
        <li key={p.type}>
          <button disabled={p.isConnecting} onClick={p.connect}>
            {p.icon && <img src={p.icon} alt="" />}
            {p.name}{p.isConnecting && ' (connecting...)'}
          </button>
        </li>
      ))}
      {error && <p>{error.message}</p>}
    </ul>
  )}
</WalletSelector>
```

Render props: `{ providers, error }`. Each provider is `{ type, name, icon?, isConnecting, connect }` with `connect` pre-bound (no args). Unlike `ConnectDialog`, `WalletSelector` renders nothing but what `children` returns — no `<dialog>`, no `open`/`onOpenChange`.

### SigmaCallback

Page component for the Sigma OAuth redirect. Place it at the OAuth callback route. It runs `completeSigmaOAuth` → `connectSigmaWallet`, applies the result to the wallet context, then redirects (or calls `onComplete`).

```tsx
// app/auth/sigma/callback/page.tsx
import { SigmaCallback } from '@1sat/react'

export default function AuthCallback() {
  return (
    <SigmaCallback
      redirectTo="/"                                   // default '/'
      onComplete={() => router.push('/')}              // no args; use for SPA nav instead of hard redirect
      loadingContent={<p>Completing authentication...</p>}
      renderError={(error, goBack) => <p>{error} <button onClick={goBack}>Back</button></p>}
    />
  )
}
```

`onComplete` takes **no arguments** (the connected wallet is already applied to context). `renderError` receives `(error: string, goBack: () => void)`.

## useWallet Hook

Primary hook for accessing wallet context:

```typescript
interface WalletContextValue {
  wallet: WalletInterface | null          // @bsv/sdk WalletInterface
  status: WalletStatus                    // 'disconnected'|'detecting'|'selecting'|'connecting'|'connected'
  identityKey: string | null              // Identity pubkey
  providerType: string | null             // 'brc100' (auto-detect) | 'sigma' | a custom provider's type
  availableProviders: AvailableProvider[]
  connect: (providerType?: string) => Promise<void>
  applyResult: (result: ConnectWalletResult) => void
  disconnect: () => void
  error: Error | null
}
```

## Vanilla JS

The public entry point is `connectWallet(config)`. It races BRC-100 auto-detect and every configured provider, and returns a `ConnectWalletResult` — or `null` when nothing connected (treat `null` as "show the provider picker").

```typescript
import { connectWallet } from '@1sat/connect'

const result = await connectWallet({
  autoDetect: true,                 // include WalletClient('auto') in the race (default true)
  providers: [                      // optional custom/Sigma providers
    { type: 'my-wallet', name: 'My Wallet', url: 'https://wallet.example.com' },
  ],
})

if (!result) {
  // no wallet connected — render your own provider picker
} else {
  const { wallet, provider, identityKey, disconnect } = result
  // `wallet` is a @bsv/sdk WalletInterface — drive BRC-100 ops directly:
  const { publicKey } = await wallet.getPublicKey({ identityKey: true })
  // ...wallet.createAction(...), wallet.createSignature(...), etc.
  disconnect()                      // tear down the connection
}
```

`ConnectWalletResult` is `{ wallet: WalletInterface, provider: string, identityKey: string, disconnect: () => void }`. All wallet operations go through the standard `@bsv/sdk` `WalletInterface` on `result.wallet` — `@1sat/connect` does not wrap them in its own method surface.

### Provider config

Each entry in `providers` is a `WalletProviderConfig`:

```typescript
{
  type: string,                     // unique id, also the saved-reconnect key
  name: string,                     // display name
  icon?: string,                    // icon URL / data URI
  url?: string,                     // CWI iframe-bridge host (postMessage)
  connect?: () => Promise<ConnectWalletResult>,  // custom connector; overrides url
}
```

Resolution order per provider: custom `connect` → `url` (CWI iframe bridge via `createWebCWI`) → error.

### Helpers

```typescript
import { connectWallet, getAvailableProviders, loadLastProvider } from '@1sat/connect'

// Build the provider list (each entry gets a bound connect()), sorted so the
// last successful provider is tried first.
const providers = getAvailableProviders({ providers: myProviders })
await providers[0].connect()

// The provider type saved on the last successful connectWallet() (localStorage).
const last = loadLastProvider()  // string | null
```

`connectWallet` saves the winning `provider` type to `localStorage` and, on the next call, attempts that last provider first before the full race. There is **no** `createOneSat` factory, `isOneSatInjected`, `waitForOneSat`, `saveConnection`/`loadConnection`, or event emitter on the public `@1sat/connect` surface — those are internal to the popup `OneSatBrowserProvider` and not exported. `OneSatProvider` is exported as a **type** only.

## Connection Flow

`WalletProvider` drives status transitions:

1. **`detecting`** — `connectWallet` races BRC-100 auto-detect (`WalletClient('auto')`: extensions, desktop/localhost, XDM, React Native) and all configured providers.
2. **`selecting`** — nothing auto-connected; `connectWallet` returned `null`. `ConnectDialogProvider` auto-opens the provider selector.
3. **`connecting` → `connected`** — a specific provider was chosen (or won the race); on success the result is applied to context.
4. **Sigma OAuth** — redirect-based; completed by `SigmaCallback`, which calls `connectSigmaWallet` and applies the result.

## Sigma OAuth (vanilla)

For non-React apps, the Sigma flow is three exported functions:

```typescript
import { initiateSigmaOAuth, completeSigmaOAuth, connectSigmaWallet } from '@1sat/connect'

// 1. Kick off the redirect (never resolves — the page navigates away)
await initiateSigmaOAuth({ clientId: 'my-client', callbackURL: '/auth/sigma/callback' })

// 2. On the callback route, exchange the code
const { bapId, pubkey, user, accessToken } = await completeSigmaOAuth(
  new URLSearchParams(window.location.search),
)

// 3. Open the CWI iframe and connect
const { wallet, identityKey, disconnect } = await connectSigmaWallet(bapId)
```

## BigBlocks Registry Integration

`@1sat/react` components are unstyled primitives. The [BigBlocks registry](https://registry.bigblocks.dev) serves 30 shadcn-themed blocks installable via:

```bash
npx bigblocks add <block>
# or
bunx shadcn@latest add https://registry.bigblocks.dev/r/<block>.json
```

Connection and wallet blocks that wrap `@1sat/react`:

| Block | Description |
|-------|-------------|
| `connect-wallet` | Wallet connection button with provider selection dialog and connected-state dropdown |
| `wallet-overview` | Dashboard card with balance, addresses, identity key, and send/receive actions |
| `send-bsv` | Send BSV dialog with sats/BSV toggle, fee estimate, and confirmation |
| `receive-address` | QR code and deposit address with copy and optional rotation |
| `transaction-history` | Transaction list with status indicators and pagination |
| `mnemonic-flow` | Multi-mode seed phrase create/display/import/verify |
| `unlock-wallet` | Passphrase and Touch ID unlock screen |
| `bigblocks-provider` | Context provider for web-mode (API) or custom-mode (desktop RPC) data fetching |

BigBlocks components wrap `@1sat/react` primitives in shadcn UI (Button, Dialog, Drawer, DropdownMenu) with full theme support. The source for `@1sat/react` stays in this repo — BigBlocks serves them without duplicating code. See the full 30-block registry at https://bigblocks.dev.

## Requirements

```bash
# Vanilla JS
bun add @1sat/connect

# React
bun add @1sat/react  # includes @1sat/connect

# Browser extensions
bun add @1sat/extension
```
