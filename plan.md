# @1sat/sdk - Architecture Plan

A complete wallet SDK ecosystem for 1Sat Ordinals on BSV, modeled after [Phantom's open source repos](https://github.com/phantom).

---

## Ecosystem Mapping (Phantom → 1Sat)

| Phantom | 1Sat Equivalent | Status |
|---------|-----------------|--------|
| `phantom-connect-sdk` | `@1sat/connect` | ✅ Built |
| `@phantom/react-sdk` | `@1sat/react` | ✅ Built |
| `@phantom/browser-sdk` | `@1sat/connect` | ✅ Built |
| `@phantom/embedded-provider-core` | `@1sat/core` | 🔲 Empty |
| `@phantom/sdk-types` | `@1sat/types` | 🔲 Empty |
| `@phantom/constants` | `@1sat/constants` | 🔲 Empty |
| `@phantom/utils` | `@1sat/utils` | 🔲 Empty |
| `@phantom/client` | `@1sat/client` | 🔲 Empty |
| `bitcoin-wallet-standard` | (BSV wallet standard) | Future |
| `sign-in-with-solana` | `bitcoin-auth` integration | Future |

---

## Current Status

### ✅ Completed Packages

#### @1sat/connect
**Wallet connection layer** - Popup-based RPC to 1Sat wallet extension

```
src/
├── provider.ts      # OneSatBrowserProvider - main provider class
├── types.ts         # RPC types, configs, results
├── errors.ts        # Custom error classes
├── messages.ts      # RPC message protocol
├── popup.ts         # PopupManager for wallet communication
├── storage.ts       # Connection persistence
└── index.ts         # createOneSat(), getOneSat(), waitForOneSat()
```

**Exports:**
- `createOneSat(config)` - Create provider instance
- `OneSatBrowserProvider` - Provider class
- RPC methods: `connect`, `signTransaction`, `signMessage`, `inscribe`, `sendOrdinals`, `transferToken`, `createListing`, `purchaseListing`, `cancelListing`
- Error classes: `UserRejectedError`, `WalletLockedError`, `InsufficientFundsError`, etc.

#### @1sat/react
**React bindings** - Hooks and components

```
src/
├── context.tsx      # OneSatProvider, useOneSatContext
├── hooks.ts         # useOneSat, useBalance, useOrdinals, useTokens, useSignTransaction, useSignMessage, useInscribe
├── ConnectButton.tsx
└── index.ts
```

#### @1sat/sdk
**Main bundle** - Re-exports from @1sat/connect (to be expanded)

---

### ✅ Built Packages

| Package | Purpose | Status |
|---------|---------|--------|
| `@1sat/types` | Shared type definitions | ✅ Built |
| `@1sat/constants` | Protocol constants, endpoints | ✅ Built |
| `@1sat/utils` | Encoding, validation utilities | ✅ Built |
| `@1sat/protocols` | MAP, Sigma, inscription, OrdP2PKH, OrdLock | ✅ Built |
| `@1sat/client` | HTTP client, UTXO fetching, broadcasting | ✅ Built |
| `@1sat/core` | TxBuilder, createOrdinals, sendOrdinals | ✅ Built |

### 🔲 Pending Packages

| Package | Purpose | Source Material |
|---------|---------|-----------------|
| `@1sat/wallet` | BRC-100 wallet implementation | wallet-toolbox |

---

## Package Architecture

```
packages/
│
│ ─── CONNECTION LAYER (✅ Done) ───
├── connect/                   # @1sat/connect - Wallet connection RPC
├── react/                     # @1sat/react - React hooks & components
│
│ ─── FOUNDATION LAYER (🔲 TODO) ───
├── types/                     # @1sat/types - Shared types
├── constants/                 # @1sat/constants - Constants
├── utils/                     # @1sat/utils - Utilities
│
│ ─── PROTOCOL LAYER (🔲 TODO) ───
├── protocols/                 # @1sat/protocols - Protocol implementations
│
│ ─── ENGINE LAYER (🔲 TODO) ───
├── client/                    # @1sat/client - API clients
├── core/                      # @1sat/core - Transaction building (TxBuilder)
├── wallet/                    # @1sat/wallet - Wallet engine
│
│ ─── BUNDLE ───
└── sdk/                       # @1sat/sdk - Main bundle (all-in-one)
```

---

## Detailed Package Specs

### @1sat/types

Extract and organize types from js-1sat-ord's 591-line `types.ts`.

```
src/
├── utxo.ts              # Utxo, NftUtxo, TokenUtxo, ChangeResult
├── inscription.ts       # Inscription, ContentType, SubTypeData
├── token.ts             # TokenType, TokenUtxo, Distribution
├── listing.ts           # OrdLock, Payout, RoyaltyType
├── protocols.ts         # MAP, PreMAP, AIP, Sigma
├── config.ts            # CreateOrdinalsConfig, SendOrdinalsConfig, etc.
└── index.ts
```

**Key types:**
```typescript
// UTXO types
interface Utxo {
  txid: string
  vout: number
  satoshis: number
  script: string  // base64 encoded
  pk?: string     // optional per-utxo private key (WIF)
}

interface NftUtxo extends Utxo {
  origin?: string
  contentType?: string
  collectionId?: string
}

interface TokenUtxo extends Utxo {
  id: string      // token ID (origin for BSV21, tick for BSV20)
  amt: string     // amount in tsat format (8 decimals as string)
  payout?: string // optional payout script for listings
}

// Inscription
interface Inscription {
  dataB64: string
  contentType: string
}

// Tokens
type TokenType = 'bsv20' | 'bsv21'
type TokenSelectionStrategy = 'smallest' | 'largest' | 'retain' | 'random'
type TokenInputMode = 'all' | 'needed'

interface Distribution {
  address: string
  amt: string
}

// Protocols
interface MAP {
  app: string
  type: string
  [key: string]: string
}

interface PreMAP {
  app: string
  type: string
  [key: string]: unknown  // allows objects/arrays before stringification
}
```

---

### @1sat/constants

```
src/
├── protocols.ts         # OP codes, prefixes, protocol identifiers
├── fees.ts              # Fee rates, dust limits
├── endpoints.ts         # API URLs
└── index.ts
```

```typescript
// protocols.ts
export const OP_FALSE = 0x00
export const OP_IF = 0x63
export const OP_ENDIF = 0x68
export const OP_RETURN = 0x6a
export const ORD_PREFIX = 'ord'
export const MAP_PREFIX = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5'

// fees.ts
export const DEFAULT_SAT_PER_KB = 10
export const MIN_FEE = 1
export const DUST_LIMIT = 1

// endpoints.ts
export const API_HOST_MAIN = 'https://ordinals.gorillapool.io'
export const API_HOST_TEST = 'https://testnet.ordinals.gorillapool.io'
export const ORDFS_URL = 'https://ordfs.network'
```

---

### @1sat/utils

```
src/
├── encoding.ts          # Hex/base64 using @bsv/sdk (NO Buffer)
├── outpoint.ts          # Outpoint parsing/formatting
├── validation.ts        # SubType validation, icon validation
├── metadata.ts          # stringifyMetaData for MAP
└── index.ts
```

```typescript
// encoding.ts - use @bsv/sdk utilities
import { toHex, toBase64, toArray } from '@bsv/sdk'

export function hexToBase64(hex: string): string {
  return toBase64(toArray(hex, 'hex'))
}

export function base64ToHex(b64: string): string {
  return toHex(toArray(b64, 'base64'))
}

// outpoint.ts
export function parseOutpoint(outpoint: string): { txid: string; vout: number } {
  const [txid, vout] = outpoint.split('_')
  return { txid, vout: parseInt(vout, 10) }
}

export function formatOutpoint(txid: string, vout: number): string {
  return `${txid}_${vout}`
}
```

---

### @1sat/protocols

Protocol implementations - extracted and testable in isolation.

```
src/
├── map/
│   ├── types.ts         # MAP, PreMAP
│   ├── serialize.ts     # stringifyMetaData
│   └── parse.ts         # parseMapData from script
│
├── sigma/
│   ├── types.ts         # SigmaData
│   ├── sign.ts          # signData
│   └── verify.ts        # verify signature
│
├── inscription/
│   ├── types.ts         # Inscription types
│   ├── envelope.ts      # Build inscription envelope script
│   └── parse.ts         # Parse from script
│
├── bsv20/
│   ├── types.ts
│   └── operations.ts    # Deploy, mint, transfer
│
├── bsv21/
│   ├── types.ts
│   └── operations.ts    # Deploy, mint, transfer
│
├── ordlock/
│   ├── types.ts
│   ├── script.ts        # Lock/unlock scripts
│   └── template.ts      # OrdLock template class
│
└── index.ts
```

---

### @1sat/client

API abstraction layer.

```
src/
├── types.ts             # Client interfaces
├── http.ts              # HTTP adapter
│
├── indexer/
│   ├── types.ts         # IndexerClient interface
│   ├── onesat.ts        # 1Sat API implementation
│   └── mock.ts          # Mock for testing
│
├── ordfs/
│   ├── types.ts
│   ├── client.ts        # OrdFS API
│   └── metadata.ts      # Metadata resolution
│
├── broadcast/
│   ├── types.ts         # Broadcaster interface
│   └── onesat.ts        # 1Sat broadcaster
│
└── index.ts
```

**Key exports:**
```typescript
// UTXO fetching
fetchPayUtxos(address: string, config?: ClientConfig): Promise<Utxo[]>
fetchNftUtxos(address: string, config?: ClientConfig): Promise<NftUtxo[]>
fetchTokenUtxos(address: string, tokenId: string, config?: ClientConfig): Promise<TokenUtxo[]>

// Token selection
selectTokenUtxos(utxos: TokenUtxo[], amount: string, strategy: TokenSelectionStrategy): TokenUtxo[]

// Broadcasting
broadcast(tx: Transaction, config?: ClientConfig): Promise<BroadcastResult>

// OrdFS
getOrdfsMetadata(outpoint: string): Promise<OrdfsMetadata>
```

---

### @1sat/core

Transaction building engine. **This is where TxBuilder lives.**

```
src/
├── tx-builder/
│   ├── types.ts         # TxBuilderConfig, BuildResult
│   ├── builder.ts       # TxBuilder class
│   └── fees.ts          # Fee utilities
│
├── templates/
│   ├── ord-p2pkh.ts     # OrdP2PKH template
│   └── ord-lock.ts      # OrdLock template
│
├── ordinals/
│   ├── create.ts        # createOrdinals()
│   ├── send.ts          # sendOrdinals()
│   └── burn.ts          # burnOrdinals()
│
├── tokens/
│   ├── deploy.ts        # deployBsv21Token()
│   └── transfer.ts      # transferOrdTokens()
│
├── listings/
│   ├── create.ts        # createOrdListings()
│   ├── purchase.ts      # purchaseOrdListing()
│   └── cancel.ts        # cancelOrdListings()
│
└── index.ts
```

**TxBuilder - Key abstraction eliminating code duplication:**

```typescript
class TxBuilder {
  constructor(config: TxBuilderConfig)

  // Outputs
  addOrdinalOutput(address: string, inscription?: Inscription): this
  addTokenOutput(address: string, tokenId: string, amount: string): this
  addPaymentOutput(address: string, satoshis: number): this
  addDataOutput(data: number[][]): this
  addChangeOutput(address: string): this

  // Inputs
  addPaymentInputs(utxos: Utxo[], pk?: PrivateKey): this
  addOrdinalInputs(utxos: NftUtxo[], pk?: PrivateKey): this
  addTokenInputs(utxos: TokenUtxo[], pk?: PrivateKey): this

  // Funding (iterative fee calculation)
  fund(paymentUtxos: Utxo[], satsPerKb?: number): this

  // Finalize
  sign(): this
  build(): BuildResult
}

interface BuildResult {
  tx: Transaction
  spentOutpoints: string[]
  change?: ChangeResult
}
```

---

### @1sat/wallet

Full wallet engine - absorbs wallet-toolbox functionality.

```
src/
├── OneSatWallet.ts          # Main wallet class (BRC-100)
├── services/
│   ├── OneSatServices.ts    # WalletServices implementation
│   └── chain-tracker.ts     # SPV validation
│
├── signers/
│   ├── types.ts
│   └── read-only.ts         # Read-only signer
│
├── indexers/
│   ├── types.ts             # Indexer base class
│   ├── parser.ts            # TransactionParser
│   ├── fund.ts
│   ├── inscription.ts
│   ├── origin.ts
│   ├── bsv21.ts
│   ├── ordlock.ts
│   ├── map.ts
│   └── sigma.ts
│
├── sync/
│   ├── manager.ts
│   └── state.ts
│
└── index.ts
```

---

## Dependencies

### Internal Dependency Graph

```
@1sat/types      ← (none)
@1sat/constants  ← (none)
@1sat/utils      ← @1sat/types, @1sat/constants
@1sat/protocols  ← @1sat/types, @1sat/constants, @1sat/utils
@1sat/client     ← @1sat/types, @1sat/constants
@1sat/core       ← @1sat/types, @1sat/protocols, @1sat/client
@1sat/wallet     ← @1sat/types, @1sat/protocols, @1sat/client, @bsv/wallet-toolbox
@1sat/connect    ← (standalone, browser-only)
@1sat/react      ← @1sat/connect, react
@1sat/sdk        ← @1sat/connect (+ future: @1sat/core)
```

### External Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `@bsv/sdk` | all | Transaction building, crypto |
| `@bsv/wallet-toolbox` | @1sat/wallet | BRC-100 wallet base |
| `satoshi-token` | @1sat/utils | tsat ↔ display conversion |
| `image-meta` | @1sat/utils | Icon validation (optional) |
| `react` | @1sat/react | React peer dep |

---

## Implementation Order

### Phase 1: Foundation ✅ COMPLETE
- [x] `@1sat/types` - All types from js-1sat-ord, compatible with wallet-toolbox
- [x] `@1sat/constants` - MAP_PREFIX, API endpoints, OrdLock scripts, fee config
- [x] `@1sat/utils` - Encoding, outpoint parsing, metadata stringify, icon/subtype validation

### Phase 2: Protocols ✅ COMPLETE
- [x] `@1sat/protocols` - MAP, Sigma, inscription envelope, OrdP2PKH, OrdLock

### Phase 3: Engine ✅ COMPLETE
- [x] `@1sat/client` - HTTP client, UTXO fetching, broadcasting, input utilities
- [x] `@1sat/core` - Wraps js-1sat-ord + TxBuilder fluent API
  - Ordinals: createOrdinals, sendOrdinals, burnOrdinals
  - Tokens: transferOrdTokens, deployBsv21Token
  - Listings: createOrdListings, purchaseOrdListing, cancelOrdListings
  - Token listings: createOrdTokenListings, purchaseOrdTokenListing, cancelOrdTokenListings
  - Utilities: sendUtxos, OrdP2PKH, OrdLock

### Phase 4: Wallet ✅ COMPLETE
- [x] `@1sat/wallet` - Full wallet engine (re-exports @1sat/wallet-toolbox)

### Phase 5: Integration ✅ COMPLETE
- [x] Update `@1sat/sdk` to bundle all packages with subpath exports
- [ ] Examples (pending)

---

## Source Material Mapping

| New Package | Source Files from js-1sat-ord |
|-------------|-------------------------------|
| `@1sat/types` | `src/types.ts` |
| `@1sat/constants` | `src/constants.ts` |
| `@1sat/utils` | `src/utils/strings.ts`, `src/utils/icon.ts`, `src/validate.ts` |
| `@1sat/protocols` | `src/signData.ts`, `src/templates/`, `src/subtypeData.ts` |
| `@1sat/client` | `src/utils/utxo.ts`, `src/utils/broadcast.ts`, `src/utils/httpClient.ts` |
| `@1sat/core` | `src/createOrdinals.ts`, `src/sendOrdinals.ts`, `src/transferOrdinals.ts`, `src/deployBsv21.ts`, `src/createListings.ts`, `src/purchaseOrdListing.ts`, `src/cancelListings.ts`, `src/sendUtxos.ts`, `src/burnOrdinals.ts` |

| New Package | Source Files from wallet-toolbox |
|-------------|----------------------------------|
| `@1sat/wallet` | `src/OneSatWallet.ts`, `src/services/`, `src/indexers/`, `src/signers/` |

---

## References

- [Phantom Connect SDK](https://github.com/phantom/phantom-connect-sdk)
- [Phantom Bitcoin Wallet Standard](https://github.com/phantom/bitcoin-wallet-standard)
- [js-1sat-ord](https://github.com/BitcoinSchema/js-1sat-ord)
- [1sat-wallet-toolbox](~/code/1sat-wallet-toolbox)
- [@bsv/sdk](https://github.com/bitcoin-sv/ts-sdk)
- [@bsv/wallet-toolbox](https://github.com/bitcoin-sv/wallet-toolbox)
