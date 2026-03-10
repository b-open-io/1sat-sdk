# Unified CWI Factory in @1sat/wallet

## Problem

CWI (`WalletInterface`) creation is fragmented across repos. The web wallet iframe/postMessage transport doesn't produce a `WalletInterface` through the same factory as the extension transports. dApps reference `window.CWI` directly instead of using `WalletClient` from ts-sdk for substrate auto-detection.

## Goal

1. `@1sat/wallet` owns all CWI creation via `createCWI(transport)` with transport-specific factories
2. dApps use `WalletClient` from `@bsv/sdk` for auto-detection of available wallets, with explicit instantiation for the web wallet
3. No dApp code references `window.CWI` directly

## Architecture

### CWI Factories in @1sat/wallet

```
@1sat/wallet/cwi
├── createCWI(transport)       — generic factory: any transport → WalletInterface
├── createEventCWI()           — CustomEvent transport (extension inject into page)
├── createChromeCWI()          — chrome.runtime transport (extension popup/options)
└── createWebCWI(config)       — postMessage/iframe transport (remote web wallet)
```

All return the same `WalletInterface`. The difference is only the transport mechanism.

| Factory | Transport | Message Path |
|---|---|---|
| `createEventCWI()` | CustomEvent on `self` | page → content script → chrome.runtime → service worker |
| `createChromeCWI()` | `chrome.runtime.sendMessage` | popup → service worker |
| `createWebCWI(config)` | `postMessage` to iframe | dApp → iframe → BroadcastChannel → wallet tab |

`createEventCWI()` and `createChromeCWI()` already exist. `createWebCWI()` is new.

### dApp Wallet Instantiation

`WalletClient` from `@bsv/sdk` (ts-sdk) auto-detects available wallets by trying substrates in order:

1. `window.CWI` (extension)
2. WalletWire binary protocol (desktop wallet)
3. HTTPWalletJSON (desktop wallet)
4. ReactNativeWebView (mobile)
5. XDM postMessage fallback

For the web wallet (1sat.market or similar), auto-detection doesn't apply — it requires a configured URL. dApps instantiate it explicitly:

```typescript
import { WalletClient } from '@bsv/sdk'
import { createWebCWI } from '@1sat/wallet'

// Auto-detect extension or desktop wallets
const wallet = new WalletClient('auto', 'my-app.com')

// OR explicitly use the web wallet when no local wallet is available
const wallet = new WalletClient(
  await createWebCWI({ walletUrl: 'https://1sat.market' })
)
```

A ts-sdk substrate for the web wallet could be added later via PR, but is not a priority.

### Who uses what

| Consumer | Today | Target |
|---|---|---|
| yours-wallet inject.ts | `createEventCWI()` from `@1sat/wallet` | No change |
| yours-wallet popup | `createChromeCWI()` from `@1sat/wallet` | No change |
| 1sat-website (host side) | Custom bridge/relay | No change (wallet-host-specific) |
| 1sat-website (dApp side) | Custom embed code | `createWebCWI()` from `@1sat/wallet` |
| Admin UI | `window.CWI` directly | `WalletClient('auto')` with `createWebCWI()` fallback |
| Any new dApp | Varies | `WalletClient('auto')` with `createWebCWI()` fallback |

## Changes

### 1. Add createWebCWI() to @1sat/wallet

Move the postMessage/iframe transport plumbing into `@1sat/wallet/cwi/web.ts`.

`createWebCWI(config)`:
- Creates a hidden iframe pointing to `config.walletUrl + '/wallet/cwi'`
- Performs handshake (waits for iframe ready signal)
- Wraps postMessage send/receive as a `CWITransport` function
- Calls `createCWI(transport)` to return a `WalletInterface`
- Handles iframe lifecycle (create on connect, destroy on disconnect)

```typescript
interface WebCWIConfig {
  walletUrl: string    // e.g. "https://1sat.market"
}
```

The protocol is generic — any wallet host that handles `{type: "CWI", id, call, args}` messages and responds with `{type: "CWI", id, result}` works.

### 2. Update @1sat/connect to use createWebCWI()

Connect's `EmbedTransport` has the postMessage/iframe logic today. After moving it to wallet:
- Connect imports and uses `createWebCWI()` instead of its own transport
- Connect's higher-level provider (`OneSatProvider`) continues to work
- No breaking changes to connect's public API

### 3. Update admin UI to use WalletClient

Replace direct `window.CWI` usage with `WalletClient` from `@bsv/sdk`:
- Auto-detects extension if present
- Falls back to `createWebCWI()` for 1Sat web wallet
- Wallet selector UI offers both options when applicable

### 4. Event listeners

The `on()`/`removeListener()` methods for `switchAccount`/`signedOut` events should be part of the `createCWI()` factory so all transports get them. Currently bolted onto `window.CWI` in yours-wallet's inject.ts — move into the factory level.

## What this does NOT cover

- `OneSatProvider` / `window.onesat` — separate concern, stays in connect
- `@1sat/connect` popup-based provider — continues to work, updated to use new transport
- Host-side wallet processing (bridge.ts, relay.ts) — stays in 1sat-website
- ts-sdk substrate PR for web wallet — future nice-to-have
