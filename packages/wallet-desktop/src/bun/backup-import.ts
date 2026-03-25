/**
 * Unified backup import — handles all bitcoin-backup formats plus raw mnemonics.
 *
 * Supported inputs:
 * - Encrypted backup file (any bitcoin-backup format, password required)
 * - Raw mnemonic phrase (12 or 24 words)
 * - Unencrypted JSON backup (BapMasterBackup, WifBackup, etc.)
 *
 * A master backup can contain many identities. Each identity becomes
 * its own BRC-100 wallet account. After import, profiles are synced
 * from chain to get display names and avatars.
 */
import type { BapMasterBackup, DecryptedBackup } from 'bitcoin-backup'
import {
	decryptBackup,
	getBackupType,
	isAccountBackup,
	isLegacyBackup,
	isMasterBackup,
	isOneSatBackup,
	isType42Backup,
	isWifBackup,
	isYoursWalletBackup,
} from 'bitcoin-backup'
import { BAP } from 'bsv-bap'
import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import type { AccountInfo } from '../shared/types'
import { addAccount, getAccount, listAccounts } from './account-registry'
import { computeAccountId } from './wallet-manager'
import { createDesktopVault, protectRootKey } from './vault-manager'

export interface ImportResult {
	accounts: AccountInfo[]
	errors: string[]
}

/**
 * Import from any supported source. Detects format automatically.
 *
 * @param input - Encrypted string, JSON string, or mnemonic phrase
 * @param password - Password for encrypted backups (ignored for mnemonic/unencrypted)
 */
export async function importBackup(
	input: string,
	password: string,
): Promise<ImportResult> {
	const trimmed = input.trim()

	// Check if it's a mnemonic (12 or 24 words, all lowercase alpha)
	const words = trimmed.split(/\s+/)
	if ((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]+$/.test(w))) {
		return importFromMnemonic(trimmed)
	}

	// Try to parse as unencrypted JSON
	try {
		const parsed = JSON.parse(trimmed) as DecryptedBackup
		return importDecryptedBackup(parsed)
	} catch {
		// Not valid JSON — treat as encrypted
	}

	// Decrypt with password
	if (!password) {
		throw new Error('Password required for encrypted backup')
	}

	let backup: DecryptedBackup
	try {
		backup = await decryptBackup(trimmed, password)
	} catch {
		throw new Error('Decryption failed — wrong password or corrupted file')
	}

	return importDecryptedBackup(backup)
}

/**
 * Import from a raw mnemonic phrase — creates one wallet account.
 */
async function importFromMnemonic(mnemonic: string): Promise<ImportResult> {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const master = HD.fromSeed(seed)
	const rootKey = master.privKey
	const identityKey = rootKey.toPublicKey().toString()
	const accountId = computeAccountId(identityKey)

	if (getAccount(accountId)) {
		return { accounts: [getAccount(accountId)!], errors: ['This wallet is already imported'] }
	}

	const vault = createDesktopVault()
	await protectRootKey(vault, accountId, rootKey.toHex())

	const account: AccountInfo = {
		id: accountId,
		identityKey,
		displayName: identityKey.slice(0, 8),
		color: 'blue',
		createdAt: new Date().toISOString(),
		lastUsedAt: new Date().toISOString(),
	}
	addAccount(account)
	return { accounts: [account], errors: [] }
}

/**
 * Import a decrypted backup — dispatches to the appropriate handler.
 */
async function importDecryptedBackup(backup: DecryptedBackup): Promise<ImportResult> {
	const backupType = getBackupType(backup)

	if (isMasterBackup(backup)) {
		return importFromMasterBackup(backup)
	}

	if (isAccountBackup(backup)) {
		return importSingleKey(PrivateKey.fromWif(backup.wif), backup.label)
	}

	if (isWifBackup(backup)) {
		return importSingleKey(PrivateKey.fromWif(backup.wif), backup.label)
	}

	if (isOneSatBackup(backup)) {
		// OneSat backup has ordPk, payPk, identityPk — use identityPk as the root
		return importSingleKey(PrivateKey.fromWif(backup.identityPk), backup.label)
	}

	if (isYoursWalletBackup(backup)) {
		// Yours wallet has payPk, ordPk, optional identityPk + optional mnemonic
		if (backup.mnemonic) {
			return importFromMnemonic(backup.mnemonic)
		}
		const pk = backup.identityPk
			? PrivateKey.fromWif(backup.identityPk)
			: PrivateKey.fromWif(backup.payPk)
		return importSingleKey(pk, backup.label)
	}

	throw new Error(`Unsupported backup format: ${backupType}`)
}

/**
 * Import a single private key as one account.
 */
