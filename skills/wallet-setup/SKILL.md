---
name: wallet-setup
description: "This skill should be used when setting up a 1Sat wallet programmatically, creating a new wallet instance, configuring local + remote storage, managing the active storage, syncing addresses, or restoring from a backup file. Triggers on 'create wallet', 'setup wallet', 'initialize wallet', 'wallet storage', 'active storage', 'IndexedDB wallet', 'SQLite wallet', 'BRC-100 wallet', 'wallet factory', 'remote storage', 'set active storage', 'add remote', 'address sync', 'full sync', 'wallet backup', or 'restore backup'. Uses @1sat/wallet, @1sat/wallet-node, @1sat/wallet-browser, and @1sat/wallet-remote packages."
---

# Wallet Setup

Create, configure, and manage 1Sat wallets programmatically across Node.js, browser (extension / web app), or thin-client environments.

## Package choice

Each package is a thin shim over a shared factory in `@1sat/wallet`. They differ only in what local storage they create.

| Package | Environment | Local storage |
|---|---|---|
| `@1sat/wallet-node` | Node.js / Bun (server, CLI) | SQLite via `StorageBunSqlite` or `StorageKnex` |
| `@1sat/wallet-browser` | Browser (extensions, web apps) | IndexedDB via `StorageIdb` |
| `@1sat/wallet-remote` | Any (thin client) | **None** — remote is the only store |
| `@1sat/wallet` | Core factory consumed by the above | n/a |

Pick `wallet-remote` only when you explicitly do not want a local store. For everything else (including extensions), pick the environment-specific package — `wallet-node` or `wallet-browser`.

## Core config

All factories share a common core (`WalletCoreConfig` in `@1sat/wallet`). The fields below apply everywhere; each wrapper adds its own local-storage and runtime fields (see below).

```typescript
{
  privateKey: PrivateKey | string,       // PrivateKey, WIF, or 64-char hex
  chain: 'main' | 'test',
  feeModel?: { model: 'sat/kb', value: number },   // default { model: 'sat/kb', value: 100 }

  // Storage topology
  activeRemote?: string,                 // URL of the active remote, or undefined for local-active
  backups?: string[],                    // Additional remote URLs registered as backups

  // Transaction lifecycle callbacks (only fire while Monitor runs)
  onTransactionBroadcasted?: (txid: string) => void,
  onTransactionProven?: (txid: string, blockHeight: number) => void,

  connectionTimeout?: number,            // Remote connection timeout in ms, default 5000

  // Periodic local→backup sync interval (ms). Default 5 min; 0 disables.
  // Ignored when activeRemote is set (remote is canonical).
  backupSyncIntervalMs?: number,

  // 507 Insufficient Storage auto-retry consent hook (active-remote only).
  // Default behavior when omitted is auto-fund.
  onStoragePaymentRequired?: StoragePaymentHook,

  // Cross-process Monitor task-state persistence (lastRunMsecsSinceEpoch
  // + TaskNewHeader queued chain-tip). Wrappers default this for you.
  taskStateStore?: TaskStateStore,

  // Override OneSatServices base URL (broadcast target). Falls through to
  // ONESAT_MAINNET_URL / ONESAT_TESTNET_URL. wallet-node also honors the
  // ONESAT_API_URL env var when unset.
  servicesBaseUrl?: string,
}
```

`storageIdentityKey` is **not** a core field — it belongs to the local-storage wrappers (`wallet-node`, `wallet-browser`) because it names the local store. `wallet-remote` has no local store and no `storageIdentityKey`.

### `storageIdentityKey`

This identifies the **local store** to the `WalletStorageManager`. It must be **unique per install** — two installs of the same account that both claim the same `storageIdentityKey` will be indistinguishable to the remote's `user.activeStorage` tracking, leading to data divergence.

Pick something like a UUID or `<app>-<random-hex>` at install time and persist it. Don't hardcode a constant across installs.

### `activeRemote` and `backups`

- `activeRemote` unset ⇒ local is the active store; optional `backups[]` are remotes that receive `updateBackups()` pushes.
- `activeRemote` set ⇒ that remote is active; local (if created by the factory) is added as a backup automatically; additional URLs in `backups[]` are added alongside.
- A URL passed as `activeRemote` should not also appear in `backups[]` — the factory does not dedup.

## Node.js wallet

Local storage is selected via the `storage` field — `bun-sqlite` (default) or `pg`. The `pg` driver is a dynamic import (optional peer dep), so bun-sqlite-only consumers don't pay for it.

