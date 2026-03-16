![1Sat SDK](assets/sdk-banner.jpg)

# 1Sat SDK

Build apps on [1Sat Ordinals](https://1satordinals.com) - BSV's protocol for NFTs, fungible tokens (BSV20/21), and on-chain data.

## Installation

Install only the packages you need:

```bash
# CLI (terminal wallet and operations)
bun add -g @1sat/cli

# Browser dApps (popup wallet connection)
bun add @1sat/connect

# React apps
bun add @1sat/react

# Server / scripts (direct key access)
bun add @1sat/core @1sat/client @1sat/types

# Script templates (Inscription, OrdLock, BSV20, BSV21, etc.)
bun add @1sat/templates

# Wallet engine
bun add @1sat/wallet-browser  # or @1sat/wallet-node
```

## Features

- **Connect** - Wallet connection via popup (1sat.market) or browser extensions
- **Ordinals** - Inscribe, send, and list NFTs
- **Tokens** - Full support for BSV20 (tick) and BSV21 (token ID) standards
- **Marketplace** - Create, purchase, and cancel listings
- **Signing** - Message signing (BSM) and Sigma protocol for data attestation
- **Builder** - Low-level transaction builder for custom flows
- **Actions** - Self-describing wallet operations for agents and tooling
- **Wallet Engine** - Full BRC-100 wallet with indexers, sync, and backup

## Quick Start

### Browser dApp

```typescript
import { createOneSat } from '@1sat/connect'
import { Utils } from '@bsv/sdk'

const { toArray, toBase64 } = Utils

const onesat = createOneSat({
  appName: 'My dApp',
})

// Connect - opens wallet popup for user approval
try {
  const { paymentAddress, ordinalAddress } = await onesat.connect()
  console.log('Connected:', paymentAddress)
} catch (err) {
  if (err.code === 'USER_REJECTED') {
    console.log('User closed the popup')
  }
}

// Inscribe
await onesat.inscribe({
  dataB64: toBase64(toArray('Hello, Ordinals!', 'utf8')),
  contentType: 'text/plain',
})

// Transfer ordinals
await onesat.sendOrdinals({
  outpoints: ['txid_vout'],
  destination: 'recipient-address',
})

// Transfer tokens
await onesat.transferToken({
  tokenId: 'token-origin',
  amount: '100',
  destinationAddress: 'recipient-address',
})
```

### React

```tsx
import { OneSatProvider, ConnectButton, useOneSatContext, useBalance } from '@1sat/react'

function App() {
  return (
    <OneSatProvider appName="My dApp">
      <ConnectButton />
      <WalletInfo />
    </OneSatProvider>
  )
}

function WalletInfo() {
  const { isConnected, paymentAddress } = useOneSatContext()
  const { satoshis, isLoading } = useBalance()

  if (!isConnected) return null

  return (
    <div>
      <p>Address: {paymentAddress}</p>
      <p>Balance: {satoshis} sats</p>
    </div>
  )
}
```

### Server-Side / Scripts

For backends or scripts where you control the keys directly:

```typescript
import { createOrdinals, fetchPayUtxos } from '@1sat/core'
import { ArcadeClient } from '@1sat/client'
import { ONESAT_MAINNET_URL } from '@1sat/types'
import { PrivateKey, Utils } from '@bsv/sdk'

const { toArray, toBase64 } = Utils

// SERVER SIDE ONLY - Never expose keys in client code
const privateKey = PrivateKey.fromWif(process.env.WALLET_WIF!)
const address = privateKey.toAddress().toString()

// Fetch UTXOs from indexer
const utxos = await fetchPayUtxos(address)

// Create an inscription
const result = await createOrdinals({
  utxos,
  destinations: [{
    address,
    inscription: {
      dataB64: toBase64(toArray('Hello, Ordinals!', 'utf8')),
      contentType: 'text/plain',
    },
  }],
  paymentPk: privateKey,
  changeAddress: address,
})

// Broadcast to network
const arcade = new ArcadeClient(ONESAT_MAINNET_URL)
const broadcastResult = await arcade.submitTransactionHex(result.tx.toHex())

if (
  broadcastResult.txStatus === 'MINED' ||
  broadcastResult.txStatus === 'SEEN_ON_NETWORK' ||
  broadcastResult.txStatus === 'ACCEPTED_BY_NETWORK' ||
  broadcastResult.txStatus === 'IMMUTABLE'
) {
  console.log('Inscribed:', result.tx.id('hex'))
}
```

### Wallet Engine

Browser (IndexedDB):

```typescript
import { createWebWallet } from '@1sat/wallet-browser'

const { wallet, services } = await createWebWallet({
  rootKey: privateKeyHex,
  chain: 'main',
})
```

Node/Bun (SQLite):

```typescript
import { createNodeWallet } from '@1sat/wallet-node'

const { wallet, services } = await createNodeWallet({
  rootKey: privateKeyHex,
  chain: 'main',
  dbFilename: 'wallet.sqlite',
})
```

## Network Configuration

```typescript
import { API_HOST, API_HOST_TESTNET, ORDFS_HOST } from '@1sat/types'

// Mainnet (default)
const onesat = createOneSat({ appName: 'My dApp' })

// API endpoints:
// API_HOST: https://ordinals.gorillapool.io/api (mainnet)
// API_HOST_TESTNET: https://testnet.ordinals.gorillapool.io/api (testnet)
// ORDFS_HOST: https://ordfs.network (inscription content)
```

## Wallet Compatibility

The SDK connects to wallets via a popup interface. Currently supported:

- **1sat.market** - Default popup wallet (no extension required)

Future support planned for browser extensions and embedded wallets.

## API Reference

### createOneSat(config?)

```typescript
const onesat = createOneSat({
  appName: 'My dApp',              // Required: Your app name
  popupUrl: 'https://1sat.market', // Optional: Wallet popup URL (default: 1sat.market)
  timeout: 300000,                 // Optional: Request timeout in ms (default: 5 min)
})
```

### Provider Methods

| Method | Description |
|--------|-------------|
| `connect()` | Connect to wallet, returns `{ paymentAddress, ordinalAddress }` |
| `disconnect()` | Disconnect current session |
| `isConnected()` | Check if wallet is connected |
| `signTransaction(request)` | Sign a raw transaction |
| `signMessage(message)` | Sign a message (BSM) |
| `inscribe(request)` | Create an inscription |
| `sendOrdinals(request)` | Transfer ordinals |
| `transferToken(request)` | Transfer BSV20/21 tokens |
| `createListing(request)` | List ordinal for sale |
| `purchaseListing(request)` | Buy a listed ordinal |
| `cancelListing(request)` | Cancel a listing |
| `getBalance()` | Get wallet balance |
| `getOrdinals(options?)` | List owned ordinals |
| `getTokens(options?)` | List owned tokens |
| `getUtxos()` | Get payment UTXOs |

### Events

```typescript
onesat.on('connect', ({ paymentAddress, ordinalAddress }) => {
  console.log('Connected:', paymentAddress)
})

onesat.on('disconnect', () => {
  console.log('Disconnected')
})

onesat.on('accountChange', ({ paymentAddress, ordinalAddress }) => {
  console.log('Account changed:', paymentAddress)
})
```

### Error Handling

```typescript
import { UserRejectedError, TimeoutError, InsufficientFundsError } from '@1sat/connect'

try {
  await onesat.connect()
} catch (err) {
  if (err instanceof UserRejectedError) {
    console.log('User rejected the request')
  } else if (err instanceof TimeoutError) {
    console.log('Request timed out')
  } else if (err instanceof InsufficientFundsError) {
    console.log('Not enough funds')
  }
}
```

## Token Operations

For token transfers via wallet popup (browser dApps):

```typescript
// Transfer tokens via wallet popup
await onesat.transferToken({
  tokenId: 'token-origin-txid_0',
  amount: '100',
  destinationAddress: 'recipient-address',
})
```

For server-side token transfers with direct key access:

```typescript
import { fetchPayUtxos, fetchTokenUtxos, selectTokenUtxos, transferOrdTokens, TokenType } from '@1sat/core'
import { ArcadeClient } from '@1sat/client'
import { ONESAT_MAINNET_URL } from '@1sat/types'
import { PrivateKey } from '@bsv/sdk'

const paymentPk = PrivateKey.fromWif(process.env.PAYMENT_WIF!)
const ordPk = PrivateKey.fromWif(process.env.ORD_WIF!)
const address = paymentPk.toAddress().toString()
const tokenId = 'token-origin-txid_0'
const decimals = 8

// Fetch UTXOs
const utxos = await fetchPayUtxos(address)
const tokenUtxos = await fetchTokenUtxos(TokenType.BSV21, tokenId, address)

// Select enough tokens for transfer
const { selectedUtxos, isEnough } = selectTokenUtxos(tokenUtxos, 100, decimals)
if (!isEnough) throw new Error('Insufficient token balance')

// Build transfer transaction
const result = await transferOrdTokens({
  protocol: TokenType.BSV21,
  tokenID: tokenId,
  decimals,
  utxos,
  inputTokens: selectedUtxos,
  distributions: [{ address: 'recipient-address', tokens: 100 }],
  paymentPk,
  ordPk,
  changeAddress: address,
  tokenChangeAddress: address,
})

// Broadcast
const arcade = new ArcadeClient(ONESAT_MAINNET_URL)
const broadcastResult = await arcade.submitTransactionHex(result.tx.toHex())

if (
  broadcastResult.txStatus === 'MINED' ||
  broadcastResult.txStatus === 'SEEN_ON_NETWORK' ||
  broadcastResult.txStatus === 'ACCEPTED_BY_NETWORK' ||
  broadcastResult.txStatus === 'IMMUTABLE'
) {
  console.log('Transferred:', result.tx.id('hex'))
}
```

## Protocols

| Protocol | Description |
|----------|-------------|
| **1Sat Ordinals** | NFT inscriptions on BSV |
| **BSV20** | Fungible tokens (tick-based, like BRC-20) |
| **BSV21** | Fungible tokens (origin-based, contract-like) |
| **MAP** | Magic Attribute Protocol - on-chain metadata |
| **Sigma** | Transaction data signing and attestation |
| **OrdLock** | Trustless marketplace listing contract |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Your Application                       │
├──────────────────────────────────────────────────────────────┤
│  @1sat/react                                                 │
│  - OneSatProvider, useOneSatContext, useBalance               │
│  - ConnectButton, useOrdinals, useInscribe                   │
├──────────────────────────────────────────────────────────────┤
│  @1sat/connect                  │  @1sat/extension           │
│  - Popup wallet connection      │  - Browser extension       │
│  - postMessage protocol         │  - window.onesat injection │
├─────────────────────────────────┴────────────────────────────┤
│  @1sat/wallet-browser   │  @1sat/wallet-node                │
│  - createWebWallet()    │  - createNodeWallet()             │
│  - IndexedDB storage    │  - SQLite storage                 │
├─────────────────────────┴────────────────────────────────────┤
│  @1sat/wallet           │  @1sat/actions                    │
│  - OneSatWallet         │  - Action registry                │
│  - Indexers & sync      │  - Agent tooling                  │
│  - Backup / CWI         │  - Self-describing ops            │
├─────────────────────────┴────────────────────────────────────┤
│  @1sat/core                     │  @1sat/client              │
│  - TxBuilder, Ordinal ops       │  - Indexer API             │
│  - Protocols: MAP, Sigma,       │  - Broadcast (Arcade)      │
│    OrdP2PKH, OrdLock            │  - UTXO fetch, ORDFS       │
├─────────────────────────────────┴────────────────────────────┤
│  @1sat/templates                │  @1sat/cli                 │
│  - Inscription, OrdLock, Lock  │  - Terminal wallet & ops   │
│  - BSV20, BSV21, AIP, BAP     │  - Binary: 1sat            │
│  - MAP, Sigma, BSocial         │  - 29 commands             │
├─────────────────────────────────┴────────────────────────────┤
│  @1sat/types            │  @1sat/utils                      │
│  - Type definitions     │  - Encoding & validation          │
│  - Protocol constants   │  - Key derivation                 │
└──────────────────────────────────────────────────────────────┘
```

### Packages

| Package | Description |
|---------|-------------|
| `@1sat/react` | React hooks and ConnectButton component |
| `@1sat/connect` | Popup-based wallet connection protocol |
| `@1sat/extension` | Browser wallet extension toolkit (window.onesat) |
| `@1sat/core` | TxBuilder, ordinal operations, and protocol implementations (MAP, Sigma, OrdP2PKH, OrdLock) |
| `@1sat/client` | API clients for indexer, broadcast, and ORDFS |
| `@1sat/types` | TypeScript type definitions and protocol constants |
| `@1sat/utils` | Encoding, validation, and key derivation utilities |
| `@1sat/wallet` | Base BRC-100 wallet engine with indexers, sync, backup, and CWI |
| `@1sat/wallet-browser` | Browser wallet factory (IndexedDB storage) |
| `@1sat/wallet-node` | Node/Bun wallet factory (SQLite storage) |
| `@1sat/actions` | Self-describing wallet actions for agents and tooling |
| `@1sat/templates` | Bitcoin script templates (Inscription, OrdLock, Lock, BSV20, BSV21, AIP, BAP, MAP, Sigma, BSocial) |
| `@1sat/cli` | Command-line interface (`1sat` binary) for wallet ops, ordinals, tokens, and more |

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Lint
bun run lint

# Watch mode
bun dev
```

## Related

- [1sat.market](https://1sat.market) - Ordinals marketplace and wallet
- [js-1sat-ord](https://github.com/BitcoinSchema/js-1sat-ord) - Low-level ordinal operations
- [bitcoin-auth](https://github.com/BitcoinSchema/bitcoin-auth) - BSV authentication
- [@bsv/sdk](https://github.com/bitcoin-sv/ts-sdk) - BSV primitives

## License

MIT
