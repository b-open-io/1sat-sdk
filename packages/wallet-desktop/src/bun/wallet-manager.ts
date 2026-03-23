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
import { Utils } from 'electrobun/bun'
import type { BalanceInfo, SyncEvent, WalletStatus } from '../shared/types'
import { isStackRunning, getStackUrl } from './sidecar-manager'
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
 * Check whether the vault holds a stored root key,
 * and update the status accordingly.
 */
export function checkVault(): boolean {
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

	const stackRemote = isStackRunning() ? `${getStackUrl()}/1sat/wallet` : undefined

	walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(),
		activeRemote: stackRemote,
	})

	setStatus('unlocked')
	wireMonitorEvents()
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

	const stackRemote = isStackRunning() ? `${getStackUrl()}/1sat/wallet` : undefined

	walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(),
		activeRemote: stackRemote,
	})

	setStatus('unlocked')
	wireMonitorEvents()
	await pushBalance()
}

/**
 * Lock the wallet — destroys the in-memory instance.
 */
export async function lock(): Promise<void> {
	if (walletResult) {
		await walletResult.destroy()
		walletResult = undefined
	}
	setStatus('locked')
}

/**
 * Delete the wallet entirely — removes the vault entry and the SQLite DB.
 */
export async function deleteWallet(): Promise<void> {
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