```typescript
import { createNodeWallet } from '@1sat/wallet-node'

const result = await createNodeWallet({
  privateKey: 'L1...',
  chain: 'main',
  storageIdentityKey: 'my-agent-abc123',

  // Local storage backend. Defaults to { provider: 'bun-sqlite', filename: './wallet.db' }.
  storage: { provider: 'bun-sqlite', filename: '~/.myapp/wallet.db' },
  // or: storage: { provider: 'pg', dbUrl: 'postgres://user:pass@host/db', pool: { min: 1, max: 10 } }

  activeRemote: 'https://storage.example.com',   // optional
  backups: ['https://backup.example.com'],        // optional

  skipInitialMonitor: false,             // skip boot runOnce() when another monitor process owns this DB

  onTransactionBroadcasted: (txid) => console.log('Broadcast:', txid),
  onTransactionProven: (txid, blockHeight) => console.log('Proven:', txid, blockHeight),
})

// ...use result.wallet for BRC-100 operations

await result.destroy()  // awaits any in-flight boot runOnce, stops monitor, destroys wallet, closes DB
```

`NodeWalletConfig` adds these over the core config: `storageIdentityKey` (required), `storage?: { provider: 'bun-sqlite', filename? } | { provider: 'pg', dbUrl, pool? }`, and `skipInitialMonitor?`. For bun-sqlite, `taskStateStore` defaults to a JSON sidecar next to the DB file (`<filename>.tasks.json`); for Postgres no default is constructed.

### `NodeWalletResult`

| Field | Type | Notes |
|---|---|---|
| `wallet` | `Wallet` | BRC-100 wallet instance |
| `services` | `OneSatServices` | 1Sat API access |
| `monitor` | `Monitor` | Always present. See "Monitor" below. |
| `storage` | `WalletStorageManager` | Multi-store manager (active + backups) |
| `remoteStorage` | `StorageClient?` | Convenience handle to the first configured remote, if any |
| `setActiveStorage` | `(target: 'local' \| string) => Promise<void>` | Switch the active store |
| `addRemote` | `(url: string) => Promise<void>` | Register a remote as a non-active backup |
| `getActiveStorage` | `() => sdk.WalletStorageProvider` | Live getter for the active raw provider. Use this (not `storage`) when wiring a multi-tenant RPC server — the manager is single-tenant. Node-only. |
| `destroy` | `() => Promise<void>` | Cleanup: stops monitor, destroys wallet, closes DB |

## Browser wallet

```typescript
import { createWebWallet, createIndexedDbTaskStateStore } from '@1sat/wallet-browser'

const result = await createWebWallet({
  privateKey: keys.identityWif,
  chain: 'main',
  storageIdentityKey: 'yours-abc123',

  activeRemote: undefined,               // undefined = local-active
  backups: ['https://api.1sat.app/1sat/wallet'],

  // Persist Monitor task state across service-worker wakes so wakes within a
  // task's interval are effectively no-ops. Use the standard IndexedDB store.
  taskStateStore: createIndexedDbTaskStateStore(),

  onMonitorEvent: (event) => console.log('monitor:', event),  // MonitorEvent stream
})
```

`WebWalletConfig` adds `storageIdentityKey` (required), `taskStateStore?`, `onMonitorEvent?: (event: MonitorEvent) => void`, and `servicesBaseUrl?` over the core config. `WebWalletResult` matches `NodeWalletResult` minus the Node-only `getActiveStorage`. Local storage is an IndexedDB (`StorageIdb`).

## Remote wallet (thin client)

No local storage; `activeRemote` is required.

```typescript
import { createRemoteWallet } from '@1sat/wallet-remote'

const result = await createRemoteWallet({
  privateKey: 'L1...',
  chain: 'main',
  activeRemote: 'https://storage.example.com',
  backups: ['https://mirror.example.com'],   // optional
})
```

`RemoteWalletConfig` has no `storageIdentityKey`, `taskStateStore`, or `onTransaction*` fields — it's the core config with `activeRemote` made required. `RemoteWalletResult` is `{ wallet, services, storage, feeModel, setActiveStorage, addRemote, destroy }`: no `monitor` (the server runs its own), no `remoteStorage` handle, no `getActiveStorage`. `setActiveStorage('local')` throws because there is no local store.

## Storage topology operations

After creation, the wallet result exposes three active-storage operations:

```typescript
await result.setActiveStorage('local')              // promote local to active
await result.setActiveStorage('https://other.com')  // connect if needed, promote to active
await result.addRemote('https://mirror.example.com') // connect as backup, don't change active
```

- `setActiveStorage(target)` drives `WalletStorageManager.setActive(storageIdentityKey)`, which syncs data **from** the current active **to** every other store **before** flipping the pointer. Migration is automatic on every flip.
- `addRemote(url)` connects a remote as a non-active backup. No active change. Post-action `updateBackups()` begins pushing to it on the next transaction.
- There is no `removeRemote`. To "remove" a backup, simply don't include it in `config.backups` on the next wallet creation. The previously-connected remote stays live for the remainder of the session.

## Backup behavior

The factory installs two backup sync paths:

