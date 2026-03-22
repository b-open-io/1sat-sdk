# @1sat/wallet-desktop

Native desktop wallet for [1Sat Ordinals](https://1satordinals.com) built with [Electrobun](https://electrobun.dev). Uses a native Bun process for wallet logic and the system WebView for the UI -- no Chromium bundled. ~14MB bundle, <50ms startup.

## Architecture

The app runs as three cooperating processes:

```
┌─────────────────────────────────────────────────────────┐
│  Bun process (native)                                   │
│  - Wallet lifecycle (create, unlock, lock, delete)      │
│  - Vault: Secure Enclave + Touch ID (macOS)             │
│  - BRC-100 HTTP server on 127.0.0.1:3321                │
│  - Blockchain sync, monitor events                      │
├─────────────────────────────────────────────────────────┤
│  Typed RPC bridge (Electrobun)                          │
│  - Request/response: WebView calls Bun handlers         │
│  - Push messages: Bun pushes state/balance/sync events  │
│  - Shared type definitions in src/shared/types.ts       │
├─────────────────────────────────────────────────────────┤
│  WebView process (system)                               │
│  - React + Vite + Tailwind CSS v4                       │
│  - shadcn/ui with OKLCH dark theme                      │
│  - Three-panel layout: sidebar, content, wallet panel   │
│  - Sync terminal with live blockchain events            │
└─────────────────────────────────────────────────────────┘
```

Private keys never leave the Bun process. The WebView communicates exclusively through typed RPC -- it cannot access keys, the vault, or the wallet instance directly.

## Features

- Three-panel desktop layout (sidebar nav, content area, wallet panel) with keyboard shortcuts
- Secure Enclave key protection with Touch ID on macOS
- BRC-100 HTTP server on port 3321 for dApp connectivity
- Ordinals gallery, token balances, transaction history
- File inscription with native file picker
- Mnemonic-based wallet creation and import
- Sync terminal showing live blockchain events (broadcasts, proofs)
- shadcn/ui components with official 1Sat OKLCH dark theme

## Getting Started

```bash
cd packages/wallet-desktop
bun install

# Build and launch
bun start

# Development with Vite HMR
bun run dev:hmr

# Development without HMR (rebuild to see changes)
bun run dev
```

`bun run dev:hmr` runs Vite on port 5173 and Electrobun concurrently. The Bun process detects the dev server and loads from it instead of bundled assets.

## Project Structure

```
src/
├── bun/                    # Native Bun process
│   ├── index.ts            # Entry point: window, menu, RPC, lifecycle
│   ├── wallet-manager.ts   # Wallet singleton (create/unlock/lock/delete)
│   ├── vault-manager.ts    # Secure Enclave vault (macOS)
│   ├── http-server.ts      # BRC-100 HTTP server (port 3321)
│   └── rpc-handlers.ts     # RPC request handlers
├── mainview/               # React UI (runs in system WebView)
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Root component (onboarding vs desktop layout)
│   ├── rpc.ts              # WebView-side RPC client + pub/sub
│   ├── hooks/              # use-wallet, use-sync-events
│   ├── components/
│   │   ├── layout/         # DesktopLayout, SidebarNav, WalletPanel
│   │   ├── ui/             # shadcn/ui primitives
│   │   └── ...             # Domain components (ordinal cards, token rows, etc.)
│   └── views/              # Route views (dashboard, ordinals, tokens, history, inscribe, settings)
└── shared/
    └── types.ts            # RPC schema + shared type definitions
```

**Bun process** (`src/bun/`): All wallet, vault, and blockchain logic. Edit here for wallet behavior, new RPC handlers, or server changes.

**WebView** (`src/mainview/`): React UI only. Communicates with the Bun process through `rpc.ts`. Edit here for UI changes.

**Shared types** (`src/shared/`): The RPC schema that both sides reference. Adding a new RPC method means defining it here first.

## Build for Distribution

```bash
bun run build:canary
```

This runs `vite build` then `electrobun build --env=canary` to produce a distributable app bundle.

## BRC-100 dApp Connectivity

The desktop wallet exposes all 28 `WalletInterface` methods as POST endpoints on `http://127.0.0.1:3321`. This is compatible with `WalletClient` from `@bsv/sdk`:

```typescript
import { WalletClient } from '@bsv/sdk'

// 'auto' discovers the local wallet server
const wallet = new WalletClient('auto')
const { publicKey } = await wallet.getPublicKey({ identityKey: true })
```

The server includes CORS headers and private network access headers for browser-based dApps. When the wallet is locked, all endpoints return 503.

## Key Dependencies

| Package | Role |
|---------|------|
| `@1sat/wallet-node` | BRC-100 wallet engine (SQLite storage) |
| `@1sat/wallet-mac` | macOS Secure Enclave provider |
| `@1sat/vault` | Platform-agnostic vault interface |
| `@1sat/actions` | Wallet actions (inscribe, send, tokens) |
| `@1sat/client` | Indexer API and broadcast |
| `@1sat/types` | Shared type definitions and constants |
| `electrobun` | Desktop runtime (native Bun + system WebView) |

## Platform Support

macOS is fully supported with Secure Enclave + Touch ID. Other platforms will fail immediately at vault initialization with an informative error until platform-specific vault providers are added.

## License

MIT
