# WPM Integration & Message Box for Paymail

## Context

`customInstructions` on wallet outputs is encrypted by WalletPermissionsManager (WPM). The Go server stores/returns encrypted blobs without transformation. MCP couldn't read customInstructions (no WPM), paymail wrote plaintext (no encryption key), and OPNS re-publish failed on encrypted ciphertext.

## Steps

### Step 1: Add WPM to MCP wallet init — COMPLETE
- `bsv-mcp/utils/walletInit.ts` wraps wallet in WPM with admin originator `'bsv-mcp'`
- All permission prompts disabled, `encryptWalletMetadata: true`
- `ctx.wallet` is now WPM; balance queries work because MCP is admin originator

### Step 2: Revert OPNS actions — COMPLETE
- `opnsRegister` and `opnsDeregister` reverted to `JSON.parse(ordinal.customInstructions)` for protocolID/keyID
- Removed hardcoded `ONESAT_PROTOCOL` / `ordinal.outpoint`

### Step 4: Export go-messagebox-server packages — COMPLETE
- Moved `internal/db/`, `internal/handlers/`, `internal/config/` to `pkg/`
- Updated imports in `cmd/server/main.go` and handler files
- Used `git mv` for history preservation

### Step 5: Integrate message box into 1sat-stack — COMPLETE
- Created `pkg/messagebox/` (config.go, routes.go) following standard service pattern
- Wired into `cmd/server/config.go` (Config struct, Initialize, RegisterRoutes with auth middleware)
- DB path: `~/.1sat/messagebox.db`, uses `adaptor.HTTPHandler` wrapping

### Step 6: Change paymail to deliver to message box — COMPLETE
- Replaced `internalizePayment` with `DeliverToMessageBox` on the Service
- `PaymailMessage` struct carries BEEF hex, output index, derivation prefix/suffix, sender identity key, satoshis, alias
- Messages go to `payment_inbox` box keyed by recipient identity key
- Removed `WalletProvider` dependency from paymail entirely
- Arcade broadcast unchanged

### Step 7: Add message box sync to wallet clients — COMPLETE
- Created shared `internalizeBeef` utility in `packages/actions/src/utils/internalizeBeef.ts`
  - Supports two modes: explicit vout matching (`outputs`) and owner-address matching (`addressDerivations`)
  - Handles BEEF parsing, source tx loading, indexer pipeline, InternalizeOutput building, wallet.internalizeAction()
- Refactored `syncAddresses` to use shared `internalizeBeef` (removed ~200 lines of duplicated code)
- Created `syncMessages` action in `packages/actions/src/sync/syncMessages.ts`
  - Uses `AuthFetch` from `@bsv/sdk/auth` for BRC-103/104 authenticated calls
  - Calls `POST /listMessages` with `{"messageBox": "payment_inbox"}`
  - For each message: parses PaymailMessage body, calls `internalizeBeef` with explicit output derivation
  - Only acknowledges messages after successful internalization
- Wired into MCP wallet init (`bsv-mcp/utils/walletInit.ts`) — fire-and-forget on startup
- Wired into 1sat-website sync engine (`providers/hooks/use-sync-engine.ts`) — runs in parallel with address sync

### Step 8: Clean up DB anomalies — COMPLETE
- Stopped server, backed up wallet.sqlite via `sqlite3 .backup`, verified integrity
- Output 1551 (OPNS "asd"): set `spendable=1`, cleared `spent_by` (on-chain UTXO exists, tx 550 never broadcast)
- Output 1842: deleted (orphan from failed tx 550)
- Output 1965: deleted (plaintext paymail from failed tx 606, no on-chain state)
- Restarted server

### Step 9: Publish updated packages — NOT STARTED
- `@1sat/actions` (OPNS revert + syncMessages)
- `go-messagebox-server` (pkg exports)
- `1sat-stack` (message box + paymail changes)