1. **Initial sync on creation.** After wiring the stores, the factory calls `storage.updateBackups()` once. Every backup is brought up to date with the current active before the wallet is handed back. Errors are logged via `console.error`; wallet creation does not fail.
2. **Post-action sync.** `createAction` and `signAction` are wrapped so that `storage.updateBackups()` fires fire-and-forget after every successful broadcast. Errors are logged via `console.error`.

Both push **from** the active **to** every registered backup. `updateBackups()` is incremental (via `EntitySyncState`), so repeat calls are cheap when there's nothing new to copy.

## Monitor

The `Monitor` is always created and its default tasks registered via `addDefaultTasks()`. Individual tasks self-throttle through their own `trigger(now)` methods using `lastRunMsecsSinceEpoch` and per-task intervals, so calling `runOnce()` repeatedly during rapid activity is cheap timestamp comparisons.

**On creation**, the factory fires `monitor.runOnce()` fire-and-forget *only when local is the active store*. When a remote is active, the server runs its own monitor; firing one client-side would duplicate and race that work.

Consumer responsibility:

- **Short-lived processes (CLI, scripts):** every invocation creates a new wallet, which fires a `runOnce()` via the factory. No extra work.
- **Long-running processes:** the initial `runOnce()` is fired on creation. Call `result.monitor.runOnce()` again on meaningful wake events (service worker wake, foreground focus) to service any pending tasks. Do **not** call `result.monitor.startTasks()` in a browser/extension — that's a `while` loop that never returns.

**Do not configure a "monitor interval" at the application layer** — the default tasks already self-throttle. There is no `monitorIntervalMinutes` knob.

The one schedule the factory does expose is `backupSyncIntervalMs` (core config, default 5 min, `0` to disable). This drives the `BackupSync` task that pushes local→backups and retries failed backup registrations. It only fires when local is the active store; when a remote is active the remote is canonical and no scheduled push runs.

## Address sync

Syncing external payments to BRC-29 deposit addresses is not done by `@1sat/wallet` — it is the `syncAddresses` **action** in `@1sat/actions`, run against the wallet you created here. `@1sat/wallet` only exports the passive `AddressManager` helper (a lookup map of pre-derived addresses) and `BRC29_PROTOCOL_ID` / `AddressDerivation` from `./address-sync`. There is no `AddressSyncManager`, `AddressSyncQueueIdb`, `AddressSyncFetcher`, or `AddressSyncProcessor`.

`syncAddresses` derives deposit addresses under the `P1SAT` protocol, pulls new outputs from the 1sat-stack indexer (triggering lazy indexing), classifies them through the indexer pipeline, and internalizes them into the wallet.

```typescript
import { syncAddresses, createContext } from '@1sat/actions'

const ctx = createContext(result.wallet, { services: result.services })

const sync = await syncAddresses.execute(ctx, {
  prefix: '1sat',          // KeyID prefix; default '1sat' (DEFAULT_DEPOSIT_PREFIX)
  startIndex: 0,           // first address index (default 0)
  count: 1,                // number of addresses to derive (default 1)
  onProgress: (p) => console.log('indexing:', p),  // SyncProgress
})

// sync.processed  — txs internalized
// sync.failed     — txs that failed to internalize
// sync.lastScore  — reorg-safe score; pass as fromScore on the next call
// sync.addresses  — addresses that were synced
```

To derive addresses without syncing, use the `deriveDepositAddresses` action (same `prefix` / `startIndex` / `count` inputs), which returns `{ derivations: AddressDerivation[] }`.

`ProcessedTxStoreIdb` (browser) and `ProcessedTxStoreSqlite` (Node/Bun) are selected automatically by `syncAddresses` based on the runtime — no fetcher/processor split is required.

### AddressManager (lookup helper)

`AddressManager` from `@1sat/wallet` is a passive map over pre-derived `AddressDerivation`s. It does no derivation or network I/O — feed it the `derivations` from `deriveDepositAddresses`.

```typescript
import { AddressManager } from '@1sat/wallet'

const mgr = new AddressManager(derivations)
mgr.isOurAddress(addr)            // boolean
mgr.getDerivation(addr)           // AddressDerivation | undefined
mgr.getPrimaryAddress()           // index-0 address
mgr.getMaxKeyIndex()              // persist this to grow the set later
```

## Derivation paths

```typescript
import {
  YOURS_WALLET_PATH, YOURS_ORD_PATH, YOURS_ID_PATH,
  getKeysFromMnemonicAndPaths, deriveIdentityKey,
} from '@1sat/utils'
```

