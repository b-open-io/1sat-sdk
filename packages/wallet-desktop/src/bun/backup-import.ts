import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
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
import type { AccountInfo } from '../shared/types'
import { decodeBapAccountBackup } from './bap-account-backup'
import { installImportedAccount } from './wallet-manager'

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
	if (
		(words.length === 12 || words.length === 24) &&
		words.every((w) => /^[a-z]+$/.test(w))
	) {
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
	const { account, alreadyImported } = await installImportedAccount({
		rootKey,
		identityKey,
		displayName: identityKey.slice(0, 8),
		color: 'blue',
	})
	return {
		accounts: [account],
		errors: alreadyImported ? ['This wallet is already imported'] : [],
	}
}

/**
 * Import a decrypted backup — dispatches to the appropriate handler.
 */
async function importDecryptedBackup(
	backup: DecryptedBackup,
): Promise<ImportResult> {
	const backupType = getBackupType(backup)

	if (isMasterBackup(backup)) {
		return importFromMasterBackup(backup)
	}

	if (isAccountBackup(backup)) {
		const member = decodeBapAccountBackup(backup)
		return importSingleKey(member.rootKey, backup.label, member.identityKey)
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
	identityKey = pk.toPublicKey().toString(),
): Promise<ImportResult> {
	const { account, alreadyImported } = await installImportedAccount({
		rootKey: pk,
		identityKey,
		displayName: label ?? identityKey.slice(0, 8),
		color: 'violet',
	})
	return {
		accounts: [account],
		errors: alreadyImported ? ['This wallet is already imported'] : [],
	}
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
		bap = new BAP({ rootPk: backup.rootPk })
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
	console.log(
		`[backup-import] ${knownCount} identities in backup, scanning chain for more...`,
	)

	// Discover additional identities from chain.
	// Check identity existence (ID attestation), not just profile (ALIAS).
	// An identity can exist on-chain without having a published profile.
	let discovered = 0
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			const nextId = bap.newId()
			console.log(`[backup-import] Checking identity ${nextId.bapId}...`)
			const exists = await checkIdentityOnChain(nextId.bapId)
			if (!exists) {
				console.log('[backup-import] Not found on chain, stopping discovery')
				bap.removeId(nextId.bapId)
				break
			}
			discovered++
			console.log(`[backup-import] Found on chain! (${discovered} discovered)`)
		} catch (err) {
			console.error('[backup-import] Discovery error:', err)
			break
		}
	}

	console.log(
		`[backup-import] Discovery complete: ${knownCount} from backup + ${discovered} from chain`,
	)

	// Create wallet accounts for all identities
	const allIds = bap.listIds()
	const masterRootKey = getMasterRootKey(backup)
	const colors = [
		'blue',
		'amber',
		'rose',
		'emerald',
		'violet',
		'cyan',
		'orange',
		'pink',
	]

	for (let i = 0; i < allIds.length; i++) {
		const bapId = allIds[i]
		try {
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

			const { account } = await installImportedAccount({
				rootKey: masterRootKey,
				identityKey: bapId,
				displayName,
				color: colors[i % colors.length],
				createdAt: backup.createdAt ?? new Date().toISOString(),
			})
			accounts.push(account)
		} catch (err) {
			errors.push(
				`${bapId.slice(0, 12)}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	return { accounts, errors }
}

function getMasterRootKey(backup: BapMasterBackup): PrivateKey {
	if (isType42Backup(backup)) {
		return PrivateKey.fromWif(backup.rootPk)
	}
	return HD.fromString(backup.xprv).privKey
}

const STACK_URL = 'http://127.0.0.1:8080'
const REMOTE_BAP_API = 'https://api.1sat.app/1sat/bap'

/**
 * Check if a BAP identity exists on chain.
 * Tries local stack first, then remote BAP API, then profile endpoint.
 */
async function checkIdentityOnChain(bapId: string): Promise<boolean> {
	// 1. Try local stack identity endpoint
	try {
		const res = await fetch(`${STACK_URL}/1sat/bap/identity/get`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ idKey: bapId }),
			signal: AbortSignal.timeout(3000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data?.idKey || data?.rootAddress) {
				console.log('[backup-import] Found via local stack identity/get')
				return true
			}
		}
	} catch {
		/* stack not available */
	}

	// 2. Try local stack profile endpoint (might find ALIAS even if identity/get doesn't)
	try {
		const res = await fetch(`${STACK_URL}/1sat/bap/profile/${bapId}`, {
			signal: AbortSignal.timeout(3000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data && !data.message?.includes('not found')) {
				console.log('[backup-import] Found via local stack profile')
				return true
			}
		}
	} catch {
		/* stack not available */
	}

	// 3. Try remote BAP API
	try {
		const res = await fetch(`${REMOTE_BAP_API}/identity/get`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ idKey: bapId }),
			signal: AbortSignal.timeout(5000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data?.idKey || data?.rootAddress || data?.status === 'OK') {
				console.log('[backup-import] Found via remote BAP API identity/get')
				return true
			}
		}
	} catch {
		/* remote not available */
	}

	// 4. Try remote profile endpoint as last resort
	try {
		const res = await fetch(`${REMOTE_BAP_API}/profile/${bapId}`, {
			signal: AbortSignal.timeout(5000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data?.status === 'OK' || data?.result) {
				console.log('[backup-import] Found via remote BAP API profile')
				return true
			}
		}
	} catch {
		/* remote not available */
	}

	console.log(`[backup-import] ${bapId} not found on any source`)
	return false
}

/**
 * Fetch the BAP profile (ALIAS attestation) for display name/avatar.
 * Tries local stack first, then remote.
 */
async function fetchBapProfile(
	bapId: string,
): Promise<Record<string, unknown> | null> {
	// Try local stack
	try {
		const res = await fetch(`${STACK_URL}/1sat/bap/profile/${bapId}`, {
			signal: AbortSignal.timeout(3000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data && !data.message?.includes('not found')) {
				if (data?.alternateName || data?.name)
					return data as Record<string, unknown>
				if (data?.result) return data.result as Record<string, unknown>
			}
		}
	} catch {
		/* stack not available */
	}

	// Try remote
	try {
		const res = await fetch(`${REMOTE_BAP_API}/profile/${bapId}`, {
			signal: AbortSignal.timeout(5000),
		})
		if (res.ok) {
			const data = await res.json()
			if (data?.result) return data.result as Record<string, unknown>
		}
	} catch {
		/* remote not available */
	}

	return null
}
