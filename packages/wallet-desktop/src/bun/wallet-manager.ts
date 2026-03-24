/**
 * Wallet lifecycle manager.
 *
 * Module-scoped singleton that manages the wallet instance.
 * The root key is only in memory during create/unlock — once
 * `createNodeWallet` is called, the local reference is cleared.
 */
import type { OneSatServices } from '@1sat/client'
import type { Vault } from '@1sat/vault'
import type { NodeWalletResult } from '@1sat/wallet-node'
import { createNodeWallet } from '@1sat/wallet-node'
import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Utils } from 'electrobun/bun'
import type { BalanceInfo, SyncEvent, WalletStatus } from '../shared/types'
import { getStackUrl, isStackSetupComplete } from './sidecar-manager'
import {
	createDesktopVault,
	hasStoredKey,
	protectRootKey,
	removeStoredKey,
	retrieveRootKey,
} from './vault-manager'

// ============================================================================
// Module state
// ============================================================================

let vault: Vault | undefined
let walletResult: NodeWalletResult | undefined
let currentStatus: WalletStatus = 'initializing'

/** Callback fired whenever the wallet status changes. */
let onStatusChanged: ((status: WalletStatus) => void) | undefined

/** Callback fired whenever the balance changes. */
let onBalanceUpdated: ((balance: BalanceInfo) => void) | undefined

/** Callback fired for sync events (monitor activity). */
let onSyncEvent: ((event: SyncEvent) => void) | undefined

// ============================================================================
// Helpers
// ============================================================================

function getVault(): Vault {
	if (!vault) {
		vault = createDesktopVault()
	}
	return vault
}

function setStatus(status: WalletStatus): void {
	currentStatus = status
	onStatusChanged?.(status)
}

function dbPath(): string {
	return `${Utils.paths.userData}/wallet.db`
}

function deriveRootKey(mnemonic: string): PrivateKey {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const master = HD.fromSeed(seed)
	return master.privKey
}

/** Compute and push the current balance. */
async function pushBalance(): Promise<void> {
	if (!walletResult || !onBalanceUpdated) return
	try {
		const result = await walletResult.wallet.listOutputs({
			basket: 'default',
			include: 'locking scripts',
		})
		let confirmed = 0
		for (const output of result.outputs) {
			if (output.spendable) {
				confirmed += output.satoshis
			}
		}
		onBalanceUpdated({ confirmed, unconfirmed: 0 })
	} catch (err) {
		console.error('Failed to push initial balance:', err)
	}
}

/** Wire monitor callbacks to emit sync events. */
function wireMonitorEvents(): void {
	if (!walletResult?.monitor || !onSyncEvent) return
	const monitor = walletResult.monitor

	monitor.onTransactionBroadcasted = async (result) => {
		onSyncEvent?.({
			timestamp: Date.now(),
			source: 'monitor',
			level: 'log',
			message: result.txid
				? `Transaction broadcasted: ${result.txid}`
				: 'Transaction broadcast attempted',
		})
	}

	monitor.onTransactionProven = async (status) => {
		onSyncEvent?.({
			timestamp: Date.now(),
			source: 'monitor',
			level: 'log',
			message: `Transaction proven at block ${status.blockHeight}: ${status.txid}`,
		})
	}
}

/** Periodic interval handle for cleanup on lock. */
let syncStatusInterval: ReturnType<typeof setInterval> | undefined

/** Push periodic sync status from the 1sat-stack health endpoint. */
function startSyncStatusPusher(): void {
	// Clear any previous interval
	if (syncStatusInterval) {
		clearInterval(syncStatusInterval)
	}

	syncStatusInterval = setInterval(async () => {
		try {
			const res = await fetch('http://127.0.0.1:8080/1sat/health', {
				signal: AbortSignal.timeout(2000),
			})
			if (res.ok) {
				const data = (await res.json()) as {
					height?: number
					uptime?: number
				}
				onSyncEvent?.({
					timestamp: Date.now(),
					source: 'stack',
					level: 'log',
					message: `Block height: ${data.height ?? '?'} | Uptime: ${data.uptime ?? '?'}s`,
				})
			}
		} catch {
			// Stack unreachable — skip this tick
		}
	}, 10000)
}

/** Stop the periodic sync status pusher. */
function stopSyncStatusPusher(): void {
	if (syncStatusInterval) {
		clearInterval(syncStatusInterval)
		syncStatusInterval = undefined
	}
}

// ============================================================================
// Public API
// ============================================================================

export function setStatusChangedCallback(
	cb: (status: WalletStatus) => void,
): void {
	onStatusChanged = cb
}

export function setBalanceUpdatedCallback(
	cb: (balance: BalanceInfo) => void,
): void {
	onBalanceUpdated = cb
}

export function setSyncEventCallback(cb: (event: SyncEvent) => void): void {
	onSyncEvent = cb
}

export function getStatus(): WalletStatus {
	return currentStatus
}

export function getWallet(): NodeWalletResult | undefined {
	return walletResult
}

export function getServices(): OneSatServices | undefined {
	return walletResult?.services
}

export function getMonitor() {
	return walletResult?.monitor
}

/**
 * Migrate data from the old `com.1satwallet` app identifier to the
 * current `app.1sat` path. Only runs once — skips if the new location
 * already has wallet data. The Secure Enclave key is in
 * `~/.secure-enclave-vault/` (independent of app identifier) so it
 * remains accessible after migration.
 */
