# BigBlocks Component Requests

Based on deep audit of all 30 blocks. Zero Next.js deps — all pure React client components. Most already support props-mode.

## CLI Installation

```bash
# npx shorthand (recommended)
npx bigblocks add <block>

# or direct shadcn CLI
bunx shadcn@latest add https://registry.bigblocks.dev/r/<block>.json
```

Both commands copy the block source into your project. No runtime dependency on BigBlocks.

## Audit Summary: What Already Works for Desktop

These blocks need **zero modifications** for Electrobun:
- `bitcoin-avatar` — prop-driven, no API calls
- `buy-listing` — callback-driven (`onPurchase`), ORDFS thumbnails
- `create-listing` — callback-driven (`onList`)
- `deploy-token` — callback-driven (`onDeploy`)
- `follow-button` — callback-driven
- `friend-button` — callback-driven
- `identity-selector` — accepts `identities[]` prop, skips fetch
- `inscribe-file` — callback-driven (`onInscribe`), has File/BSV20/BSV21 tabs
- `like-button` — callback-driven
- `post-button` — callback-driven (`onPost`)
- `send-bsv` — callback-driven (`onSend`), no wallet context needed
- `step-indicator` — pure presentational
- `profile-card` — accepts data via `ProfileCardUI` directly
- `social-feed` — accepts data via `SocialFeedUI` directly

---

## Existing Block Upgrades Needed

> Status: **IN PROGRESS** — agents are working on these upgrades now.

### 1. `token-list` — Add BSV20 support [IN PROGRESS]
**Current:** BSV21 only.
**Request:** Support both BSV20 and BSV21 tokens. Yours-wallet shows both. The `TokenListUI` component should accept a `protocol?: 'bsv20' | 'bsv21' | 'all'` filter or display both by default. The 1sat-web wallet tracks both. The desktop wallet needs both.

### 2. `token-list` — Make ORDFS URL injectable [IN PROGRESS]
**Issue:** `ORDFS_BASE = "https://ordfs.network"` is hardcoded in the hook, not overrideable.
**Request:** Accept `ordfsBase?: string` prop or allow `iconUrl` to be pre-populated in `TokenHolding` objects passed to `TokenListUI`.

### 3. `wallet-overview` — Make API URL overrideable [IN PROGRESS]
**Issue:** `DEFAULT_API_URL` is a module constant, not a prop. Balance fetch URL is baked in.
**Request:** Accept `apiUrl?: string` prop in the hook, or document that desktop apps should use `WalletOverviewUI` directly with local data.

