/**
 * Wallet lifecycle manager.
 *
 * Module-scoped singleton that manages the active wallet instance.
 * The root key is only in memory during create/unlock — once
 * `createNodeWallet` is called, the local reference is cleared.
 *
 * All operations are parameterized by accountId. Each account gets
 * its own database directory under `{userData}/accounts/{accountId}/`.
 */
import type { Vault } from '@1sat/vault'
import type { NodeWalletResult } from '@1sat/wallet-node'
import { createNodeWallet } from '@1sat/wallet-node'
import { HD, Mnemonic, PrivateKey, Hash } from '@bsv/sdk'
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { Utils } from 'electrobun/bun'
import type { BalanceInfo, SyncEvent, WalletStatus } from '../shared/types'
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
let activeAccountId: string | undefined

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

/** Allow index.ts to set status for account-selection before wallet lifecycle begins. */
export function setInitialStatus(status: WalletStatus): void {
	currentStatus = status
}

function accountDir(accountId: string): string {
	return `${Utils.paths.userData}/accounts/${accountId}`
}

function dbPath(accountId: string): string {
	return `${accountDir(accountId)}/wallet.db`
}

function ensureAccountDir(accountId: string): void {
	mkdirSync(accountDir(accountId), { recursive: true })
}

function deriveRootKey(mnemonic: string): PrivateKey {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const master = HD.fromSeed(seed)
	return master.privKey
}

/**
 * Compute a stable account ID from an identity public key.
 * First 8 hex chars of SHA-256(identityKey).
 */
export function computeAccountId(identityKey: string): string {
	const bytes = Array.from(new TextEncoder().encode(identityKey))
	const hash = Hash.sha256(bytes) as number[]
	return hash
		.slice(0, 4)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
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

export function getActiveAccountId(): string | undefined {
	return activeAccountId
}

/**
 * Check whether the vault holds a stored root key for the given account.
 */
export function checkVault(accountId: string): boolean {
	const v = getVault()
	return hasStoredKey(v, accountId)
}

/**
 * Create a new wallet from a mnemonic.
 * Derives the root key, protects it with the vault, then boots the wallet.
 * Returns the identity public key for registry purposes.
 */
export async function create(
	accountId: string,
	mnemonic: string,
	_passphrase: string,
): Promise<{ identityKey: string }> {
	const v = getVault()
	const rootKey = deriveRootKey(mnemonic)
	const rootKeyHex = rootKey.toHex()
	const identityKey = rootKey.toPublicKey().toString()

	await protectRootKey(v, accountId, rootKeyHex)
	ensureAccountDir(accountId)

	walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(accountId),
	})

	activeAccountId = accountId
	setStatus('unlocked')
	wireMonitorEvents()

	onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'success',
		message: 'Wallet created',
	})

	await pushBalance()
	return { identityKey }
}

/**
 * Unlock an existing wallet by retrieving the root key from the vault.
 * On macOS this triggers Touch ID.
 */
export async function unlock(
	accountId: string,
	_passphrase: string,
): Promise<void> {
	const v = getVault()
	const rootKeyHex = await retrieveRootKey(v, accountId)
	const rootKey = PrivateKey.fromHex(rootKeyHex)
	const identityKey = rootKey.toPublicKey().toString()

	ensureAccountDir(accountId)

	walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(accountId),
	})

	activeAccountId = accountId
	setStatus('unlocked')
	wireMonitorEvents()

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

	await pushBalance()
}

/**
 * Switch to a different account. Locks the current wallet, then unlocks the new one.
 */
export async function switchAccount(
	accountId: string,
	_passphrase: string,
): Promise<void> {
	if (walletResult) {
		await walletResult.destroy()
		walletResult = undefined
	}
	activeAccountId = undefined
	setStatus('locked')
	await unlock(accountId, _passphrase)
}

/**
 * Lock the wallet — destroys the in-memory instance.
 */
export async function lock(): Promise<void> {
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
 * Delete a specific account's wallet — removes the vault entry and the SQLite DB.
 */
export async function deleteWallet(accountId: string): Promise<void> {
	// Refuse to delete the active account
	if (accountId === activeAccountId) {
		throw new Error('Cannot delete the active account — switch to a different account first')
	}

	const v = getVault()
	try {
		await removeStoredKey(v, accountId)
	} catch {
		// Key may not exist — that's fine
	}

	// Remove the account directory and all its contents
	const dir = accountDir(accountId)
	const path = dbPath(accountId)

	for (const suffix of ['', '-wal', '-shm']) {
		const filePath = `${path}${suffix}`
		if (existsSync(filePath)) {
			unlinkSync(filePath)
		}
	}

	// Try to remove the empty directory
	try {
		const { rmdirSync } = await import('node:fs')
		if (existsSync(dir)) {
			rmdirSync(dir)
		}
	} catch {
		// Directory may not be empty or may not exist
	}
}

// ============================================================================
// Migration: single-account → multi-account
// ============================================================================

/**
 * Migrate a legacy single-account wallet to the multi-account structure.
 * Returns the new accountId on success, null if no legacy wallet found.
 *
 * This triggers Touch ID to read the old key, then re-encrypts under
 * the new account-specific label and moves the database file.
 */
export async function migrateLegacyWallet(
	legacyLabel: string,
): Promise<{ accountId: string; identityKey: string } | null> {
	const v = getVault()
	const secrets = v.listSecrets()
	const hasLegacy = secrets.some((s) => s.label === legacyLabel)
	if (!hasLegacy) return null

	// Read old key (triggers Touch ID)
	const { plaintext: rootKeyHex } = await v.unlockSecret(legacyLabel)
	const rootKey = PrivateKey.fromHex(rootKeyHex)
	const identityKey = rootKey.toPublicKey().toString()
	const accountId = computeAccountId(identityKey)

	// Re-protect under new label
	await protectRootKey(v, accountId, rootKeyHex)

	// Move wallet.db to account directory
	const oldDbPath = `${Utils.paths.userData}/wallet.db`
	const newDir = accountDir(accountId)
	mkdirSync(newDir, { recursive: true })

	for (const suffix of ['', '-wal', '-shm']) {
		const src = `${oldDbPath}${suffix}`
		if (existsSync(src)) {
			renameSync(src, `${newDir}/wallet.db${suffix}`)
		}
	}

	// Remove old vault entry
	await v.removeSecret(legacyLabel)

	return { accountId, identityKey }
}
