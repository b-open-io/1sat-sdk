# Accounts / Capacity Gate

**Status:** Server wired. Client auto-retry not yet implemented.

## Goal

Per-identity storage metering for `@1sat/wallet-server`. Users get a free
baseline of bytes. Beyond baseline, they pay for capacity in purchase
units (configurable size) that last for a fixed block window. A new
payment supersedes the prior one with a prorated refund credit for the
unused time.

## What shipped this session

- **`GET /account/status`** — BRC-100 auth'd. Returns `usedBytes`,
  `baselineBytes`, `paidBytes`, `capacityBytes`, `deficitBytes`,
  `paidThroughBlock`, `currentBlock`, and pricing
  (`purchaseUnitBytes`, `satsPerUnit`, `durationBlocks`). Works in
  both enabled and disabled states (always reports usage).

- **`POST /account/payment`** — BRC-100 auth'd. Body:
  `{ transaction: base64 AtomicBEEF, derivationPrefix,
  derivationSuffix, outputIndex? }`. Server calls
  `wallet.internalizeAction`, records a payment row, returns updated
  quota.

- **507 Insufficient Storage gate** — replaces the earlier BRC-0121
  402 flow. When a billable RPC is over capacity, server returns
  507 with a JSON body describing the deficit + pricing +
  `paymentEndpoint: '/account/payment'`.

- **Purchase unit pricing.** `purchaseUnitBytes` + `satsPerUnit`
  replace `satsPerGb`. Dev can use small units (5 KB × 5 sats) to
  exercise crossings cheaply; production stays GB-sized.

- **Refund-credit pricing.** New payments charge the full rate for
  fresh capacity minus a prorated credit for unused time on the prior
  payment. One active payment row per account; prior rows stay as
  audit trail but aren't consulted for capacity.

- **Accounts tables in the wallet schema.** `accounts` and `payments`
  tables live in `StorageBunSqlite`'s migration sequence. Same
  connection as the wallet — no separate driver, no lock contention.
  Future `StoragePg` includes them too.

- **`WalletServerClient`** in `@1sat/wallet-server`. Extends the
  `@1sat/client` `BaseClient` pattern, uses `AuthFetch` for the
  BRC-100 handshake, exposes `accountStatus()` and `postPayment()`.

- **Monitor in factory.** Construction moved from per-wrapper
  (`createNodeWallet`, `createWebWallet`) into
  `createWalletCore`. Includes a `BackupSync` task that runs
  periodically but only when local is the active store.

- **CLI `1sat remote status [url]`** surfaces the status endpoint.

## What's next

### 1. Client auto-retry

Wrap `wallet.createAction` / `signAction` / `processAction` at the
factory level. On a 507 from the active remote:

1. Build a BRC-29 payment tx. Needs a mechanism that doesn't route
   through the outer call's lock (either a dedicated payment wallet
   with local-only storage, or temporarily flipping `activeStorage`
   to local while no lock is held).
2. `WalletServerClient.postPayment(...)` to the remote.
3. Retry the original RPC with capacity now covering the write.

### 2. Per-remote policy

Each remote configured as `fund` (auto-pay) or `disconnect` (drop
the provider and notify). Factory config:

```ts
interface WalletCoreConfig {
  remotePolicy?: 'fund' | 'disconnect'                  // default
  remotePolicies?: Record<string, 'fund' | 'disconnect'> // per-URL
  onStorageFunded?: (info) => void
  onStorageDisconnected?: (info) => void
}
```

### 3. CLI `1sat remote topup`

Manual top-up. Good for testing and non-auto-fund deployments.
Fetches status, builds payment via local-active, POSTs to
`/account/payment`, reports new quota.

### 4. Postgres provider

Native `StoragePg` that mirrors `StorageBunSqlite`. Accounts/payments
tables live in its migration sequence too. Required before production.

## Key files

- Capacity gate + payment handler:
  `packages/wallet-server/src/accounts/middleware.ts`
- Refund-credit math:
  `packages/wallet-server/src/accounts/pricing.ts`
- Accounts repo (sqlite impl):
  `packages/wallet-server/src/accounts/repo.ts`
- Wallet schema (incl. accounts tables):
  `packages/wallet-node/src/storage-bun-sqlite.ts`
- Routes + middleware mounting:
  `packages/wallet-server/src/createWalletServer.ts`
- Client SDK:
  `packages/wallet-server/src/client.ts`
- Factory (Monitor, BackupSync task):
  `packages/wallet/src/factory.ts`
- Node wrapper:
  `packages/wallet-node/src/createNodeWallet.ts`

## Architectural notes (hard-won)

- **Don't use HTTP 402 for wallet-storage self-billing.** AuthFetch
  auto-pays 402s by calling `wallet.createAction`. That call re-enters
  `WalletStorageManager`, whose writer lock is held from the outer
  billable op. Non-reentrant. Silent deadlock. Use any non-402 error
  (we chose 507).

- **Self-payment-build bypass on 402 doesn't help.** The lock is
  acquired in the outer call *before* the 402 is received. The
  payment-building inner `createAction` never reaches the server's
  bypass check.

- **Per-op `updateBackups` interception is a bad idea on a metered
  remote.** Every write triggers a sync push that can cross the
  capacity threshold and re-enter the gate. Moved to a periodic
  Monitor task (`BackupSync`) that only fires when local is active.

- **Workspace `"bun"` exports condition.** Each `@1sat/*` package's
  `exports` has `"bun": "./src/index.ts"` ahead of `"import"`. Bun
  resolves workspace packages to source directly, so `git pull` on a
  dev machine (mss1, local) picks up code changes without
  `bun run build`. Non-bun consumers (npm installs, node) still hit
  `dist`.

- **Monitor belongs in the factory.** Both node and browser wrappers
  were constructing identical Monitors. `toolbox.Monitor` injection
  stays because browser uses `@bsv/wallet-toolbox-mobile` and node
  uses `@bsv/wallet-toolbox` — consumer provides the concrete class.

## Deployment / test state (as of session end)

- **mss1** running with: `server.accounts.enabled=true`,
  `baselineBytes=5120`, `purchaseUnitBytes=5120`, `satsPerUnit=5`,
  `durationBlocks=10`. Service healthy on port 8100.
- **Local CLI** (David): `activeRemote=http://mss1:8100/`. Used bytes
  on mss1 under David's identity ≈ 10 KB → deficit ≈ 4.9 KB. Any
  billable RPC returns a clean 507 today.
- The `1sat wallet send` path produces
  `WalletStorageClient rpcCall: network error 507 507` — deliberate;
  auto-retry not yet implemented.