### 4. `wallet-overview` — Decouple from `@1sat/react` WalletProvider [IN PROGRESS]
**Issue:** Requires `WalletProvider` from `@1sat/react` and `loadConnection()` from `@1sat/connect`.
**Request:** The `WalletOverviewUI` component already works without the provider (it's prop-driven). The hook (`useWalletOverview`) should be optional — document that desktop apps pass data to UI directly. OR: make the hook accept an optional wallet interface instead of requiring React context.

### 5. `ordinals-grid` — Add action callbacks [IN PROGRESS]
**Current:** Display-only grid. Click shows detail but no transfer/list actions.
**Request:** Add optional callbacks: `onTransfer?: (ordinal) => void`, `onList?: (ordinal) => void`, `onDetail?: (ordinal) => void`. Desktop wallet needs these for ordinal operations.

### 6. External link handling (multiple blocks) [IN PROGRESS]
**Affects:** `buy-listing`, `create-listing`, `deploy-token`, `inscribe-file`, `social-feed`
**Issue:** `<a target="_blank" href="https://whatsonchain.com/tx/...">` opens in WebView instead of system browser.
**Request:** Accept optional `onExternalLink?: (url: string) => void` callback. When provided, intercept the link click and call the callback instead of navigating. Desktop apps can then call `Utils.openExternal(url)` from Electrobun.

---

## New Blocks — DONE

All 10 new blocks have been built and are live in the registry at https://registry.bigblocks.dev.

### 7. `mnemonic-flow` — DONE
Multi-mode seed phrase display and input block with create, display, import, and verify modes. Includes numbered word grid, copy-all, confirmation checkbox, and verification challenge. Supports both 12 and 24 word mnemonics.

```bash
npx bigblocks add mnemonic-flow
```

### 8. `receive-address` — DONE
QR code and deposit address display with clipboard copy and optional address rotation. Supports default, compact, and inline variants.

```bash
npx bigblocks add receive-address
```

### 9. `transaction-history` — DONE
Transaction list with status indicators, amounts, relative dates, and pagination. Supports default and compact variants with inbound/outbound display.

```bash
npx bigblocks add transaction-history
```

### 10. `lock-bsv` — DONE
Time-lock BSV until a future block height with lock form, lock summary, and unlock for matured locks via @1sat/actions lockBsv and unlockBsv.

```bash
npx bigblocks add lock-bsv
```

### 11. `sweep-wallet` — DONE
Sweep assets from a WIF private key into the connected wallet. Scans for funding UTXOs, ordinals, and BSV-21 tokens, previews found assets, and sweeps with progress.

```bash
npx bigblocks add sweep-wallet
```

### 12. `sync-terminal` — DONE
Monospace event log for blockchain sync activity with colour-coded severity levels, auto-scroll, and connection status indicator.

```bash
npx bigblocks add sync-terminal
```

### 13. `theme-token-provider` — DONE
On-chain theme picker using @theme-token/sdk. Provider context and settings panel for selecting, applying, and persisting blockchain-inscribed ThemeTokens.

```bash
npx bigblocks add theme-token-provider
```

### 14. `opns-manager` — DONE
OpNS name management block for listing owned names and registering or deregistering identity key bindings via @1sat/actions opns module.

```bash
npx bigblocks add opns-manager
```

### 15. `unlock-wallet` — DONE
Passphrase and biometric unlock screen with Touch ID support on macOS, passphrase fallback, failed attempt tracking, and success state.

```bash
npx bigblocks add unlock-wallet
```

### 16. `send-bsv21` — DONE
Token send form with selector dropdown, decimal-aware amount input, recipient address, and confirmation flow for transferring BSV21 fungible tokens.

```bash
npx bigblocks add send-bsv21
```

---

## BigBlocksProvider Context — DONE

The `BigBlocksProvider` configures how all BigBlocks hooks fetch data. Two modes:

```tsx
// Web mode — hooks fetch from 1sat-stack API
<BigBlocksProvider apiUrl="https://api.1sat.app">
  <App />
</BigBlocksProvider>

// Desktop/custom mode — hooks call provided functions
<BigBlocksProvider
  getBalance={async () => rpc.request.getBalance()}
  getOrdinals={async (limit) => rpc.request.getOrdinals({ limit })}
  getTokenBalances={async () => rpc.request.getTokenBalances()}
  getHistory={async (limit) => rpc.request.getTransactionHistory({ limit })}
>
  <App />
</BigBlocksProvider>
```

This way blocks work identically in web and desktop — the data source is configured once at the root.

```bash
npx bigblocks add bigblocks-provider
```

---

## Full Registry (30 blocks)

| Block | Category | Install |
|-------|----------|---------|
| `step-indicator` | ui | `npx bigblocks add step-indicator` |
| `bitcoin-avatar` | identity | `npx bigblocks add bitcoin-avatar` |
| `connect-wallet` | wallet | `npx bigblocks add connect-wallet` |
| `inscribe-file` | ordinals | `npx bigblocks add inscribe-file` |
| `create-listing` | market | `npx bigblocks add create-listing` |
| `buy-listing` | market | `npx bigblocks add buy-listing` |
| `send-bsv` | wallet | `npx bigblocks add send-bsv` |
| `post-button` | social | `npx bigblocks add post-button` |
| `like-button` | social | `npx bigblocks add like-button` |
| `follow-button` | social | `npx bigblocks add follow-button` |
| `friend-button` | social | `npx bigblocks add friend-button` |
| `deploy-token` | token | `npx bigblocks add deploy-token` |
| `token-list` | token | `npx bigblocks add token-list` |
| `market-grid` | market | `npx bigblocks add market-grid` |
| `ordinals-grid` | ordinals | `npx bigblocks add ordinals-grid` |
| `social-feed` | social | `npx bigblocks add social-feed` |
| `profile-card` | identity | `npx bigblocks add profile-card` |
| `identity-selector` | identity | `npx bigblocks add identity-selector` |
| `wallet-overview` | wallet | `npx bigblocks add wallet-overview` |
| `receive-address` | wallet | `npx bigblocks add receive-address` |
| `transaction-history` | wallet | `npx bigblocks add transaction-history` |
| `sync-terminal` | wallet | `npx bigblocks add sync-terminal` |
| `mnemonic-flow` | wallet | `npx bigblocks add mnemonic-flow` |
| `lock-bsv` | wallet | `npx bigblocks add lock-bsv` |
| `sweep-wallet` | wallet | `npx bigblocks add sweep-wallet` |
| `opns-manager` | identity | `npx bigblocks add opns-manager` |
| `send-bsv21` | token | `npx bigblocks add send-bsv21` |
| `unlock-wallet` | wallet | `npx bigblocks add unlock-wallet` |
| `bigblocks-provider` | core | `npx bigblocks add bigblocks-provider` |
| `theme-token-provider` | theme | `npx bigblocks add theme-token-provider` |

---

## Priority

**P0 — Desktop MVP:**
- `receive-address` -- DONE
- `transaction-history` -- DONE
- `mnemonic-flow` -- DONE
- `sync-terminal` -- DONE
- `token-list` upgrade (BSV20 + injectable ORDFS) -- IN PROGRESS
- `ordinals-grid` upgrade (action callbacks) -- IN PROGRESS

**P1 — Core features:**
- `lock-bsv` -- DONE
- `sweep-wallet` -- DONE
- `theme-token-provider` -- DONE
- `send-bsv21` -- DONE
- `unlock-wallet` -- DONE
- `opns-manager` -- DONE
- External link handling (upgrade across 5 blocks) -- IN PROGRESS
- `wallet-overview` upgrade (decouple from WalletProvider) -- IN PROGRESS

**P2 — Ecosystem:**
- `BigBlocksProvider` context -- DONE