| Constant | Path | Purpose |
|---|---|---|
| `YOURS_WALLET_PATH` | `m/44'/236'/0'/1/0` | Yours payment |
| `YOURS_ORD_PATH` | `m/44'/236'/1'/0/0` | Yours ordinals |
| `YOURS_ID_PATH` | `m/0'/236'/0'/0/0` | Yours identity |
| `RELAYX_ORD_PATH` | `m/44'/236'/0'/2/0` | RelayX ordinals |
| `RELAYX_SWEEP_PATH` | `m/44'/236'/0'/0/0` | RelayX sweep |
| `TWETCH_WALLET_PATH` | `m/0/0` | Twetch payment |
| `AYM_WALLET_PATH` | `m/0/0` | AYM payment |
| `AYM_ORD_PATH` | `m` | AYM ordinals (master key) |

```typescript
// Derive keys from mnemonic
const keys = getKeysFromMnemonicAndPaths(mnemonic, {
  changeAddressPath: YOURS_WALLET_PATH,
  ordAddressPath: YOURS_ORD_PATH,
  identityAddressPath: YOURS_ID_PATH,
})
// keys.payPk (WIF), keys.ordPk (WIF), keys.identityPk (WIF)

// Derive identity key from pay + ord WIFs
const identityKey = deriveIdentityKey(keys.payPk, keys.ordPk)
```

## Balance

```typescript
const balance = await result.wallet.balance()
// Returns satoshis as a number. 0 for empty wallet. Never throws.
```

If `createAction` is called with insufficient funds, it throws `WERR_INSUFFICIENT_FUNDS` with `totalSatoshisNeeded` and `moreSatoshisNeeded` properties.

## File backup / restore

Streaming ZIP-based backup via `fflate`. `FileBackupProvider` implements `WalletStorageProvider` and receives sync chunks during export.

```typescript
import { FileBackupProvider, FileRestoreReader, Zip, unzip } from '@1sat/wallet'

// === BACKUP ===
const chunks: Uint8Array[] = []
const zip = new Zip((err, data, final) => {
  if (err) throw err
  chunks.push(data)
  if (final) {
    const blob = new Blob(chunks, { type: 'application/zip' })
    // save or download blob
  }
})

const provider = new FileBackupProvider(zip, result.storage.getSettings(), identityKey)
await result.storage.syncToWriter(auth, provider)
// Write manifest.json to zip, then zip.end()

// === RESTORE ===
const zipData = new Uint8Array(await file.arrayBuffer())
const unzipped = await new Promise<Unzipped>((resolve, reject) => {
  unzip(zipData, (err, data) => (err ? reject(err) : resolve(data)))
})
const manifest = JSON.parse(new TextDecoder().decode(unzipped['manifest.json']))
const reader = new FileRestoreReader(unzipped, manifest)
await result.storage.syncFromReader(manifest.identityKey, reader)
```

## Wallet indexers

These run automatically during address sync. No configuration needed.

| Indexer | What it tracks |
|---|---|
| `InscriptionIndexer` | Ordinal inscriptions |
| `Bsv21Indexer` | BSV-21 fungible tokens |
| `OrdLockIndexer` | Marketplace listings |
| `LockIndexer` | Time-locked BSV |
| `MapIndexer` | MAP protocol metadata |
| `SigmaIndexer` | Sigma protocol signatures |
| `OriginIndexer` | Ordinal origin tracking |
| `OpNSIndexer` | OpNS name bindings |
| `CosignIndexer` | Cosigner data |
| `FundIndexer` | Funding outputs (P2PKH) |

## Installation

```bash
bun add @1sat/wallet-node       # Node / Bun
bun add @1sat/wallet-browser    # Browser (extensions, web apps)
bun add @1sat/wallet-remote     # Thin client, no local storage
```

All three depend on `@1sat/wallet` transitively.

## Hardware key protection: @1sat/vault

On macOS arm64, private keys can be protected by the Secure Enclave via `@1sat/vault`. Keys are encrypted with a hardware-bound P-256 key (CryptoKit ECIES: ECDH + HKDF-SHA256 + AES-256-GCM) and never leave the chip. All decryption requires Touch ID via LAContext.

```typescript
import { protectSecret, unlockSecret, listSecrets, isSupported } from '@1sat/vault'

if (await isSupported()) {
  await protectSecret('my-wallet-key', wifString)
  const wif = await unlockSecret('my-wallet-key')   // triggers Touch ID
  const secrets = await listSecrets()
  await removeSecret('my-wallet-key')
}
```

- **Package:** `@1sat/vault` (npm)
- **Vault directory:** `~/.secure-enclave-vault/`
- **Platform:** macOS arm64 only (fails informatively elsewhere)
- **No entitlements, no code signing, no .app bundle needed**

Used by BAP CLI (`bap touchid enable`) and ClawNet CLI (`clawnet setup-key`).

## Alternative: CLI

For quick wallet setup without writing code, use `@1sat/cli`:

```bash
bunx @1sat/cli init          # run without install
bun add -g @1sat/cli         # install globally for frequent use
```

See `../../../cli/skills/cli` for full CLI documentation.
