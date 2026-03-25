/**
 * Master backup import — decrypts a bitcoin-backup file, discovers all
 * BAP identities, and creates a wallet account for each one.
 *
 * A master backup can contain many identities. Each identity becomes
 * its own BRC-100 wallet account in the account registry. After import,
 * profiles are synced from chain to get display names and avatars.
 */
import type { BapMasterBackup, DecryptedBackup } from 'bitcoin-backup'
import { decryptBackup, isMasterBackup, isType42Backup, isLegacyBackup, isWifBackup, isAccountBackup } from 'bitcoin-backup'
import { BAP } from 'bsv-bap'
import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import type { AccountInfo } from '../shared/types'
import { addAccount, getAccount, listAccounts } from './account-registry'
import { computeAccountId, create } from './wallet-manager'
import { createDesktopVault, protectRootKey } from './vault-manager'

export interface ImportProgress {
	step: string
	status: 'in_progress' | 'completed' | 'error'
	detail?: string
}

export interface ImportResult {
	accounts: AccountInfo[]
	errors: string[]
}

/**
 * Import a master backup file. Decrypts, discovers identities, creates
 * wallet accounts for each one.
 */
export async function importMasterBackup(
	encryptedData: string,
	password: string,
	onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
	const accounts: AccountInfo[] = []
	const errors: string[] = []

	// 1. Decrypt
	onProgress?.({ step: 'Decrypting backup', status: 'in_progress' })
	let backup: DecryptedBackup
	try {
		backup = await decryptBackup(encryptedData, password)
	} catch (err) {
		throw new Error(`Decryption failed — wrong password or corrupted file`)
	}
	onProgress?.({ step: 'Decrypted backup', status: 'completed' })

	// 2. Handle based on backup type
	if (isMasterBackup(backup)) {
		const result = await importFromMasterBackup(backup, onProgress)
		accounts.push(...result.accounts)
		errors.push(...result.errors)
	} else if (isWifBackup(backup)) {
		// Single WIF — create one account
		onProgress?.({ step: 'Importing WIF key', status: 'in_progress' })
		try {
			const pk = PrivateKey.fromWif(backup.wif)
			const identityKey = pk.toPublicKey().toString()
			const accountId = computeAccountId(identityKey)

			if (getAccount(accountId)) {
				errors.push('This wallet is already imported')
			} else {
				const vault = createDesktopVault()
				await protectRootKey(vault, accountId, pk.toHex())

				const account: AccountInfo = {
					id: accountId,
					identityKey,
					displayName: backup.label ?? identityKey.slice(0, 8),
					color: 'blue',
					createdAt: backup.createdAt ?? new Date().toISOString(),
					lastUsedAt: new Date().toISOString(),
				}
				addAccount(account)
				accounts.push(account)
			}
		} catch (err) {
			errors.push(`WIF import failed: ${err instanceof Error ? err.message : String(err)}`)
		}
		onProgress?.({ step: 'WIF import complete', status: 'completed' })
	} else if (isAccountBackup(backup)) {
		// Single account backup — create one account from WIF
		onProgress?.({ step: 'Importing account', status: 'in_progress' })
		try {
			const pk = PrivateKey.fromWif(backup.wif)
			const identityKey = pk.toPublicKey().toString()
			const accountId = computeAccountId(identityKey)

			if (getAccount(accountId)) {
				errors.push('This account is already imported')
			} else {
				const vault = createDesktopVault()
				await protectRootKey(vault, accountId, pk.toHex())

				const account: AccountInfo = {
					id: accountId,
					identityKey,
					displayName: backup.label ?? identityKey.slice(0, 8),
					color: 'violet',
					createdAt: backup.createdAt ?? new Date().toISOString(),
					lastUsedAt: new Date().toISOString(),
				}
				addAccount(account)
				accounts.push(account)
			}
		} catch (err) {
			errors.push(`Account import failed: ${err instanceof Error ? err.message : String(err)}`)
		}
		onProgress?.({ step: 'Account import complete', status: 'completed' })
	} else {
		throw new Error('Unsupported backup format')
	}

	return { accounts, errors }
}

/**
 * Import identities from a BAP master backup.
 * Derives all known IDs and discovers additional ones from chain.
 */