async function importSingleKey(
	pk: PrivateKey,
	label?: string,
): Promise<ImportResult> {
	const identityKey = pk.toPublicKey().toString()
	const accountId = computeAccountId(identityKey)

	if (getAccount(accountId)) {
		return { accounts: [getAccount(accountId)!], errors: ['This wallet is already imported'] }
	}

	const vault = createDesktopVault()
	await protectRootKey(vault, accountId, pk.toHex())

	const account: AccountInfo = {
		id: accountId,
		identityKey,
		displayName: label ?? identityKey.slice(0, 8),
		color: 'violet',
		createdAt: new Date().toISOString(),
		lastUsedAt: new Date().toISOString(),
	}
	addAccount(account)
	return { accounts: [account], errors: [] }
}

/**
 * Import identities from a BAP master backup.
 * Derives all known IDs and discovers additional ones from chain.
 */
async function importFromMasterBackup(
	backup: BapMasterBackup,
): Promise<ImportResult> {
	const accounts: AccountInfo[] = []
	const errors: string[] = []

	// Initialize BAP from the master backup
	let bap: BAP
	if (isType42Backup(backup)) {
		bap = new BAP(backup.rootPk)
	} else if (isLegacyBackup(backup)) {
		bap = new BAP(backup.xprv)
	} else {
		throw new Error('Unknown master backup format')
	}

	// Import existing IDs from the backup
	if (backup.ids) {
		bap.importIds(backup.ids)
	}

	const knownCount = bap.listIds().length
	console.log(`[backup-import] ${knownCount} identities in backup, scanning chain for more...`)

	// Discover additional identities from chain.
	// Check identity existence (ID attestation), not just profile (ALIAS).
	// An identity can exist on-chain without having a published profile.
	let discovered = 0
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			const nextId = bap.newId()
			console.log(`[backup-import] Checking identity ${nextId.bapId.slice(0, 16)}...`)
			const exists = await checkIdentityOnChain(nextId.bapId)
			if (!exists) {
				console.log(`[backup-import] Not found on chain, stopping discovery`)
				bap.removeId(nextId.bapId)
				break
			}
			discovered++
			console.log(`[backup-import] Found on chain! (${discovered} discovered)`)
		} catch (err) {
			console.error(`[backup-import] Discovery error:`, err)
			break
		}
	}

	console.log(`[backup-import] Discovery complete: ${knownCount} from backup + ${discovered} from chain`)

	// Create wallet accounts for all identities
	const allIds = bap.listIds()
	const vault = createDesktopVault()
	const masterRootKeyHex = getMasterRootKey(backup)
	const colors = ['blue', 'amber', 'rose', 'emerald', 'violet', 'cyan', 'orange', 'pink']

	for (let i = 0; i < allIds.length; i++) {
		const bapId = allIds[i]
		try {
			const accountId = computeAccountId(bapId)

			if (getAccount(accountId)) {
				accounts.push(getAccount(accountId)!)
				continue
			}

			await protectRootKey(vault, accountId, masterRootKeyHex)

			// Try to get display name from on-chain profile
			let displayName = backup.label ?? `Identity ${i + 1}`
			try {
				const profile = await fetchBapProfile(bapId)
				if (profile?.alternateName || profile?.name) {
					displayName = (profile.alternateName ?? profile.name) as string
				}
			} catch {
				// Use default
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
			errors.push(`${bapId.slice(0, 12)}: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	return { accounts, errors }
}

function getMasterRootKey(backup: BapMasterBackup): string {
	if (isType42Backup(backup)) {
		return PrivateKey.fromWif(backup.rootPk).toHex()
	}
	return HD.fromString(backup.xprv).privKey.toHex()
}

const STACK_URL = 'http://127.0.0.1:8080'

/**
 * Check if a BAP identity exists on chain (ID attestation).
 * Uses the local 1sat-stack POST /identity/get endpoint.
 */
async function checkIdentityOnChain(bapId: string): Promise<boolean> {
	// Try local stack (POST /1sat/bap/identity/get)
	try {
		const res = await fetch(`${STACK_URL}/1sat/bap/identity/get`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ idKey: bapId }),
			signal: AbortSignal.timeout(5000),
		})
		if (res.ok) {
			const data = await res.json()
			return Boolean(data?.idKey || data?.rootAddress)
		}
	} catch { /* stack not available */ }

	return false
}

/**
 * Fetch the BAP profile (ALIAS attestation) for display name/avatar.
 * Falls back to remote API if local stack is unavailable.
 */
async function fetchBapProfile(bapId: string): Promise<Record<string, unknown> | null> {
	// Try local stack
	try {
		const res = await fetch(`${STACK_URL}/1sat/bap/profile/${bapId}`, {
			signal: AbortSignal.timeout(3000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data?.alternateName || data?.name) return data as Record<string, unknown>
			if (data?.result) return data.result as Record<string, unknown>
		}
	} catch { /* stack not available */ }

	return null
}
