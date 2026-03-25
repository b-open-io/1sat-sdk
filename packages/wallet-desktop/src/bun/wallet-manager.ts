/**
 * Wallet lifecycle manager — multi-instance.
 *
 * Supports multiple simultaneous wallet instances, one per account.
 * Each account window gets its own wallet with independent callbacks.
 * The root key is only in memory during create/unlock — once
 * `createNodeWallet` is called, the local reference is cleared.
 */
import type { Vault } from '@1sat/vault'
import type { NodeWalletResult } from '@1sat/wallet-node'
import { createNodeWallet } from '@1sat/wallet-node'
import { HD, Mnemonic, PrivateKey, Hash } from '@bsv/sdk'
import { BAP } from 'bsv-bap'
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
// Types
// ============================================================================

export interface WalletCallbacks {
	onStatusChanged?: (status: WalletStatus) => void
	onBalanceUpdated?: (balance: BalanceInfo) => void
	onSyncEvent?: (event: SyncEvent) => void
}

interface WalletInstance {
	accountId: string
	wallet: NodeWalletResult
	callbacks: WalletCallbacks
}

// ============================================================================
// Module state
// ============================================================================

let vault: Vault | undefined

/** Map of running wallet instances, keyed by accountId */
const wallets = new Map<string, WalletInstance>()

/**
 * Global status for the picker window (before any account is opened).
 * Individual account windows track their own status via callbacks.
 */
let globalStatus: WalletStatus = 'initializing'
let globalStatusCallback: ((status: WalletStatus) => void) | undefined

// ============================================================================
// Helpers
// ============================================================================

function getVault(): Vault {
	if (!vault) {
		vault = createDesktopVault()
	}
	return vault
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
 * Derive the primary BAP ID from a root private key.
 */
export function deriveBapId(rootKeyWif: string): { bapId: string; ids: string } {
	const bap = new BAP(rootKeyWif)
	const ids = bap.listIds()
	if (ids.length === 0) {
		const firstId = bap.newId()
		return { bapId: firstId.bapId, ids: bap.exportIds() }
	}
	return { bapId: ids[0], ids: bap.exportIds() }
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

/** Push balance for a specific account's wallet. */
async function pushBalance(instance: WalletInstance): Promise<void> {
	if (!instance.callbacks.onBalanceUpdated) return
	try {
		const result = await instance.wallet.wallet.listOutputs({
			basket: 'default',
			include: 'locking scripts',
		})
		let confirmed = 0
		for (const output of result.outputs) {
			if (output.spendable) {
				confirmed += output.satoshis
			}
		}
		instance.callbacks.onBalanceUpdated({ confirmed, unconfirmed: 0 })
	} catch (err) {
		console.error(`Failed to push balance for ${instance.accountId}:`, err)
	}
}

/** Wire monitor events for a specific account's wallet. */
function wireMonitorEvents(instance: WalletInstance): void {
	if (!instance.wallet.monitor || !instance.callbacks.onSyncEvent) return
	const monitor = instance.wallet.monitor
	const cb = instance.callbacks.onSyncEvent

	monitor.onTransactionBroadcasted = async (result) => {
		cb({
			timestamp: Date.now(),
			source: 'monitor',
			level: 'log',
			message: result.txid
				? `Transaction broadcasted: ${result.txid}`
				: 'Transaction broadcast attempted',
		})
	}

	monitor.onTransactionProven = async (status) => {
		cb({
			timestamp: Date.now(),
			source: 'monitor',
			level: 'log',
			message: `Transaction proven at block ${status.blockHeight}: ${status.txid}`,
		})
	}
}

// ============================================================================
// Global status (for picker window)
// ============================================================================

export function setGlobalStatusCallback(cb: (status: WalletStatus) => void): void {
	globalStatusCallback = cb
}

export function setInitialStatus(status: WalletStatus): void {
	globalStatus = status
}

export function getGlobalStatus(): WalletStatus {
	return globalStatus
}

function setGlobalStatus(status: WalletStatus): void {
	globalStatus = status
	globalStatusCallback?.(status)
}

// ============================================================================
// Multi-instance API
// ============================================================================

/**
 * Check whether the vault holds a stored root key for the given account.
 */
export function checkVault(accountId: string): boolean {
	const v = getVault()
	return hasStoredKey(v, accountId)
}

/**
 * Get a running wallet instance for a specific account.
 */
export function getWalletForAccount(accountId: string): NodeWalletResult | undefined {
	return wallets.get(accountId)?.wallet
}

/**
 * Check if a wallet is running for a specific account.
 */
export function isAccountOpen(accountId: string): boolean {
	return wallets.has(accountId)
}

/**
 * Get all running account IDs.
 */
export function getOpenAccountIds(): string[] {
	return Array.from(wallets.keys())
}

/**
 * Create a new wallet from a mnemonic.
 * Returns the identity public key and BAP ID for registry purposes.
 */
export async function create(
	accountId: string,
	mnemonic: string,
	_passphrase: string,
	callbacks: WalletCallbacks = {},
): Promise<{ identityKey: string; bapId: string }> {
	const v = getVault()
	const rootKey = deriveRootKey(mnemonic)
	const rootKeyHex = rootKey.toHex()
	const identityKey = rootKey.toPublicKey().toString()
	const { bapId } = deriveBapId(rootKey.toWif())

	await protectRootKey(v, accountId, rootKeyHex)
	ensureAccountDir(accountId)

	const walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(accountId),
	})

	const instance: WalletInstance = { accountId, wallet: walletResult, callbacks }
	wallets.set(accountId, instance)

	callbacks.onStatusChanged?.('unlocked')
	wireMonitorEvents(instance)

	callbacks.onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'success',
		message: 'Wallet created',
	})

	await pushBalance(instance)
	return { identityKey, bapId }
}

