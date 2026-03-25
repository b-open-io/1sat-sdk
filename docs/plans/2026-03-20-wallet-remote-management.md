# Wallet Remote Management Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared wallet factory core into @1sat/wallet, add migrateRemote(url) to all wallet types, refactor three wallet packages into thin shims, remove fullSync.

**Architecture:** All three wallet packages (wallet-browser, wallet-node, wallet-remote) share identical factory logic for WalletStorageManager setup, remote connections, backup interception, and Monitor wiring. That logic moves into a `createWalletCore()` function in @1sat/wallet. Each package becomes a thin shim that creates the appropriate local storage (IndexedDB, SQLite, or none) and delegates to the core. `migrateRemote(url)` leverages WalletStorageManager.setActive() which handles all data movement automatically.

**Tech Stack:** TypeScript, @bsv/wallet-toolbox (WalletStorageManager, StorageClient, StorageProvider, Monitor), @1sat/client (OneSatServices), Bun/Biome tooling.

**Linear:** OPL-1484 (epic), OPL-1485 through OPL-1490 (stories)

---

## File Structure

### New files
- `packages/wallet/src/factory.ts` — shared createWalletCore() + migrateRemote() + types
- `packages/wallet/src/parsePrivateKey.ts` — shared private key parser (duplicated in all 3 packages today)

### Modified files
- `packages/wallet/src/index.ts` — add factory exports
- `packages/wallet/package.json` — add @bsv/wallet-toolbox as peer dep
- `packages/wallet-browser/src/createWebWallet.ts` — rewrite as thin shim
- `packages/wallet-browser/src/index.ts` — remove fullSync exports, add migrateRemote type
- `packages/wallet-node/src/createNodeWallet.ts` — rewrite as thin shim
- `packages/wallet-node/src/index.ts` — remove fullSync exports
- `packages/wallet-remote/src/createRemoteWallet.ts` — rewrite as thin shim
- `packages/wallet-remote/src/index.ts` — remove LocalBackupConfig export

### Deleted files
- `packages/wallet-browser/src/fullSync.ts`
- `packages/wallet-node/src/fullSync.ts`

### Unchanged files
- `packages/wallet-node/src/storage-bun-sqlite.ts` — stays as-is
- `packages/wallet-browser/src/types.ts` — MonitorEvent type stays (remove FullSyncStage import)

---

## Task 1: Create parsePrivateKey shared utility (OPL-1485)

**Files:**
- Create: `packages/wallet/src/parsePrivateKey.ts`
- Modify: `packages/wallet/src/index.ts`

- [ ] **Step 1: Create parsePrivateKey.ts**

```typescript
// packages/wallet/src/parsePrivateKey.ts
import { PrivateKey } from '@bsv/sdk'

export function parsePrivateKey(input: PrivateKey | string): PrivateKey {
	if (input instanceof PrivateKey) {
		return input
	}

	if (/^[5KLc][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(input)) {
		return PrivateKey.fromWif(input)
	}

	if (/^[0-9a-fA-F]{64}$/.test(input)) {
		return new PrivateKey(input)
	}

	try {
		return PrivateKey.fromWif(input)
	} catch {
		throw new Error(
			'Invalid private key format. Expected PrivateKey instance, WIF string, or 64-char hex string.',
		)
	}
}
```

- [ ] **Step 2: Export from index.ts**

Add to `packages/wallet/src/index.ts`:
```typescript
// Factory utilities
export { parsePrivateKey } from './parsePrivateKey'
```

- [ ] **Step 3: Build and verify**

Run: `bun run --filter '@1sat/wallet' build`
Expected: clean build, parsePrivateKey in dist

- [ ] **Step 4: Commit**

```bash
git add packages/wallet/src/parsePrivateKey.ts packages/wallet/src/index.ts
git commit -m "feat(wallet): extract shared parsePrivateKey utility"
```

---

## Task 2: Create shared wallet factory core (OPL-1485)

**Files:**
- Create: `packages/wallet/src/factory.ts`
- Modify: `packages/wallet/src/index.ts`
- Modify: `packages/wallet/package.json`

