---
name: wallet-setup
description: "This skill should be used when setting up a 1Sat wallet, creating a new wallet instance, syncing addresses, configuring storage, or restoring from backup. Triggers on 'create wallet', 'setup wallet', 'initialize wallet', 'sync wallet', 'restore wallet', 'wallet backup', 'address sync', 'wallet storage', 'IndexedDB wallet', 'SQLite wallet', 'BRC-100 wallet', 'wallet factory', 'remote wallet', or 'full sync'. Uses @1sat/wallet, @1sat/wallet-node, and @1sat/wallet-remote packages. Note: @1sat/wallet-browser is deprecated in favor of @1sat/wallet-remote."
---

# Wallet Setup

Create, configure, and sync 1Sat wallets for Node.js, browser, or remote environments.

## Packages

| Package | Environment | Storage |
|---------|-------------|---------|
| `@1sat/wallet-node` | Node.js / Bun | SQLite (Knex) or MySQL |
| `@1sat/wallet-remote` | Any (thin client) | Remote server only |
| `@1sat/wallet` | Core library | Indexers, backup, address sync |
| `@1sat/wallet-browser` | **Deprecated** | Use `@1sat/wallet-remote` instead |

## Node.js Wallet

```typescript
import { createNodeWallet } from '@1sat/wallet-node'

const { wallet, services, monitor, destroy, fullSync } = await createNodeWallet({
  privateKey: 'L1...', // PrivateKey instance, WIF string, or hex string
  chain: 'main',       // 'main' | 'test'
  storageIdentityKey: 'my-cli-agent', // unique per device, persist across sessions
  // Optional:
  storage: {           // Knex.Config — default: SQLite at ./wallet.db
    client: 'mysql2',
    connection: { host: '127.0.0.1', user: 'root', password: '...', database: 'wallet' },
    useNullAsDefault: true,
  },
  remoteStorageUrl: 'https://storage.example.com', // enables cloud backup
  feeModel: { model: 'sat/kb', value: 100 },       // default shown
  onTransactionBroadcasted: (txid) => console.log('Broadcast:', txid),
  onTransactionProven: (txid, blockHeight) => console.log('Proven:', txid, blockHeight),
})

// Monitor handles tx lifecycle (broadcasting, proof checking)
// It is created but NOT started — call startTasks() when ready
monitor.startTasks()

// When done: stops monitor, destroys wallet, closes database
await destroy()
```

### NodeWalletResult

| Property | Type | Description |
|----------|------|-------------|
| `wallet` | `Wallet` | BRC-100 wallet instance |
| `services` | `OneSatServices` | 1Sat API access |
| `monitor` | `Monitor` | Transaction lifecycle monitor (call `startTasks()`) |
| `destroy` | `() => Promise<void>` | Cleanup: stops monitor, destroys wallet, closes DB |
| `fullSync` | `((onProgress?) => Promise<FullSyncResult>) \| undefined` | Only available if `remoteStorageUrl` was provided and connected |
| `storage` | `WalletStorageManager` | For diagnostics |
| `remoteStorage` | `StorageClient \| undefined` | For diagnostics |

## Remote Wallet

No local storage. The server handles transaction lifecycle.

```typescript
import { createRemoteWallet } from '@1sat/wallet-remote'

const { wallet, services, destroy, feeModel } = await createRemoteWallet({
  privateKey: 'L1...',
  chain: 'main',
  remoteStorageUrl: 'https://my-wallet-server.example.com',
  // Optional:
  feeModel: { model: 'sat/kb', value: 100 },
  connectionTimeout: 5000, // default: 5000ms
})
```

`RemoteWalletResult` has no `monitor` or `fullSync` — the server manages those. It includes `feeModel` indicating the effective fee model used.

## Full Sync (Multi-Device Handoff)

`fullSync` reconciles local and remote storage. It pushes local changes, resets sync state, then pulls everything from the server. This runs automatically during wallet creation when another device is active, or can be called manually via the `fullSync` property on the wallet result.

```typescript
// Only available if remoteStorageUrl was provided and connected
if (fullSync) {
  const result = await fullSync((stage, message) => {
    console.log(`${stage}: ${message}`)
  })
  console.log('Pushed:', result.pushed) // { inserts, updates }
  console.log('Pulled:', result.pulled) // { inserts, updates }
}
```

### FullSyncOptions (internal)

The standalone `fullSync()` function takes `{ storage, remoteStorage, identityKey, onProgress?, maxRoughSize?, maxItems? }`. The factory functions wrap this for you.

### FullSync Stages

| Stage | Description |
|-------|-------------|
| `pushing` | Pushing local data to remote server |
| `resetting` | Resetting sync state for clean pull |
| `pulling` | Pulling all data from remote |
| `complete` | Sync finished |