/**
 * Unlock an existing wallet by retrieving the root key from the vault.
 * On macOS this triggers Touch ID.
 */
export async function unlock(
	accountId: string,
	_passphrase: string,
	callbacks: WalletCallbacks = {},
): Promise<void> {
	// If already open, just update callbacks
	if (wallets.has(accountId)) {
		const existing = wallets.get(accountId)!
		existing.callbacks = callbacks
		callbacks.onStatusChanged?.('unlocked')
		await pushBalance(existing)
		return
	}

	const v = getVault()
	const rootKeyHex = await retrieveRootKey(v, accountId)
	const rootKey = PrivateKey.fromHex(rootKeyHex)
	const identityKey = rootKey.toPublicKey().toString()

	ensureAccountDir(accountId)

	const walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey: `1sat-wallet:${identityKey}`,
		filename: dbPath(accountId),
	})

	const instance: WalletInstance = { accountId, wallet: walletResult, callbacks }
	wallets.set(accountId, instance)

	callbacks.onStatusChanged?.('unlocked')
	wireMonitorEvents(instance)

	callbacks.onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'success',
		message: 'Wallet unlocked via Touch ID',
	})

	callbacks.onSyncEvent?.({
		timestamp: Date.now(),
		source: 'wallet',
		level: 'log',
		message: 'Monitor started',
	})

	await pushBalance(instance)
}

/**
 * Lock a specific account's wallet — destroys the in-memory instance.
 */
export async function lockAccount(accountId: string): Promise<void> {
	const instance = wallets.get(accountId)
	if (instance) {
		instance.callbacks.onSyncEvent?.({
			timestamp: Date.now(),
			source: 'wallet',
			level: 'log',
			message: 'Wallet locked',
		})
		await instance.wallet.destroy()
		wallets.delete(accountId)
	}
}

/**
 * Lock all wallets (used during shutdown).
 */
export async function lockAll(): Promise<void> {
	for (const [accountId, instance] of wallets) {
		await instance.wallet.destroy()
		wallets.delete(accountId)
	}
	setGlobalStatus('account-selection')
}

/**
 * Delete a specific account's wallet — removes the vault entry and the SQLite DB.
 */
export async function deleteWallet(accountId: string): Promise<void> {
	// Close wallet if running
	if (wallets.has(accountId)) {
		await lockAccount(accountId)
	}

	const v = getVault()
	try {
		await removeStoredKey(v, accountId)
	} catch {
		// Key may not exist
	}

	const dir = accountDir(accountId)
	const path = dbPath(accountId)

	for (const suffix of ['', '-wal', '-shm']) {
		const filePath = `${path}${suffix}`
		if (existsSync(filePath)) {
			unlinkSync(filePath)
		}
	}

	try {
		if (existsSync(dir)) {
			const { rmdirSync } = await import('node:fs')
			rmdirSync(dir)
		}
	} catch {
		// Directory may not be empty
	}
}