- [ ] **Step 1: Add @bsv/wallet-toolbox as peer dependency**

In `packages/wallet/package.json`, add to peerDependencies:
```json
"@bsv/wallet-toolbox": "^2.0.20"
```

And move from devDependencies to peerDependencies. Run `bun install`.

- [ ] **Step 2: Create factory.ts with types and core function**

```typescript
// packages/wallet/src/factory.ts
import { OneSatServices } from '@1sat/client'
import { KeyDeriver, PrivateKey, type WalletInterface } from '@bsv/sdk'
import type { sdk as toolboxSdk } from '@bsv/wallet-toolbox'
import { parsePrivateKey } from './parsePrivateKey'

// NOTE: The actual imports from wallet-toolbox differ between browser and node.
// Browser uses: '@bsv/wallet-toolbox/out/src/index.client.js'
// Node uses: '@bsv/wallet-toolbox'
// The core factory accepts pre-constructed instances to avoid this import split.

type WalletServices = toolboxSdk.WalletServices
type WalletStorageProvider = toolboxSdk.WalletStorageProvider

export type Chain = 'main' | 'test'

export const DEFAULT_FEE_MODEL = { model: 'sat/kb' as const, value: 100 }
export const DEFAULT_CONNECTION_TIMEOUT = 5000

export interface WalletCoreConfig {
	/** Private key - can be PrivateKey instance, WIF string, or hex string */
	privateKey: PrivateKey | string
	/** Network: 'main' or 'test' */
	chain: Chain
	/** Fee model. Default: { model: 'sat/kb', value: 100 } */
	feeModel?: { model: 'sat/kb'; value: number }
	/** Remote storage URL to use as active/primary. */
	activeRemote?: string
	/** Additional remote URLs to keep as backups. */
	backups?: string[]
	/** Connection timeout in milliseconds. Default: 5000 */
	connectionTimeout?: number
	/** Callback when a transaction is broadcasted */
	onTransactionBroadcasted?: (txid: string) => void
	/** Callback when a transaction is proven */
	onTransactionProven?: (txid: string, blockHeight: number) => void
}

export interface WalletCoreResult {
	/** Wallet instance */
	wallet: InstanceType<any>
	/** 1Sat services for API access */
	services: OneSatServices
	/** Storage manager */
	storage: InstanceType<any>
	/** Cleanup function */
	destroy: () => Promise<void>
	/** Remote storage clients (active + backups) */
	remoteClients: InstanceType<any>[]
	/** Migrate to a new remote — pushes data and sets it as active */
	migrateRemote: (url: string) => Promise<void>
	/** Fee model in use */
	feeModel: { model: 'sat/kb'; value: number }
}

/**
 * Shared wallet factory core. Each wallet package calls this after creating
 * its local storage provider (if any).
 *
 * @param config - Wallet configuration
 * @param localStorage - Optional local storage provider (IndexedDB, SQLite, etc.)
 * @param toolbox - Platform-specific imports from @bsv/wallet-toolbox
 */
export async function createWalletCore(
	config: WalletCoreConfig,
	localStorage: WalletStorageProvider | undefined,
	toolbox: {
		Services: any
		StorageClient: any
		StorageProvider: any
		Wallet: any
		WalletStorageManager: any
		Monitor?: any
	},
): Promise<WalletCoreResult> {
	const { chain } = config
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL
	const timeout = config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT

	const privateKey = parsePrivateKey(config.privateKey)
	const identityPubKey = privateKey.toPublicKey().toString()
	const keyDeriver = new KeyDeriver(privateKey)

	// 1. Create services
	const fallbackServices = new toolbox.Services(chain)
	const oneSatServices = new OneSatServices(chain, undefined, fallbackServices)

	// 2. Create storage manager
	let storage: InstanceType<typeof toolbox.WalletStorageManager>
	if (localStorage) {
		storage = new toolbox.WalletStorageManager(identityPubKey, localStorage, [])
		await storage.makeAvailable()
	} else {
		storage = new toolbox.WalletStorageManager(identityPubKey)
	}

	// 3. Create wallet (needed for StorageClient auth)
	const wallet = new toolbox.Wallet({
		chain,
		keyDeriver,
		storage,
		services: oneSatServices as WalletServices,
	})

	// 4. Connect remotes
	const remoteClients: InstanceType<typeof toolbox.StorageClient>[] = []

	const connectRemote = async (url: string): Promise<InstanceType<typeof toolbox.StorageClient>> => {
		const client = new toolbox.StorageClient(
			wallet as unknown as WalletInterface,
			url,
		)
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`Remote storage connection timeout: ${url}`)),
				timeout,
			),
		)
		if (localStorage) {
			// If we have local storage, makeAvailable was already called on it.
			// Just add the remote — storage manager partitions it.
			await Promise.race([
				storage.addWalletStorageProvider(client),
				timeoutPromise,
			])
		} else {
			// No local storage — this is the first provider.
			await Promise.race([
				storage.addWalletStorageProvider(client),
				timeoutPromise,
			])
		}
		remoteClients.push(client)
		return client
	}

	// Connect active remote
	if (config.activeRemote) {
		const activeClient = await connectRemote(config.activeRemote)
		const settings = activeClient.getSettings()
		if (settings?.storageIdentityKey) {
			await storage.setActive(settings.storageIdentityKey)
		}
	}

	// Connect backup remotes
	if (config.backups) {
		for (const url of config.backups) {
			await connectRemote(url)
		}
	}

	// 5. Wire updateBackups interception on wallet actions
	let backupInterceptionWired = false

	const wireBackupInterception = () => {
		if (backupInterceptionWired) return
		if (storage.getBackupStores().length === 0) return
		backupInterceptionWired = true

		const originalCreateAction = wallet.createAction.bind(wallet)
		wallet.createAction = async (args: any) => {
			const result = await originalCreateAction(args)
			if (result.txid) {
				storage.updateBackups().catch(() => {})
			}
			return result
		}

		const originalSignAction = wallet.signAction.bind(wallet)
		wallet.signAction = async (args: any) => {
			const result = await originalSignAction(args)
			if (result.txid) {
				storage.updateBackups().catch(() => {})
			}
			return result
		}
	}

	wireBackupInterception()

	// 6. migrateRemote implementation
	const migrateRemote = async (url: string): Promise<void> => {
		// Check if this remote is already registered
		const existing = remoteClients.find(
			(c) => c.endpointUrl === url,
		)
		if (existing) {
			const settings = existing.getSettings()
			if (settings?.storageIdentityKey) {
				await storage.setActive(settings.storageIdentityKey)
			}
			return
		}

		// New remote — connect and set active
		const client = await connectRemote(url)
		const settings = client.getSettings()
		if (settings?.storageIdentityKey) {
			await storage.setActive(settings.storageIdentityKey)
		}

		// Wire backup interception if not already wired
		wireBackupInterception()
	}

	// 7. Destroy
	const destroy = async (): Promise<void> => {
		await wallet.destroy()
	}

	return {
		wallet,
		services: oneSatServices,
		storage,
		destroy,
		remoteClients,
		migrateRemote,
		feeModel,
	}
}
```

