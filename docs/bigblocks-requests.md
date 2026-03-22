# BigBlocks Component Requests

Based on deep audit of all 19 blocks. Zero Next.js deps — all pure React client components. Most already support props-mode.

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

### 1. `token-list` — Add BSV20 support
**Current:** BSV21 only.
**Request:** Support both BSV20 and BSV21 tokens. Yours-wallet shows both. The `TokenListUI` component should accept a `protocol?: 'bsv20' | 'bsv21' | 'all'` filter or display both by default. The 1sat-web wallet tracks both. The desktop wallet needs both.

### 2. `token-list` — Make ORDFS URL injectable
**Issue:** `ORDFS_BASE = "https://ordfs.network"` is hardcoded in the hook, not overrideable.
**Request:** Accept `ordfsBase?: string` prop or allow `iconUrl` to be pre-populated in `TokenHolding` objects passed to `TokenListUI`.

### 3. `wallet-overview` — Make API URL overrideable
**Issue:** `DEFAULT_API_URL` is a module constant, not a prop. Balance fetch URL is baked in.
**Request:** Accept `apiUrl?: string` prop in the hook, or document that desktop apps should use `WalletOverviewUI` directly with local data.

### 4. `wallet-overview` — Decouple from `@1sat/react` WalletProvider
**Issue:** Requires `WalletProvider` from `@1sat/react` and `loadConnection()` from `@1sat/connect`.
**Request:** The `WalletOverviewUI` component already works without the provider (it's prop-driven). The hook (`useWalletOverview`) should be optional — document that desktop apps pass data to UI directly. OR: make the hook accept an optional wallet interface instead of requiring React context.

### 5. `ordinals-grid` — Add action callbacks
**Current:** Display-only grid. Click shows detail but no transfer/list actions.
**Request:** Add optional callbacks: `onTransfer?: (ordinal) => void`, `onList?: (ordinal) => void`, `onDetail?: (ordinal) => void`. Desktop wallet needs these for ordinal operations.

### 6. External link handling (multiple blocks)
**Affects:** `buy-listing`, `create-listing`, `deploy-token`, `inscribe-file`, `social-feed`
**Issue:** `<a target="_blank" href="https://whatsonchain.com/tx/...">` opens in WebView instead of system browser.
**Request:** Accept optional `onExternalLink?: (url: string) => void` callback. When provided, intercept the link click and call the callback instead of navigating. Desktop apps can then call `Utils.openExternal(url)` from Electrobun.

---

## New Blocks Needed

### 7. `mnemonic-flow` (in progress)
Multi-step wallet creation and import flow with `step-indicator`. Needs:
- Create mode: generate mnemonic → display grid → confirm checkbox → optional passphrase
- Import mode: editable 12/24 word grid → optional passphrase
- Restore mode: file picker for backup JSON/ZIP
- Callbacks: `onGenerate`, `onComplete`, `onImport`
- Support both 12 and 24 word mnemonics (yours-wallet supports both)

### 8. `receive-address`
QR code + deposit address display with rotation.
- QR code rendered from address string
- Truncated address with click-to-copy (full address)
- "New Address" button for BRC-29 rotation
- Props: `address: string`, `onRotate?: () => Promise<string>`, `onCopy?: (address: string) => void`
- Yours-wallet and 1sat-web both have this — BigBlocks doesn't

### 9. `transaction-history`
Transaction list with status indicators.
- Each row: txid (truncated, monospace), description, BSV amount (green=in, default=out), status dot (green/yellow/pulse), date
- Props: `entries: HistoryEntry[]`, `onLoadMore?: () => Promise<HistoryEntry[]>`
- Optional hook that calls `wallet.listActions()` for web context
- Both yours-wallet and 1sat-web have this

### 10. `lock-bsv`
Time-lock BSV and manage locks.
- Lock form: amount input, block height or date picker
- Lock summary card: total locked, unlockable, next unlock block
- Unlock button for matured locks
- Props/callbacks: `lockData: LockData`, `onLock`, `onUnlock`
- Yours-wallet has this (Tools → Lock BSV)

### 11. `sweep-wallet`
Sweep from WIF or legacy address.
- WIF input field
- Preview found UTXOs (BSV amount, ordinal count, token count)
- Sweep button with progress
- Callbacks: `onScan: (wif: string) => Promise<SweepPreview>`, `onSweep: (wif: string) => Promise<Result>`
- Both yours-wallet (Tools → Sweep) and 1sat-web (migration wizard) have this

### 12. `sync-terminal`
Monospace event log for blockchain sync activity.
- Dark bg, JetBrains Mono font
- Color-coded: log=muted, warn=amber, error=rose, success=green
- Auto-scroll, max buffer
- Header with sync status indicator (block height, connection state)
- Props: `events: SyncEvent[]`, `status?: { blockHeight: number; connected: boolean }`
- 1sat-web has `SyncActivityTerminal` — this is the BigBlocks version

### 13. `theme-token-provider`
On-chain theme picker using `@theme-token/sdk`.
- Settings panel: origin input, preview colors, Apply/Reset buttons
- Optional: browse published themes grid
- Uses: `fetchThemeByOrigin`, `applyThemeModeWithAssets`, `clearTheme` from `@theme-token/sdk`
- Persist selected theme origin to localStorage
- `ThemeTokenProvider` context wrapper for auto-applying saved theme on mount
- 1sat-web has this in settings (manual implementation) — BigBlocks should use the SDK properly

### 14. `opns-manager`
OpNS name management.
- List owned names with registration status (registered/unregistered)
- Register button (binds identity key)
- Deregister button
- Props: `names: OpnsName[]`, callbacks: `onRegister`, `onDeregister`
- 1sat-web has `/wallet/opns`

### 15. `unlock-wallet`
Touch ID / passphrase unlock screen.
- On macOS: "Unlock with Touch ID" button + fingerprint icon
- On other platforms: passphrase input field
- Error display for failed attempts
- Props: `platform?: 'macos' | 'other'`, `onUnlock: (passphrase?: string) => Promise<Result>`
- Every wallet has this — yours-wallet, 1sat-web, bsv-desktop

### 16. `send-bsv21`
Token send form (mirrors `send-bsv` but for BSV21 tokens).
- Token selector dropdown (from held balances)
- Amount input with decimal formatting based on token decimals
- Recipient address input
- Props: `balances: TokenBalance[]`, `onSend: (params) => Promise<Result>`
- Yours-wallet has this, desktop wallet needs it

---

## Hook Architecture Request

### `BigBlocksProvider` context
A provider that configures how all BigBlocks hooks fetch data. Two modes:

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

---

## Priority

**P0 — Desktop MVP:**
- `receive-address` (new)
- `transaction-history` (new)
- `mnemonic-flow` (in progress)
- `sync-terminal` (new)
- `token-list` upgrade (BSV20 + injectable ORDFS)
- `ordinals-grid` upgrade (action callbacks)

**P1 — Core features:**
- `lock-bsv` (new)
- `sweep-wallet` (new)
- `theme-token-provider` (new)
- `send-bsv21` (new)
- `unlock-wallet` (new)
- `opns-manager` (new)
- External link handling (upgrade across 5 blocks)
- `wallet-overview` upgrade (decouple from WalletProvider)

**P2 — Ecosystem:**
- `BigBlocksProvider` context