// ============================================================================
// Backward compatibility — singleton-style API for the picker window
// These are used by RPC handlers that don't yet have a window context.
// They operate on the FIRST running wallet instance.
// ============================================================================

/** Get the first running wallet (for RPC handlers that aren't window-aware yet). */
export function getWallet(): NodeWalletResult | undefined {
	const first = wallets.values().next()
	return first.done ? undefined : first.value.wallet
}

export function getServices(): OneSatServices | undefined {
	return getWallet()?.services
}

export function getMonitor() {
	return getWallet()?.monitor
}

export function getActiveAccountId(): string | undefined {
	const first = wallets.keys().next()
	return first.done ? undefined : first.value
}

export function getStatus(): WalletStatus {
	// If any wallet is running, return 'unlocked'
	if (wallets.size > 0) return 'unlocked'
	return globalStatus
}

// Legacy callbacks — used by index.ts for the picker window
export function setStatusChangedCallback(cb: (status: WalletStatus) => void): void {
	globalStatusCallback = cb
}

export function setBalanceUpdatedCallback(_cb: (balance: BalanceInfo) => void): void {
	// No-op in multi-instance mode — each window wires its own callbacks
}

export function setSyncEventCallback(_cb: (event: SyncEvent) => void): void {
	// No-op in multi-instance mode
}

// ============================================================================
// Migration: single-account → multi-account
// ============================================================================

export async function migrateLegacyWallet(
	legacyLabel: string,
): Promise<{ accountId: string; identityKey: string } | null> {
	const v = getVault()
	const secrets = v.listSecrets()
	const hasLegacy = secrets.some((s) => s.label === legacyLabel)
	if (!hasLegacy) return null

	const { plaintext: rootKeyHex } = await v.unlockSecret(legacyLabel)
	const rootKey = PrivateKey.fromHex(rootKeyHex)
	const identityKey = rootKey.toPublicKey().toString()
	const accountId = computeAccountId(identityKey)

	await protectRootKey(v, accountId, rootKeyHex)

	const oldDbPath = `${Utils.paths.userData}/wallet.db`
	const newDir = accountDir(accountId)
	mkdirSync(newDir, { recursive: true })

	for (const suffix of ['', '-wal', '-shm']) {
		const src = `${oldDbPath}${suffix}`
		if (existsSync(src)) {
			renameSync(src, `${newDir}/wallet.db${suffix}`)
		}
	}

	await v.removeSecret(legacyLabel)

	return { accountId, identityKey }
}

/**
 * Recover orphaned accounts — vault entries that match the pattern
 * but have no registry entry.
 */
export async function recoverOrphanedAccounts(): Promise<number> {
	const { addAccount, getAccount } = await import('./account-registry')
	const { getBuildChannel } = await import('./vault-manager')

	const v = getVault()
	const channel = getBuildChannel()
	const prefix = 'g1sat-wallet-'
	const suffix = `-${channel}`
	const secrets = v.listSecrets()
	let recovered = 0

	for (const secret of secrets) {
		if (!secret.label.startsWith(prefix) || !secret.label.endsWith(suffix)) continue
		if (secret.label === `1sat-wallet-root-key-${channel}`) continue

		const accountId = secret.label.slice(prefix.length, -suffix.length)
		if (!accountId || getAccount(accountId)) continue

		try {
			const { plaintext: rootKeyHex } = await v.unlockSecret(secret.label)
			const rootKey = PrivateKey.fromHex(rootKeyHex)
			const identityKey = rootKey.toPublicKey().toString()

			addAccount({
				id: accountId,
				identityKey,
				displayName: 'Account 1',
				color: 'amber',
				createdAt: new Date().toISOString(),
				lastUsedAt: new Date().toISOString(),
			})

			const { setLastActiveAccountId } = await import('./account-registry')
			setLastActiveAccountId(accountId)
			recovered++
		} catch {
			// Touch ID cancelled or key unreadable
		}
	}

	return recovered
}