**NOTE:** The `toolbox` parameter injection avoids the browser/node import split. Each shim passes the correct platform imports. The `any` types on wallet/storage are because the concrete types come from different import paths.

- [ ] **Step 3: Export from index.ts**

Add to `packages/wallet/src/index.ts`:
```typescript
// Factory core
export {
	createWalletCore,
	DEFAULT_FEE_MODEL,
	DEFAULT_CONNECTION_TIMEOUT,
	type Chain,
	type WalletCoreConfig,
	type WalletCoreResult,
} from './factory'
```

- [ ] **Step 4: Run bun install and build**

Run: `bun install && bun run --filter '@1sat/wallet' build`
Expected: clean build

- [ ] **Step 5: Commit**

```bash
git add packages/wallet/src/factory.ts packages/wallet/src/index.ts packages/wallet/package.json
git commit -m "feat(wallet): add shared createWalletCore factory with migrateRemote"
```

---

## Task 3: Refactor wallet-browser as thin shim (OPL-1487)

**Files:**
- Modify: `packages/wallet-browser/src/createWebWallet.ts` — rewrite
- Delete: `packages/wallet-browser/src/fullSync.ts`
- Modify: `packages/wallet-browser/src/index.ts` — update exports
- Modify: `packages/wallet-browser/src/types.ts` — remove FullSyncStage import