## Derivation Paths

```typescript
import {
  YOURS_WALLET_PATH, YOURS_ORD_PATH, YOURS_ID_PATH,
  getKeysFromMnemonicAndPaths, deriveIdentityKey,
} from '@1sat/utils'
```

| Constant | Path | Purpose |
|----------|------|---------|
| `YOURS_WALLET_PATH` | `m/44'/236'/0'/1/0` | Yours Wallet payment |
| `YOURS_ORD_PATH` | `m/44'/236'/1'/0/0` | Yours Wallet ordinals |
| `YOURS_ID_PATH` | `m/0'/236'/0'/0/0` | Yours Wallet identity |
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

## Address Sync

Address sync uses a fetcher/processor split for Chrome extension compatibility (SSE does not work in service workers). Use `AddressSyncManager` in unified environments.

```typescript
import { AddressSyncManager, AddressSyncQueueIdb } from '@1sat/wallet'

const syncManager = new AddressSyncManager({
  wallet,
  services,
  syncQueue: new AddressSyncQueueIdb(), // or AddressSyncQueueSqlite
  addressManager,                        // AddressManager instance
  network: 'mainnet',                    // 'mainnet' | 'testnet'
  batchSize: 20,                         // optional, default 20
})

syncManager.on('sync:progress', ({ pending, done, failed }) => {
  console.log(`Pending: ${pending}, Done: ${done}, Failed: ${failed}`)
})

await syncManager.sync() // opens SSE stream + processes queue
syncManager.stop()
```

For Chrome extensions, use `AddressSyncFetcher` (popup context) and `AddressSyncProcessor` (service worker) separately.

## Backup & Restore

Backup uses a streaming Zip-based API via `fflate`. `FileBackupProvider` implements `WalletStorageProvider` to receive sync chunks during export.

```typescript
import { FileBackupProvider, FileRestoreReader, Zip, ZipDeflate, unzip } from '@1sat/wallet'

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

const provider = new FileBackupProvider(zip, storage.getSettings(), identityKey)
await storage.syncToWriter(auth, provider)
// Write manifest.json to zip, then zip.end()

// === RESTORE ===
const zipData = new Uint8Array(await file.arrayBuffer())
const unzipped = await new Promise<Unzipped>((resolve, reject) => {
  unzip(zipData, (err, data) => (err ? reject(err) : resolve(data)))
})
const manifest = JSON.parse(new TextDecoder().decode(unzipped['manifest.json']))
const reader = new FileRestoreReader(unzipped, manifest)
await storage.syncFromReader(manifest.identityKey, reader)
```

## Wallet Indexers

These run automatically during address sync. No configuration needed.

| Indexer | What it tracks |
|---------|---------------|
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
bun add @1sat/wallet-node    # Node.js / Bun
bun add @1sat/wallet-remote  # Remote (thin client)
# @1sat/wallet-browser is deprecated — use @1sat/wallet-remote instead
```

All environment packages depend on `@1sat/wallet` (core) which provides indexers, backup, and address sync.

## Hardware Key Protection: @1sat/vault

On macOS arm64, private keys can be protected by the Secure Enclave via `@1sat/vault`. Keys are encrypted with a hardware-bound P-256 key (CryptoKit ECIES: ECDH + HKDF-SHA256 + AES-256-GCM) and never leave the chip. All decryption requires Touch ID via LAContext.

```typescript
import { protectSecret, unlockSecret, listSecrets, isSupported } from '@1sat/vault'

// Check availability
if (await isSupported()) {
  // Encrypt and store a WIF key
  await protectSecret('my-wallet-key', wifString)

  // Retrieve (triggers Touch ID)
  const wif = await unlockSecret('my-wallet-key')

  // List stored secrets
  const secrets = await listSecrets()

  // Remove
  await removeSecret('my-wallet-key')
}
```

- **Package**: `@1sat/vault@0.0.1` (npm)
- **Vault directory**: `~/.secure-enclave-vault/`
- **Platform**: macOS arm64 only (fails informatively elsewhere)
- **No entitlements, no code signing, no .app bundle needed**
- Used by BAP CLI (`bap touchid enable`) and ClawNet CLI (`clawnet setup-key`)


## Alternative: CLI Setup

For quick wallet setup without writing code, use `@1sat/cli`:

```bash
# Run directly — no install needed
bunx @1sat/cli init

# Optional: install globally for frequent use
bun add -g @1sat/cli
# Then use the short form: 1sat init
```

The CLI stores configuration in `~/.1sat/` and supports key management via `PRIVATE_KEY_WIF` env var or encrypted keystore at `~/.1sat/keys.bep`. See the `1sat-cli` skill for full CLI documentation.