function migrateFromOldIdentifier(): void {
	const newUserData = Utils.paths.userData
	// Derive old path: replace `app.1sat` with `com.1satwallet` in parent
	const oldUserData = path.join(
		path.dirname(newUserData),
		'com.1satwallet',
		path.basename(newUserData), // preserves channel subdir (e.g. "dev")
	)

	// Nothing to migrate if old path doesn't exist
	if (!existsSync(oldUserData)) return

	const oldDb = path.join(oldUserData, 'wallet.db')
	const newDb = dbPath()

	// Don't overwrite if new DB already exists
	if (existsSync(newDb)) return
	if (!existsSync(oldDb)) return

	console.log(`Migrating wallet data from ${oldUserData} to ${newUserData}`)

	// Copy wallet DB files (db, db-wal, db-shm)
	for (const suffix of ['', '-wal', '-shm']) {
		const src = `${oldDb}${suffix}`
		if (existsSync(src)) {
			copyFileSync(src, `${newDb}${suffix}`)
			console.log(`  Copied wallet.db${suffix}`)
		}
	}

	// Copy vault directory
	const oldVault = path.join(oldUserData, 'vault')
	const newVault = path.join(newUserData, 'vault')
	if (existsSync(oldVault) && !existsSync(newVault)) {
		mkdirSync(newVault, { recursive: true })
		for (const file of readdirSync(oldVault)) {
			copyFileSync(path.join(oldVault, file), path.join(newVault, file))
			console.log(`  Copied vault/${file}`)
		}
	}

	console.log('Migration complete')
}

/**
 * Check whether the vault holds a stored root key,
 * and update the status accordingly.
 */
export function checkVault(): boolean {
	// Migrate from old app identifier if needed
	try {
		migrateFromOldIdentifier()
	} catch (err) {
		console.error('Migration from com.1satwallet failed:', err)
	}

	const v = getVault()
	const stored = hasStoredKey(v)
	if (
		stored &&
		(currentStatus === 'initializing' || currentStatus === 'no-wallet')
	) {
		setStatus('locked')
	} else if (!stored) {
		setStatus('no-wallet')
	}
	return stored
}

/**
 * Create a new wallet from a mnemonic.
 * Derives the root key, protects it with the vault, then boots the wallet.
 */
export async function create(
	mnemonic: string,
	_passphrase: string,
): Promise<void> {
	const v = getVault()
	const rootKey = deriveRootKey(mnemonic)
	const rootKeyHex = rootKey.toHex()
	const identityKey = rootKey.toPublicKey().toString()

	await protectRootKey(v, rootKeyHex)

	const stackReady = await isStackSetupComplete()
	const stackRemote = stackReady ? `${getStackUrl()}/1sat/wallet` : undefined

	walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(),
		activeRemote: stackRemote,
	})

	setStatus('unlocked')
	wireMonitorEvents()
	startSyncStatusPusher()

	onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'success',
		message: 'Wallet created',
	})

	if (stackRemote) {
		onSyncEvent?.({
			timestamp: Date.now(),
			source: 'wallet',
			level: 'log',
			message: 'Connected to 1sat-stack',
		})
	}

	await pushBalance()
}

/**
 * Unlock an existing wallet by retrieving the root key from the vault.
 * On macOS this triggers Touch ID.
 */
export async function unlock(_passphrase: string): Promise<void> {
	const v = getVault()
	const rootKeyHex = await retrieveRootKey(v)
	const rootKey = PrivateKey.fromHex(rootKeyHex)
	const identityKey = rootKey.toPublicKey().toString()

	const stackReady = await isStackSetupComplete()
	const stackRemote = stackReady ? `${getStackUrl()}/1sat/wallet` : undefined

	walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(),
		activeRemote: stackRemote,
	})

	setStatus('unlocked')
	wireMonitorEvents()
	startSyncStatusPusher()

	onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'success',
		message: 'Wallet unlocked via Touch ID',
	})

	onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'log',
		message: 'Monitor started',
	})

	if (stackRemote) {
		onSyncEvent?.({
			timestamp: Date.now(),
			source: 'wallet',
			level: 'log',
			message: 'Connected to 1sat-stack',
		})
	}

	await pushBalance()
}

/**
 * Lock the wallet — destroys the in-memory instance.
 */
export async function lock(): Promise<void> {
	stopSyncStatusPusher()
	if (walletResult) {
		await walletResult.destroy()
		walletResult = undefined
	}
	onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'log',
		message: 'Wallet locked',
	})
	setStatus('locked')
}

/**
 * Delete the wallet entirely — removes the vault entry and the SQLite DB.
 */
export async function deleteWallet(): Promise<void> {
	stopSyncStatusPusher()
	// Destroy running wallet first
	if (walletResult) {
		await walletResult.destroy()
		walletResult = undefined
	}

	const v = getVault()
	try {
		await removeStoredKey(v)
	} catch {
		// Key may not exist — that's fine
	}

	// Remove the SQLite database file
	const { unlinkSync, existsSync } = await import('node:fs')
	const path = dbPath()
	if (existsSync(path)) {
		unlinkSync(path)
	}
	// Also remove WAL/SHM files if present (SQLite journal)
	for (const suffix of ['-wal', '-shm']) {
		const journalPath = `${path}${suffix}`
		if (existsSync(journalPath)) {
			unlinkSync(journalPath)
		}
	}

	setStatus('no-wallet')
}
