import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
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
import { StorageBunSqlite, createNodeWallet } from '@1sat/wallet-node'
import { HD, Hash, Mnemonic, PrivateKey } from '@bsv/sdk'
import { BAP } from 'bsv-bap'
import { Utils } from 'electrobun/bun'
import type {
	AccountInfo,
	BalanceInfo,
	SyncEvent,
	WalletStatus,
} from '../shared/types'
import { installIfAccountMissing } from './account-install'
import {
	addAccount,
	getAccount,
	reloadAccountRegistry,
	removeAccount,
	setLastActiveAccountId,
} from './account-registry'
import {
	loadStorageIdentityKey,
	loadWalletUserIdentityKey,
	prepareStorageIdentityKey,
	sweepStaleStorageIdentityFiles,
	withStorageLifecycleLock,
} from './storage-identity'
import {
	createDesktopVault,
	getBuildChannel,
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
	identityKey: string
	rootIdentityKey: string
	wallet: NodeWalletResult
	callbacks: WalletCallbacks
}

// ============================================================================
// Module state
// ============================================================================

let vault: Vault | undefined

/** Map of running wallet instances, keyed by accountId */
const wallets = new Map<string, WalletInstance>()
const accountOperations = new Map<string, Promise<void>>()

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
	return `${accountsRoot()}/${accountId}`
}

function accountsRoot(): string {
	return `${Utils.paths.userData}/accounts`
}

function dbPath(accountId: string): string {
	return `${accountDir(accountId)}/wallet.db`
}

function ensureAccountDir(accountId: string): void {
	const path = accountDir(accountId)
	mkdirSync(path, { recursive: true, mode: 0o700 })
	chmodSync(path, 0o700)
}

async function withAccountSingleFlight<T>(
	accountId: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = accountOperations.get(accountId) ?? Promise.resolve()
	let release = () => {}
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const tail = previous.then(
		() => gate,
		() => gate,
	)
	accountOperations.set(accountId, tail)
	await previous.catch(() => {})
	try {
		return await operation()
	} finally {
		release()
		if (accountOperations.get(accountId) === tail) {
			accountOperations.delete(accountId)
		}
	}
}

function deriveRootKey(mnemonic: string): PrivateKey {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const master = HD.fromSeed(seed)
	return master.privKey
}

/**
 * Derive the primary BAP ID from a root private key.
 */