async function importFromMasterBackup(
	backup: BapMasterBackup,
	onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
	const accounts: AccountInfo[] = []
	const errors: string[] = []

	// Initialize BAP from the master backup
	onProgress?.({ step: 'Initializing identity manager', status: 'in_progress' })

	let bap: BAP
	if (isType42Backup(backup)) {
		bap = new BAP(backup.rootPk)
	} else if (isLegacyBackup(backup)) {
		// Legacy: derive root key from xprv or mnemonic
		bap = new BAP(backup.xprv)
	} else {
		throw new Error('Unknown master backup format')
	}

	// Import existing IDs from the backup
	if (backup.ids) {
		bap.importIds(backup.ids)
	}

	// Get all known identity keys
	const knownIds = bap.listIds()
	onProgress?.({
		step: `Found ${knownIds.length} identities in backup`,
		status: 'in_progress',
	})

	// Discover additional identities from chain (like sigma-auth does)
	onProgress?.({ step: 'Scanning chain for additional identities', status: 'in_progress' })
	let discoveredCount = 0
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			const nextId = bap.newId()
			const nextBapId = nextId.bapId

			// Check if this identity exists on-chain
			const profile = await fetchBapProfile(nextBapId)
			if (profile) {
				discoveredCount++
				onProgress?.({
					step: `Discovered ${discoveredCount} additional identities`,
					status: 'in_progress',
				})
			} else {
				// No profile found — remove this ID and stop discovery
				bap.removeId(nextBapId)
				break
			}
		} catch {
			break
		}
	}

	if (discoveredCount > 0) {
		onProgress?.({
			step: `Discovered ${discoveredCount} additional identities from chain`,
			status: 'completed',
		})
	}

	// Now create wallet accounts for all identities
	const allIds = bap.listIds()
	const vault = createDesktopVault()
	const masterRootKey = getMasterRootKey(backup)

	const colors = ['blue', 'amber', 'rose', 'emerald', 'violet', 'cyan', 'orange', 'pink']

	for (let i = 0; i < allIds.length; i++) {
		const bapId = allIds[i]
		onProgress?.({
			step: `Creating account ${i + 1} of ${allIds.length}`,
			status: 'in_progress',
			detail: bapId.slice(0, 16),
		})

		try {
			const master = bap.getId(bapId)
			if (!master) {
				errors.push(`Failed to get identity for ${bapId.slice(0, 16)}`)
				continue
			}

			// The account key for each identity is derived from the master
			// Each identity effectively becomes its own BRC-100 wallet
			const identityKey = master.rootAddress
			const accountId = computeAccountId(bapId)

			if (getAccount(accountId)) {
				// Already imported — skip
				const existing = getAccount(accountId)!
				accounts.push(existing)
				continue
			}

			// Protect the master root key for this account
			await protectRootKey(vault, accountId, masterRootKey)

			// Try to get a display name from chain profile
			let displayName = backup.label ?? `Identity ${i + 1}`
			try {
				const profile = await fetchBapProfile(bapId)
				if (profile?.alternateName || profile?.name) {
					displayName = (profile.alternateName ?? profile.name) as string
				}
			} catch {
				// Profile fetch failed — use default name
			}

			const account: AccountInfo = {
				id: accountId,
				identityKey: bapId,
				displayName,
				color: colors[i % colors.length],
				createdAt: backup.createdAt ?? new Date().toISOString(),
				lastUsedAt: new Date().toISOString(),
			}
			addAccount(account)
			accounts.push(account)
		} catch (err) {
			errors.push(
				`Failed to create account for ${bapId.slice(0, 16)}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	onProgress?.({
		step: `Imported ${accounts.length} accounts`,
		status: 'completed',
	})

	return { accounts, errors }
}

/** Extract the root private key hex from a master backup. */
function getMasterRootKey(backup: BapMasterBackup): string {
	if (isType42Backup(backup)) {
		return PrivateKey.fromWif(backup.rootPk).toHex()
	}
	// Legacy: derive from xprv
	const hd = HD.fromString(backup.xprv)
	return hd.privKey.toHex()
}

/** Fetch a BAP profile from the 1sat-stack or remote API. */
async function fetchBapProfile(
	bapId: string,
): Promise<Record<string, unknown> | null> {
	// Try local stack first
	try {
		const res = await fetch(`http://127.0.0.1:8080/1sat/bap/profile/${bapId}`, {
			signal: AbortSignal.timeout(3000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data?.result) return data.result as Record<string, unknown>
		}
	} catch {
		// Stack not available
	}

	// Try remote API
	try {
		const res = await fetch(`https://bap-api.com/v1/identity/get/${bapId}`, {
			signal: AbortSignal.timeout(5000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data?.result) return data.result as Record<string, unknown>
		}
	} catch {
		// Remote not available
	}

	return null
}