- [ ] **Step 1: Rewrite createWebWallet.ts**

Replace the entire file with:

```typescript
import {
	type WalletCoreConfig,
	type WalletCoreResult,
	createWalletCore,
	DEFAULT_FEE_MODEL,
	DEFAULT_CONNECTION_TIMEOUT,
} from '@1sat/wallet'
import type { OneSatServices } from '@1sat/client'
import type { PrivateKey } from '@bsv/sdk'
import {
	Monitor,
	Services,
	StorageClient,
	StorageIdb,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox/out/src/index.client.js'

const DEFAULT_DATABASE_NAME = 'wallet'

export interface WebWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote?: string
	backups?: string[]
	storageIdentityKey: string
	connectionTimeout?: number
	onTransactionBroadcasted?: (txid: string) => void
	onTransactionProven?: (txid: string, blockHeight: number) => void
}

export interface WebWalletResult {
	wallet: Wallet
	services: OneSatServices
	monitor?: Monitor
	destroy: () => Promise<void>
	storage: WalletStorageManager
	remoteStorage?: StorageClient
	migrateRemote: (url: string) => Promise<void>
}

export async function createWebWallet(
	config: WebWalletConfig,
): Promise<WebWalletResult> {
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL

	// Create local IndexedDB storage
	const storageOptions = StorageProvider.createStorageBaseOptions(config.chain)
	storageOptions.feeModel = feeModel
	const localStorage = new StorageIdb(storageOptions)
	await localStorage.migrate(DEFAULT_DATABASE_NAME, config.storageIdentityKey)

	// Delegate to shared core
	const core = await createWalletCore(config, localStorage, {
		Services,
		StorageClient,
		StorageProvider,
		Wallet,
		WalletStorageManager,
		Monitor,
	})

	// Create monitor only when no active remote (local is primary)
	let monitor: Monitor | undefined
	if (!config.activeRemote) {
		monitor = new Monitor({
			chain: config.chain,
			services: core.services as any,
			storage: core.storage,
			chaintracks: core.services.chaintracks,
			msecsWaitPerMerkleProofServiceReq: 500,
			taskRunWaitMsecs: 5000,
			abandonedMsecs: 300000,
			unprovenAttemptsLimitTest: 10,
			unprovenAttemptsLimitMain: 144,
		})
		monitor.addDefaultTasks()

		if (config.onTransactionBroadcasted) {
			monitor.onTransactionBroadcasted = async (result) => {
				if (result.txid) config.onTransactionBroadcasted!(result.txid)
			}
		}
		if (config.onTransactionProven) {
			monitor.onTransactionProven = async (status) => {
				config.onTransactionProven!(status.txid, status.blockHeight)
			}
		}
	}

	const destroy = async (): Promise<void> => {
		if (monitor) {
			monitor.stopTasks()
			await monitor.destroy()
		}
		await core.destroy()
	}

	return {
		wallet: core.wallet,
		services: core.services,
		monitor,
		destroy,
		storage: core.storage,
		remoteStorage: core.remoteClients[0],
		migrateRemote: core.migrateRemote,
	}
}
```

- [ ] **Step 2: Delete fullSync.ts**

```bash
rm packages/wallet-browser/src/fullSync.ts
```

- [ ] **Step 3: Update types.ts — remove FullSyncStage import**

Remove the `import type { FullSyncStage } from './fullSync'` line and any references to it.

- [ ] **Step 4: Update index.ts**

Replace with:
```typescript
export * from '@1sat/wallet'

export { createWebWallet } from './createWebWallet'
export type { WebWalletConfig, WebWalletResult } from './createWebWallet'

export type { MonitorEvent } from './types'

export {
	Monitor,
	Services,
	StorageClient,
	StorageIdb,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
```