export function deriveBapId(rootKeyWif: string): {
	bapId: string
	ids: string
} {
	const bap = new BAP({ rootPk: rootKeyWif })
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

function verifyAccountIdentity(accountId: string, identityKey: string): void {
	if (
		!/^[0-9a-f]{8}$/.test(accountId) ||
		computeAccountId(identityKey) !== accountId
	) {
		throw new Error('Account ID does not match its wallet identity')
	}
}

export function sweepStaleAccountStorageArtifacts(): Promise<number> {
	const root = accountsRoot()
	return withStorageLifecycleLock(root, () =>
		sweepStaleStorageIdentityFiles(root),
	)
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

export function setGlobalStatusCallback(
	cb: (status: WalletStatus) => void,
): void {
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
export function getWalletForAccount(
	accountId: string,
): NodeWalletResult | undefined {
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

interface InstallAccountKeyResult {
	instance?: WalletInstance
	newlyOpened: boolean
}

async function installAccountKeyUnlocked(args: {
	accountId: string
	identityKey: string
	rootKey: PrivateKey
	callbacks?: WalletCallbacks
	openWallet: boolean
}): Promise<InstallAccountKeyResult> {
	const { accountId, identityKey, rootKey, callbacks = {}, openWallet } = args
	verifyAccountIdentity(accountId, identityKey)
	const rootIdentityKey = rootKey.toPublicKey().toString()
	const existing = wallets.get(accountId)
	if (existing) {
		if (
			existing.identityKey !== identityKey ||
			existing.rootIdentityKey !== rootIdentityKey
		) {
			throw new Error('Open wallet does not match the requested account key')
		}
		if (openWallet) existing.callbacks = callbacks
		return { instance: existing, newlyOpened: false }
	}

	ensureAccountDir(accountId)
	const databasePath = dbPath(accountId)
	const storageIdentityKey = await prepareStorageIdentityKey(
		databasePath,
		async (stagedDatabasePath, stagedStorageIdentityKey) => {
			const stagedWallet = await createNodeWallet({
				privateKey: rootKey.toWif(),
				chain: 'main',
				storageIdentityKey: stagedStorageIdentityKey,
				storage: { provider: 'bun-sqlite', filename: stagedDatabasePath },
				skipInitialMonitor: true,
			})
			try {
				const stagedStorage = stagedWallet.getActiveStorage()
				if (!(stagedStorage instanceof StorageBunSqlite)) {
					throw new Error('Staged wallet did not use SQLite storage')
				}
				stagedStorage.db.run('PRAGMA wal_checkpoint(TRUNCATE)')
				const row = stagedStorage.db
					.query<{ journal_mode: string }, []>('PRAGMA journal_mode = DELETE')
					.get()
				if (row?.journal_mode.toLowerCase() !== 'delete') {
					throw new Error('Could not checkpoint staged wallet database')
				}
			} finally {
				await stagedWallet.destroy()
			}
		},
	)

	if (loadWalletUserIdentityKey(databasePath) !== rootIdentityKey) {
		throw new Error('Wallet database belongs to a different root key')
	}

	await protectRootKey(
		getVault(),
		accountId,
		rootKey.toHex(),
		identityKey,
		rootIdentityKey,
	)

	if (!openWallet) return { newlyOpened: false }

	const walletResult = await createNodeWallet({
		privateKey: rootKey.toWif(),
		chain: 'main',
		storageIdentityKey,
		storage: { provider: 'bun-sqlite', filename: databasePath },
	})
	chmodSync(databasePath, 0o600)

	const instance: WalletInstance = {
		accountId,
		identityKey,
		rootIdentityKey,
		wallet: walletResult,
		callbacks,
	}
	wallets.set(accountId, instance)
	wireMonitorEvents(instance)
	return { instance, newlyOpened: true }
}

export async function installImportedAccount(args: {
	rootKey: PrivateKey
	identityKey?: string
	displayName: string
	color: string
	createdAt?: string
}): Promise<{ account: AccountInfo; alreadyImported: boolean }> {
	const identityKey = args.identityKey ?? args.rootKey.toPublicKey().toString()
	const accountId = computeAccountId(identityKey)
	return withAccountSingleFlight(accountId, async () => {
		return withStorageLifecycleLock(accountsRoot(), async () => {
			reloadAccountRegistry()
			const existing = getAccount(accountId)
			const installation = await installIfAccountMissing({
				existing,
				identityKey,
				install: () =>
					installAccountKeyUnlocked({
						accountId,
						identityKey,
						rootKey: args.rootKey,
						openWallet: false,
					}),
			})
			if (installation.alreadyExists) {
				return { account: installation.account, alreadyImported: true }
			}

			const account: AccountInfo = {
				id: accountId,
				identityKey,
				displayName: args.displayName,
				color: args.color,
				createdAt: args.createdAt ?? new Date().toISOString(),
				lastUsedAt: new Date().toISOString(),
			}
			addAccount(account)
			return { account, alreadyImported: false }
		})
	})
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
	accountOptions: {
		displayName?: string
		color?: string
		createdAt?: string
	} = {},
): Promise<{
	account: AccountInfo
	alreadyCreated: boolean
	identityKey: string
	bapId: string
}> {
	const rootKey = deriveRootKey(mnemonic)
	const identityKey = rootKey.toPublicKey().toString()
	const { bapId } = deriveBapId(rootKey.toWif())
	const result = await withAccountSingleFlight(accountId, async () => {
		return withStorageLifecycleLock(accountsRoot(), async () => {
			reloadAccountRegistry()
			const existingAccount = getAccount(accountId)
			const installation = await installIfAccountMissing({
				existing: existingAccount,
				identityKey,
				install: () =>
					installAccountKeyUnlocked({
						accountId,
						identityKey,
						rootKey,
						callbacks,
						openWallet: true,
					}),
			})
			if (installation.alreadyExists) {
				return { account: installation.account, alreadyCreated: true }
			}
			const { instance, newlyOpened } = installation.installed
			const now = new Date().toISOString()
			const account: AccountInfo = {
				id: accountId,
				identityKey,
				bapId,
				displayName: accountOptions.displayName ?? bapId.slice(0, 12),
				color: accountOptions.color ?? 'blue',
				createdAt: accountOptions.createdAt ?? now,
				lastUsedAt: now,
			}
			addAccount(account)
			setLastActiveAccountId(accountId)
			callbacks.onStatusChanged?.('unlocked')
			if (newlyOpened) {
				callbacks.onSyncEvent?.({
					timestamp: Date.now(),
					source: 'wallet',
					level: 'success',
					message: 'Wallet created',
				})
			}
			if (instance) await pushBalance(instance)
			return { account, alreadyCreated: false }
		})
	})
	return { ...result, identityKey, bapId }
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
	await withAccountSingleFlight(accountId, async () => {
		const existing = wallets.get(accountId)
		if (existing) {
			existing.callbacks = callbacks
			callbacks.onStatusChanged?.('unlocked')
			await pushBalance(existing)
			return
		}

		const account = getAccount(accountId)
		if (!account) throw new Error('Account not found')
		verifyAccountIdentity(accountId, account.identityKey)
		const { rootKeyHex, rootIdentityKey: storedRootIdentityKey } =
			await retrieveRootKey(getVault(), accountId, account.identityKey)
		const rootKey = PrivateKey.fromHex(rootKeyHex)
		const rootIdentityKey = rootKey.toPublicKey().toString()
		if (
			storedRootIdentityKey
				? storedRootIdentityKey !== rootIdentityKey
				: account.identityKey !== rootIdentityKey
		) {
			throw new Error('Vault root key does not match the wallet identity')
		}

		ensureAccountDir(accountId)
		const databasePath = dbPath(accountId)
		const storageIdentityKey = loadStorageIdentityKey(databasePath)
		if (loadWalletUserIdentityKey(databasePath) !== rootIdentityKey) {
			throw new Error('Wallet database belongs to a different root key')
		}

		const walletResult = await createNodeWallet({
			privateKey: rootKey.toWif(),
			chain: 'main',
			storageIdentityKey,
			storage: { provider: 'bun-sqlite', filename: databasePath },
		})
		chmodSync(databasePath, 0o600)

		const instance: WalletInstance = {
			accountId,
			identityKey: account.identityKey,
			rootIdentityKey,
			wallet: walletResult,
			callbacks,
		}
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
	})
}

/**
 * Lock a specific account's wallet — destroys the in-memory instance.
 */
export async function lockAccount(accountId: string): Promise<void> {
	await withAccountSingleFlight(accountId, () => lockAccountUnlocked(accountId))
}

async function lockAccountUnlocked(accountId: string): Promise<void> {
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
	const accountIds = new Set([...wallets.keys(), ...accountOperations.keys()])
	for (const accountId of accountIds) {
		await withAccountSingleFlight(accountId, () =>
			lockAccountUnlocked(accountId),
		)
	}
	setGlobalStatus('account-selection')
}

/**
 * Delete a specific account's wallet — removes the vault entry and the SQLite DB.
 */
export async function deleteWallet(accountId: string): Promise<void> {
	await withAccountSingleFlight(accountId, async () => {
		await withStorageLifecycleLock(accountsRoot(), async () => {
			reloadAccountRegistry()
			await lockAccountUnlocked(accountId)

			const v = getVault()
			if (hasStoredKey(v, accountId)) await removeStoredKey(v, accountId)

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
			removeAccount(accountId)
		})
	})
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

// Legacy callbacks — used by index.ts for the picker window.
// These are wired to the global status and also forwarded to
// any running wallet (for the picker-reuse case).
let legacyBalanceCb: ((balance: BalanceInfo) => void) | undefined
let legacySyncCb: ((event: SyncEvent) => void) | undefined

export function setStatusChangedCallback(
	cb: (status: WalletStatus) => void,
): void {
	globalStatusCallback = cb
}

export function setBalanceUpdatedCallback(
	cb: (balance: BalanceInfo) => void,
): void {
	legacyBalanceCb = cb
}

export function setSyncEventCallback(cb: (event: SyncEvent) => void): void {
	legacySyncCb = cb
}

/** Get legacy callbacks for the picker window reuse case. */
export function getLegacyCallbacks(): WalletCallbacks {
	return {
		onStatusChanged: (status) => globalStatusCallback?.(status),
		onBalanceUpdated: (balance) => legacyBalanceCb?.(balance),
		onSyncEvent: (event) => legacySyncCb?.(event),
	}
}

/**
 * Recover orphaned accounts — vault entries that match the pattern
 * but have no registry entry.
 */
export async function recoverOrphanedAccounts(): Promise<number> {
	return withStorageLifecycleLock(accountsRoot(), async () => {
		reloadAccountRegistry()
		return recoverOrphanedAccountsUnlocked()
	})
}

async function recoverOrphanedAccountsUnlocked(): Promise<number> {
	const v = getVault()
	const channel = getBuildChannel()
	const prefix = '1sat-wallet-'
	const suffix = `-${channel}`
	const secrets = v.listSecrets()
	let recovered = 0

	for (const secret of secrets) {
		if (!secret.label.startsWith(prefix) || !secret.label.endsWith(suffix))
			continue
		if (secret.label === `1sat-wallet-root-key-${channel}`) continue

		const accountId = secret.label.slice(prefix.length, -suffix.length)
		if (!/^[0-9a-f]{8}$/.test(accountId) || getAccount(accountId)) continue

		try {
			const databasePath = dbPath(accountId)
			loadStorageIdentityKey(databasePath)
			const { plaintext: rootKeyHex } = await v.unlockSecret(secret.label)
			const rootKey = PrivateKey.fromHex(rootKeyHex)
			const rootIdentityKey = rootKey.toPublicKey().toString()
			if (loadWalletUserIdentityKey(databasePath) !== rootIdentityKey) {
				throw new Error('Wallet database belongs to a different root key')
			}

			const identityKey = secret.metadata?.identityKey ?? rootIdentityKey
			if (
				secret.metadata &&
				(secret.metadata.accountId !== accountId ||
					secret.metadata.rootIdentityKey !== rootIdentityKey)
			) {
				throw new Error('Vault metadata does not match the recovered account')
			}
			verifyAccountIdentity(accountId, identityKey)

			addAccount({
				id: accountId,
				identityKey,
				displayName: 'Account 1',
				color: 'amber',
				createdAt: new Date().toISOString(),
				lastUsedAt: new Date().toISOString(),
			})

			setLastActiveAccountId(accountId)
			recovered++
		} catch {
			// Touch ID cancelled or key unreadable
		}
	}

	return recovered
}
