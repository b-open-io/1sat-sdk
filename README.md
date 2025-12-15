# 1Sat SDK

Build apps on [1Sat Ordinals](https://1satordinals.com) - BSV's protocol for NFTs, fungible tokens (BSV20/21), and on-chain data.

## Installation

```bash
npm install @1sat/sdk
# or
bun add @1sat/sdk
```

For React apps with hooks and components:

```bash
npm install @1sat/react
```

## Features

- **Connect** - Wallet connection via popup (1sat.market) or future browser extensions
- **Ordinals** - Inscribe, send, and list NFTs
- **Tokens** - Full support for BSV20 (tick) and BSV21 (token ID) standards
- **Marketplace** - Create, purchase, and cancel listings
- **Signing** - Message signing (BSM) and Sigma protocol for data attestation
- **Builder** - Low-level transaction builder for custom flows

## Quick Start

### Browser dApp

```typescript
import { createOneSat } from '@1sat/sdk'
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
import { OneSatProvider, ConnectButton, useOneSat, useBalance } from '@1sat/react'

function App() {
  return (
    <OneSatProvider appName="My dApp">
      <ConnectButton />
      <WalletInfo />
    </OneSatProvider>
  )
}

function WalletInfo() {
  const { isConnected, paymentAddress } = useOneSat()
  const { data: balance } = useBalance()

  if (!isConnected) return null

  return (
    <div>
      <p>Address: {paymentAddress}</p>
      <p>Balance: {balance?.satoshis} sats</p>
    </div>
  )
}
```

### Server-Side / Scripts

For backends or scripts where you control the keys directly:

```typescript
import { createOrdinals, fetchPayUtxos, createBroadcaster } from '@1sat/sdk'
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
const broadcaster = createBroadcaster()
const broadcastResult = await broadcaster.broadcast(result.tx)
console.log('Inscribed:', result.tx.id('hex'))
```

## Network Configuration

```typescript
import { API_HOST, API_HOST_TESTNET, ORDFS_HOST } from '@1sat/sdk'

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
import { UserRejectedError, TimeoutError, InsufficientFundsError } from '@1sat/sdk'

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

For server-side token operations with direct key access:

```typescript
import { fetchTokenUtxos, selectTokenUtxos, TokenType } from '@1sat/sdk'

// Fetch token UTXOs (note: protocol is first argument)
const tokenUtxos = await fetchTokenUtxos(TokenType.BSV21, tokenId, address)

// Select UTXOs for transfer amount
const { selectedUtxos, isEnough } = selectTokenUtxos(tokenUtxos, amount, decimals)

if (!isEnough) {
  throw new Error('Insufficient token balance')
}

// For full token transfer transaction building, use js-1sat-ord directly
// or the @1sat/wallet package with OneSatWallet
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
┌─────────────────────────────────────────────────────────────┐
│                      Your Application                        │
├─────────────────────────────────────────────────────────────┤
│  @1sat/sdk          │  @1sat/react       │  @1sat/wallet    │
│  - createOneSat()   │  - OneSatProvider  │  - OneSatWallet  │
│  - createOrdinals() │  - useOneSat       │  - Indexers      │
│  - TxBuilder        │  - ConnectButton   │  - Sync engine   │
├─────────────────────┴──────────────────────────────────────┤
│  @1sat/connect                                              │
│  - Popup management, postMessage protocol, session storage  │
├─────────────────────────────────────────────────────────────┤
│  @1sat/core         │  @1sat/client      │  @1sat/protocols │
│  - TxBuilder        │  - Indexer API     │  - MAP, Sigma    │
│  - Ordinal ops      │  - Broadcast       │  - OrdP2PKH      │
│                     │  - UTXO fetch      │  - OrdLock       │
├─────────────────────────────────────────────────────────────┤
│  @1sat/types  │  @1sat/constants  │  @1sat/utils            │
└─────────────────────────────────────────────────────────────┘
```

### Packages

| Package | Description |
|---------|-------------|
| `@1sat/sdk` | Main SDK - browser dApps and transaction building |
| `@1sat/react` | React hooks and ConnectButton component |
| `@1sat/connect` | Popup-based wallet connection |
| `@1sat/core` | TxBuilder and ordinal operations |
| `@1sat/client` | API client for indexer, broadcast, ORDFS |
| `@1sat/protocols` | MAP, Sigma, OrdP2PKH, OrdLock implementations |
| `@1sat/types` | TypeScript type definitions |
| `@1sat/constants` | Protocol constants and endpoints |
| `@1sat/utils` | Encoding and validation utilities |
| `@1sat/wallet` | Full BRC-100 wallet engine with indexers and sync |

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run --filter '*' build

# Lint
bun run lint

# Watch mode
cd packages/sdk && bun run dev
```

## Related

- [1sat.market](https://1sat.market) - Ordinals marketplace and wallet
- [js-1sat-ord](https://github.com/BitcoinSchema/js-1sat-ord) - Low-level ordinal operations
- [bitcoin-auth](https://github.com/BitcoinSchema/bitcoin-auth) - BSV authentication
- [@bsv/sdk](https://github.com/bitcoin-sv/ts-sdk) - BSV primitives

## License

MIT