- [ ] **Step 5: Build**

Run: `bun run --filter '@1sat/wallet-browser' build`
Expected: clean build, no fullSync references

- [ ] **Step 6: Commit**

```bash
git add -u packages/wallet-browser/
git commit -m "refactor(wallet-browser): thin shim over shared core, remove fullSync, add migrateRemote"
```

---

## Task 4: Refactor wallet-node as thin shim (OPL-1488)

**Files:**
- Modify: `packages/wallet-node/src/createNodeWallet.ts` — rewrite
- Delete: `packages/wallet-node/src/fullSync.ts`
- Modify: `packages/wallet-node/src/index.ts` — update exports

- [ ] **Step 1: Rewrite createNodeWallet.ts**

Replace the entire file with:

```typescript
import {
	type WalletCoreConfig,
	createWalletCore,
	DEFAULT_FEE_MODEL,
} from '@1sat/wallet'
import type { OneSatServices } from '@1sat/client'
import type { PrivateKey } from '@bsv/sdk'
import {
	Monitor,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox'
import { type Knex, knex as makeKnex } from 'knex'
import { StorageBunSqlite } from './storage-bun-sqlite'

const DEFAULT_STORAGE_NAME = 'wallet'
const DEFAULT_FILENAME = './wallet.db'
const DEFAULT_KNEX_STORAGE: Knex.Config = {
	client: 'better-sqlite3',
	connection: { filename: DEFAULT_FILENAME },
	useNullAsDefault: true,
}

const isBun = typeof globalThis.Bun !== 'undefined'

export interface NodeWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	activeRemote?: string
	backups?: string[]
	storageIdentityKey: string
	connectionTimeout?: number
	storage?: Knex.Config
	filename?: string
	onTransactionBroadcasted?: (txid: string) => void
	onTransactionProven?: (txid: string, blockHeight: number) => void
}

export interface NodeWalletResult {
	wallet: Wallet
	services: OneSatServices
	monitor?: Monitor
	destroy: () => Promise<void>
	storage: WalletStorageManager
	remoteStorage?: StorageClient
	migrateRemote: (url: string) => Promise<void>
}

export async function createNodeWallet(
	config: NodeWalletConfig,
): Promise<NodeWalletResult> {
	const feeModel = config.feeModel ?? DEFAULT_FEE_MODEL

	// Create local storage — auto-detect runtime
	const storageOptions = StorageProvider.createStorageBaseOptions(config.chain)
	storageOptions.feeModel = feeModel

	let localStorage: StorageProvider
	let knexInstance: ReturnType<typeof makeKnex> | undefined

	if (isBun) {
		localStorage = new StorageBunSqlite({
			...storageOptions,
			filename: config.filename ?? DEFAULT_FILENAME,
		})
	} else {
		const { StorageKnex } = await import('@bsv/wallet-toolbox')
		const knexConfig = config.storage ?? {
			...DEFAULT_KNEX_STORAGE,
			connection: { filename: config.filename ?? DEFAULT_FILENAME },
		}
		knexInstance = makeKnex(knexConfig)
		localStorage = new StorageKnex({ ...storageOptions, knex: knexInstance })
	}

	await localStorage.migrate(DEFAULT_STORAGE_NAME, config.storageIdentityKey)

	// Delegate to shared core
	const core = await createWalletCore(config, localStorage, {
		Services,
		StorageClient,
		StorageProvider,
		Wallet,
		WalletStorageManager,
		Monitor,
	})

	// Create monitor only when no active remote (local is primary)
	let monitor: Monitor | undefined
	if (!config.activeRemote) {
		monitor = new Monitor({
			chain: config.chain,
			services: core.services as any,
			storage: core.storage,
			chaintracks: core.services.chaintracks,
			msecsWaitPerMerkleProofServiceReq: 500,
			taskRunWaitMsecs: 5000,
			abandonedMsecs: 300000,
			unprovenAttemptsLimitTest: 10,
			unprovenAttemptsLimitMain: 144,
		})
		monitor.addDefaultTasks()

		if (config.onTransactionBroadcasted) {
			monitor.onTransactionBroadcasted = async (result) => {
				if (result.txid) config.onTransactionBroadcasted!(result.txid)
			}
		}
		if (config.onTransactionProven) {
			monitor.onTransactionProven = async (status) => {
				config.onTransactionProven!(status.txid, status.blockHeight)
			}
		}
	}

	const destroy = async (): Promise<void> => {
		if (monitor) {
			monitor.stopTasks()
			await new Promise((r) => setTimeout(r, 100))
			await monitor.destroy()
		}
		await core.destroy()
		if (knexInstance) await knexInstance.destroy()
	}

	return {
		wallet: core.wallet,
		services: core.services,
		monitor,
		destroy,
		storage: core.storage,
		remoteStorage: core.remoteClients[0],
		migrateRemote: core.migrateRemote,
	}
}
```

