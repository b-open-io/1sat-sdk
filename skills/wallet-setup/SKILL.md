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

All three factories take the same shape (minus the local-storage fields that don't apply to `wallet-remote`).

```typescript
{
  privateKey: PrivateKey | string,       // PrivateKey, WIF, or 64-char hex
  chain: 'main' | 'test',
  feeModel?: { model: 'sat/kb', value: number },   // default { model: 'sat/kb', value: 100 }

  // Storage topology
  activeRemote?: string,                 // URL of the active remote, or undefined for local-active
  backups?: string[],                    // Additional remote URLs registered as backups
  storageIdentityKey: string,            // Unique identifier for the local store on this install

  // Transaction lifecycle callbacks (only fire while Monitor runs)
  onTransactionBroadcasted?: (txid: string) => void,
  onTransactionProven?: (txid: string, blockHeight: number) => void,

  connectionTimeout?: number,            // Remote connection timeout in ms, default 5000
}
```

### `storageIdentityKey`

This identifies the **local store** to the `WalletStorageManager`. It must be **unique per install** — two installs of the same account that both claim the same `storageIdentityKey` will be indistinguishable to the remote's `user.activeStorage` tracking, leading to data divergence.

Pick something like a UUID or `<app>-<random-hex>` at install time and persist it. Don't hardcode a constant across installs.

### `activeRemote` and `backups`

- `activeRemote` unset ⇒ local is the active store; optional `backups[]` are remotes that receive `updateBackups()` pushes.
- `activeRemote` set ⇒ that remote is active; local (if created by the factory) is added as a backup automatically; additional URLs in `backups[]` are added alongside.
- A URL passed as `activeRemote` should not also appear in `backups[]` — the factory does not dedup.

## Node.js wallet

```typescript
import { createNodeWallet } from '@1sat/wallet-node'

const result = await createNodeWallet({
  privateKey: 'L1...',
  chain: 'main',
  storageIdentityKey: 'my-agent-abc123',
  filename: '~/.myapp/wallet.db',        // default: './wallet.db'

  activeRemote: 'https://storage.example.com',   // optional
  backups: ['https://backup.example.com'],        // optional

  onTransactionBroadcasted: (txid) => console.log('Broadcast:', txid),
  onTransactionProven: (txid, blockHeight) => console.log('Proven:', txid, blockHeight),
})

// ...use result.wallet for BRC-100 operations

await result.destroy()  // stops monitor, destroys wallet, closes DB
```

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
| `destroy` | `() => Promise<void>` | Cleanup: stops monitor, destroys wallet, closes DB |

## Browser wallet

```typescript
import { createWebWallet } from '@1sat/wallet-browser'

const result = await createWebWallet({
  privateKey: keys.identityWif,
  chain: 'main',
  storageIdentityKey: 'yours-abc123',

  activeRemote: undefined,               // undefined = local-active
  backups: ['https://api.1sat.app/1sat/wallet'],
})
```

Shape of the result matches `NodeWalletResult` minus Node-specific fields. Local storage is an IndexedDB (`StorageIdb`).

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

`RemoteWalletResult` has no `monitor` (the server runs its own) and no `remoteStorage` convenience handle. `setActiveStorage('local')` throws because there is no local store.

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

**Do not configure "monitor interval" at the application layer** — the tasks already self-throttle. There is no `monitorIntervalMinutes` knob; it was removed.

## Address sync

Address sync uses a fetcher/processor split for Chrome extension compatibility (SSE doesn't work in service workers). Use `AddressSyncManager` in unified environments.

```typescript
import { AddressSyncManager, AddressSyncQueueIdb } from '@1sat/wallet'

const syncManager = new AddressSyncManager({
  wallet: result.wallet,
  services: result.services,
  syncQueue: new AddressSyncQueueIdb(),        // or AddressSyncQueueSqlite
  addressManager,                               // AddressManager instance
  network: 'mainnet',
  batchSize: 20,
})

syncManager.on('sync:progress', ({ pending, done, failed }) => {
  console.log(`Pending: ${pending}, Done: ${done}, Failed: ${failed}`)
})

await syncManager.sync()   // opens SSE stream + processes queue
syncManager.stop()
```

For Chrome extensions, use `AddressSyncFetcher` (popup context) and `AddressSyncProcessor` (service worker) separately.

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

See the `1sat-cli` skill for full CLI documentation.