- [ ] **Step 2: Delete fullSync.ts**

```bash
rm packages/wallet-node/src/fullSync.ts
```

- [ ] **Step 3: Update index.ts**

Replace with:
```typescript
export * from '@1sat/wallet'

export { createNodeWallet } from './createNodeWallet'
export type { NodeWalletConfig, NodeWalletResult } from './createNodeWallet'

export { StorageBunSqlite } from './storage-bun-sqlite'
export type { StorageBunSqliteOptions } from './storage-bun-sqlite'

export {
	Monitor,
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox'
```

- [ ] **Step 4: Build**

Run: `bun run --filter '@1sat/wallet-node' build`
Expected: clean build

- [ ] **Step 5: Commit**

```bash
git add -u packages/wallet-node/
git commit -m "refactor(wallet-node): thin shim over shared core, remove fullSync, add migrateRemote"
```

---

## Task 5: Refactor wallet-remote as thin shim (OPL-1489)

**Files:**
- Modify: `packages/wallet-remote/src/createRemoteWallet.ts` — rewrite
- Modify: `packages/wallet-remote/src/index.ts` — update exports

- [ ] **Step 1: Rewrite createRemoteWallet.ts**

Replace the entire file with:

```typescript
import {
	createWalletCore,
	DEFAULT_FEE_MODEL,
} from '@1sat/wallet'
import type { OneSatServices } from '@1sat/client'
import type { PrivateKey } from '@bsv/sdk'
import {
	Services,
	StorageClient,
	StorageProvider,
	Wallet,
	WalletStorageManager,
} from '@bsv/wallet-toolbox/out/src/index.client.js'

export interface RemoteWalletConfig {
	privateKey: PrivateKey | string
	chain: 'main' | 'test'
	feeModel?: { model: 'sat/kb'; value: number }
	/** Required — the primary remote storage URL */
	activeRemote: string
	/** Additional remote URLs to keep as backups */
	backups?: string[]
	connectionTimeout?: number
}

export interface RemoteWalletResult {
	wallet: Wallet
	services: OneSatServices
	destroy: () => Promise<void>
	storage: WalletStorageManager
	feeModel: { model: 'sat/kb'; value: number }
	migrateRemote: (url: string) => Promise<void>
}

export async function createRemoteWallet(
	config: RemoteWalletConfig,
): Promise<RemoteWalletResult> {
	const core = await createWalletCore(
		{ ...config },
		undefined, // no local storage
		{
			Services,
			StorageClient,
			StorageProvider,
			Wallet,
			WalletStorageManager,
		},
	)

	return {
		wallet: core.wallet,
		services: core.services,
		destroy: core.destroy,
		storage: core.storage,
		feeModel: core.feeModel,
		migrateRemote: core.migrateRemote,
	}
}
```

- [ ] **Step 2: Update index.ts**

Replace with:
```typescript
export * from '@1sat/wallet'

export { createRemoteWallet } from './createRemoteWallet'
export type {
	RemoteWalletConfig,
	RemoteWalletResult,
} from './createRemoteWallet'

export {
	Services,
	StorageClient,
	Wallet,
	WalletStorageManager,
	type sdk as walletSdk,
} from '@bsv/wallet-toolbox/out/src/index.client.js'
```

- [ ] **Step 3: Build**

Run: `bun run --filter '@1sat/wallet-remote' build`
Expected: clean build

- [ ] **Step 4: Commit**

```bash
git add -u packages/wallet-remote/
git commit -m "refactor(wallet-remote): thin shim over shared core, remove localBackup, add migrateRemote"
```

---

## Task 6: Update in-monorepo consumers

The config renames (`remoteStorageUrl` → `activeRemote`) and type changes (`monitor` now optional, `fullSync` removed) break consumers within the monorepo. These must be updated before the full build will pass.

**Files to search and update:**
- `packages/cli/src/context.ts` — uses `remoteStorageUrl`, accesses `monitor` without null check
- `packages/cli/src/config.ts` — defines `remoteStorageUrl` in config type
- `packages/cli/src/commands/config.ts` — references config keys
- `packages/actions/test/setup.ts` — uses `remoteStorageUrl`
- `skills/wallet-create-ordinals/scripts/mint.ts` — uses `remoteStorageUrl`

- [ ] **Step 1: Search for all `remoteStorageUrl` references**

Run: `grep -r "remoteStorageUrl" packages/ skills/ --include="*.ts" -l`

- [ ] **Step 2: Rename `remoteStorageUrl` to `activeRemote` in all found files**

- [ ] **Step 3: Search for all `fullSync` imports from wallet-browser/wallet-node**

Run: `grep -r "fullSync\|FullSync" packages/ skills/ --include="*.ts" -l`
Update or remove any references.

- [ ] **Step 4: Fix `monitor` null safety**

Search for `.monitor.` and `monitor.startTasks` — add optional chaining or null checks where `monitor` is now optional.

- [ ] **Step 5: Commit**

```bash
git add -u packages/ skills/
git commit -m "fix: update in-monorepo consumers for wallet refactor config changes"
```

---

## Task 7: Full monorepo build + lint verification

- [ ] **Step 1: Full build**

Run: `bun run build`
Expected: all packages build cleanly

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: no new lint errors

- [ ] **Step 3: Fix any issues**

Address any type errors or lint issues from the refactor.

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A && git commit -m "fix: resolve build/lint issues from wallet refactor"
```

---

## Notes for implementer

1. **Import split:** Browser packages MUST import from `@bsv/wallet-toolbox/out/src/index.client.js`. Node packages import from `@bsv/wallet-toolbox`. The `toolbox` parameter in `createWalletCore` avoids this by having each shim pass the correct imports.

2. **The `any` types in factory.ts:** These exist because `Wallet`, `WalletStorageManager`, etc. come from different import paths depending on platform. The shim packages have the correct types. This is a pragmatic tradeoff — the alternative is a complex generic type system that adds no runtime safety.

3. **Monitor creation stays in shims:** The Monitor setup (task config, callbacks) is environment-specific enough that it doesn't belong in the core. The core handles storage + remotes + migrateRemote. Monitors are optional and created by the shim.

4. **Backup interception uses a guard flag:** `backupInterceptionWired` prevents double-wrapping when `migrateRemote` is called multiple times. The flag is checked before wiring.

5. **Breaking changes:** `remoteStorageUrl` is renamed to `activeRemote` in all configs. `fullSync` is removed from result types. `LocalBackupConfig` is removed from wallet-remote. `localBackup` is removed from wallet-remote config. `monitor` is now optional on WebWalletResult/NodeWalletResult. In-monorepo consumers are updated in Task 6. External consumers are tracked in OPL-1491 through OPL-1494.

6. **`StorageClient.endpointUrl`** is confirmed to exist as `readonly endpointUrl: string` in the wallet-toolbox declarations. The migrateRemote lookup by URL is safe.

7. **`onMonitorEvent` callback:** The current WebWalletConfig has `onMonitorEvent` for structured lifecycle events. This can be re-added to the shim if consumers use it — check during Task 6 consumer updates. The simplified shim only wires `onTransactionBroadcasted` and `onTransactionProven` to the Monitor.
