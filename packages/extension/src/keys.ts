/**
 * @1sat/extension/keys - Encrypted key management for wallet extensions
 *
 * Uses bitcoin-backup for encryption and browser.storage.local for persistence.
 * Works across Chrome, Firefox, Edge, and Safari via webextension-polyfill.
 *
 * @example
 * ```typescript
 * import { KeyStore } from '@1sat/extension/keys'
 *
 * const keyStore = new KeyStore()
 *
 * // Generate new keys
 * await keyStore.generate()
 *
 * // Lock with passphrase (encrypts to storage)
 * await keyStore.lock('my-passphrase')
 *
 * // Unlock (decrypts from storage)
 * await keyStore.unlock('my-passphrase')
 *
 * // Get keys for signing
 * const keys = keyStore.getKeys()
 *
 * // Export encrypted backup
 * const backup = await keyStore.exportBackup('export-passphrase')
 *
 * // Import from backup
 * await keyStore.importBackup(backup, 'export-passphrase')
 * ```
 */

import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import { decryptBackup, encryptBackup, type OneSatBackup } from 'bitcoin-backup'
import browser from 'webextension-polyfill'

// ============================================================================
// HD Derivation Path Constants
// ============================================================================

/** Yours Wallet standard paths */
export const YOURS_WALLET_PATH = "m/44'/236'/0'/1/0"
export const YOURS_ORD_PATH = "m/44'/236'/1'/0/0"
export const YOURS_ID_PATH = "m/0'/236'/0'/0/0"

/** RelayX paths */
export const RELAYX_WALLET_PATH = YOURS_WALLET_PATH
export const RELAYX_ORD_PATH = "m/44'/236'/0'/2/0"
export const RELAYX_ID_PATH = YOURS_ID_PATH
export const RELAYX_SWEEP_PATH = "m/44'/236'/0'/0/0"

/** Twetch paths */
export const TWETCH_WALLET_PATH = 'm/0/0'
export const TWETCH_ORD_PATH = YOURS_ORD_PATH

/** AYM paths */
export const AYM_WALLET_PATH = 'm/0/0'
export const AYM_ORD_PATH = 'm'

/**
 * Derivation paths configuration
 */
export interface DerivationPaths {
	/** Path for payment/change address */
	paymentPath: string
	/** Path for ordinals address */
	ordinalPath: string
	/** Path for identity key (optional, defaults to ordinal path) */
	identityPath?: string
}

/** Default derivation paths (Yours wallet compatible) */
export const DEFAULT_DERIVATION_PATHS: DerivationPaths = {
	paymentPath: YOURS_WALLET_PATH,
	ordinalPath: YOURS_ORD_PATH,
	identityPath: YOURS_ID_PATH,
}

/** Storage key for encrypted wallet data */
const ENCRYPTED_WALLET_KEY = 'onesat_encrypted_wallet'

/** Storage key for wallet metadata (non-sensitive) */
const WALLET_META_KEY = 'onesat_wallet_meta'

/**
 * Wallet keys structure
 */
export interface WalletKeys {
	/** Payment private key */
	paymentKey: PrivateKey
	/** Ordinals private key */
	ordinalKey: PrivateKey
	/** Identity private key */
	identityKey: PrivateKey
}

/**
 * Wallet addresses derived from keys
 */
export interface WalletAddresses {
	paymentAddress: string
	ordinalAddress: string
	identityPubKey: string
}

/**
 * Wallet metadata (non-sensitive, stored unencrypted)
 */
export interface WalletMeta {
	/** Payment address */
	paymentAddress: string
	/** Ordinal address */
	ordinalAddress: string
	/** Identity public key */
	identityPubKey: string
	/** Creation timestamp */
	createdAt: string
	/** Optional label */
	label?: string
}

/**
 * Key store state
 */
export type KeyStoreState = 'empty' | 'locked' | 'unlocked'

/**
 * Encrypted key storage for browser wallet extensions
 *
 * Manages wallet keys with:
 * - bitcoin-backup encryption for secure storage
 * - browser.storage.local for persistence
 * - Session-based unlock mechanism
 */
export class KeyStore {
	private keys: WalletKeys | null = null
	private meta: WalletMeta | null = null

	/**
	 * Get current state of the key store
	 */
	async getState(): Promise<KeyStoreState> {
		if (this.keys) return 'unlocked'

		const result = await browser.storage.local.get(ENCRYPTED_WALLET_KEY)
		if (result[ENCRYPTED_WALLET_KEY]) return 'locked'

		return 'empty'
	}

	/**
	 * Check if wallet exists (locked or unlocked)
	 */
	async hasWallet(): Promise<boolean> {
		const state = await this.getState()
		return state !== 'empty'
	}

	/**
	 * Check if wallet is currently unlocked
	 */
	isUnlocked(): boolean {
		return this.keys !== null
	}

	/**
	 * Generate new random keys
	 * Does NOT persist - call lock() to encrypt and save
	 */
	generate(): WalletKeys {
		this.keys = {
			paymentKey: PrivateKey.fromRandom(),
			ordinalKey: PrivateKey.fromRandom(),
			identityKey: PrivateKey.fromRandom(),
		}

		this.meta = {
			paymentAddress: this.keys.paymentKey.toAddress(),
			ordinalAddress: this.keys.ordinalKey.toAddress(),
			identityPubKey: this.keys.identityKey.toPublicKey().toString(),
			createdAt: new Date().toISOString(),
		}

		return this.keys
	}

	/**
	 * Import keys from WIF strings
	 * Does NOT persist - call lock() to encrypt and save
	 */
	importWifs(
		paymentWif: string,
		ordinalWif: string,
		identityWif: string,
	): WalletKeys {
		this.keys = {
			paymentKey: PrivateKey.fromWif(paymentWif),
			ordinalKey: PrivateKey.fromWif(ordinalWif),
			identityKey: PrivateKey.fromWif(identityWif),
		}

		this.meta = {
			paymentAddress: this.keys.paymentKey.toAddress(),
			ordinalAddress: this.keys.ordinalKey.toAddress(),
			identityPubKey: this.keys.identityKey.toPublicKey().toString(),
			createdAt: new Date().toISOString(),
		}

		return this.keys
	}

	/**
	 * Import from a single WIF (uses same key for all purposes)
	 * Useful for simple wallets
	 */
	importSingleWif(wif: string): WalletKeys {
		const pk = PrivateKey.fromWif(wif)
		this.keys = {
			paymentKey: pk,
			ordinalKey: pk,
			identityKey: pk,
		}

		this.meta = {
			paymentAddress: pk.toAddress(),
			ordinalAddress: pk.toAddress(),
			identityPubKey: pk.toPublicKey().toString(),
			createdAt: new Date().toISOString(),
		}

		return this.keys
	}

	/**
	 * Import keys from a mnemonic with specified derivation paths
	 * @param mnemonic - BIP39 mnemonic phrase
	 * @param paths - Derivation paths (defaults to Yours wallet paths)
	 */
	importFromMnemonic(
		mnemonic: string,
		paths: DerivationPaths = DEFAULT_DERIVATION_PATHS,
	): WalletKeys {
		const seed = Mnemonic.fromString(mnemonic).toSeed()
		const masterNode = HD.fromSeed(seed)

		const paymentKey = masterNode.derive(paths.paymentPath).privKey
		const ordinalKey = masterNode.derive(paths.ordinalPath).privKey
		const identityKey = paths.identityPath
			? masterNode.derive(paths.identityPath).privKey
			: ordinalKey

		this.keys = {
			paymentKey,
			ordinalKey,
			identityKey,
		}

		this.meta = {
			paymentAddress: paymentKey.toAddress(),
			ordinalAddress: ordinalKey.toAddress(),
			identityPubKey: identityKey.toPublicKey().toString(),
			createdAt: new Date().toISOString(),
		}

		return this.keys
	}

	/**
	 * Import from mnemonic, finding an ordinal address with "1s" prefix
	 * Searches child keys until finding one with vanity "1s" prefix
	 * @param mnemonic - BIP39 mnemonic phrase
	 * @param timeout - Max search time in ms (default 100s)
	 */
	async findKeysFromMnemonic(
		mnemonic: string,
		timeout = 100000,
	): Promise<{ keys: WalletKeys; ordinalIndex: number }> {
		const seed = Mnemonic.fromString(mnemonic).toSeed()
		const masterNode = HD.fromSeed(seed)

		// Payment key at m/0
		const paymentKey = masterNode.derive('m/0').privKey

		// Search for ordinal key with "1s" prefix
		const startTime = Date.now()
		let index = 1

		while (Date.now() - startTime < timeout) {
			const ordinalNode = masterNode.derive(`m/${index}`)
			const address = ordinalNode.privKey.toAddress()

			if (address.startsWith('1s')) {
				const ordinalKey = ordinalNode.privKey

				this.keys = {
					paymentKey,
					ordinalKey,
					identityKey: ordinalKey, // Use same key for identity
				}

				this.meta = {
					paymentAddress: paymentKey.toAddress(),
					ordinalAddress: address,
					identityPubKey: ordinalKey.toPublicKey().toString(),
					createdAt: new Date().toISOString(),
				}

				return { keys: this.keys, ordinalIndex: index }
			}

			index++

			// Yield to event loop periodically
			if (index % 100 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 0))
			}
		}

		throw new Error(
			`Timeout: Could not find "1s" prefixed address within ${timeout}ms`,
		)
	}

	/**
	 * Lock the wallet - encrypts keys and saves to storage
	 * @param passphrase - Passphrase for encryption (min 8 chars)
	 */
	async lock(passphrase: string): Promise<void> {
		if (!this.keys || !this.meta) {
			throw new Error('No keys to lock - generate or import first')
		}

		// Create OneSatBackup format
		const backup: OneSatBackup = {
			payPk: this.keys.paymentKey.toWif(),
			ordPk: this.keys.ordinalKey.toWif(),
			identityPk: this.keys.identityKey.toWif(),
			label: this.meta.label,
			createdAt: this.meta.createdAt,
		}

		// Encrypt with bitcoin-backup
		const encrypted = await encryptBackup(backup, passphrase)

		// Save to browser.storage.local
		await browser.storage.local.set({
			[ENCRYPTED_WALLET_KEY]: encrypted,
			[WALLET_META_KEY]: this.meta,
		})

		// Clear keys from memory
		this.keys = null
	}

	/**
	 * Unlock the wallet - decrypts keys from storage
	 * @param passphrase - Passphrase used during lock()
	 */
	async unlock(passphrase: string): Promise<WalletKeys> {
		const result = await browser.storage.local.get([
			ENCRYPTED_WALLET_KEY,
			WALLET_META_KEY,
		])
		const encrypted = result[ENCRYPTED_WALLET_KEY] as string | undefined
		const storedMeta = result[WALLET_META_KEY] as WalletMeta | undefined

		if (!encrypted) {
			throw new Error('No encrypted wallet found')
		}

		// Decrypt with bitcoin-backup
		const backup = (await decryptBackup(encrypted, passphrase)) as OneSatBackup

		// Restore keys
		this.keys = {
			paymentKey: PrivateKey.fromWif(backup.payPk),
			ordinalKey: PrivateKey.fromWif(backup.ordPk),
			identityKey: PrivateKey.fromWif(backup.identityPk),
		}

		// Restore metadata
		this.meta = storedMeta ?? {
			paymentAddress: this.keys.paymentKey.toAddress(),
			ordinalAddress: this.keys.ordinalKey.toAddress(),
			identityPubKey: this.keys.identityKey.toPublicKey().toString(),
			createdAt: backup.createdAt || new Date().toISOString(),
			label: backup.label,
		}

		return this.keys
	}

	/**
	 * Get the current keys (must be unlocked)
	 */
	getKeys(): WalletKeys {
		if (!this.keys) {
			throw new Error('Wallet is locked - call unlock() first')
		}
		return this.keys
	}

	/**
	 * Get wallet addresses (available even when locked, from metadata)
	 */
	async getAddresses(): Promise<WalletAddresses | null> {
		// If unlocked, derive from keys
		if (this.keys) {
			return {
				paymentAddress: this.keys.paymentKey.toAddress(),
				ordinalAddress: this.keys.ordinalKey.toAddress(),
				identityPubKey: this.keys.identityKey.toPublicKey().toString(),
			}
		}

		// Otherwise try to get from stored metadata
		const result = await browser.storage.local.get(WALLET_META_KEY)
		if (result[WALLET_META_KEY]) {
			const meta = result[WALLET_META_KEY] as WalletMeta
			return {
				paymentAddress: meta.paymentAddress,
				ordinalAddress: meta.ordinalAddress,
				identityPubKey: meta.identityPubKey,
			}
		}

		return null
	}

	/**
	 * Export encrypted backup string
	 * Can use a different passphrase than the one used for lock()
	 * @param passphrase - Passphrase for the exported backup
	 */
	async exportBackup(passphrase: string): Promise<string> {
		if (!this.keys) {
			throw new Error('Wallet is locked - call unlock() first')
		}

		const backup: OneSatBackup = {
			payPk: this.keys.paymentKey.toWif(),
			ordPk: this.keys.ordinalKey.toWif(),
			identityPk: this.keys.identityKey.toWif(),
			label: this.meta?.label,
			createdAt: this.meta?.createdAt || new Date().toISOString(),
		}

		return encryptBackup(backup, passphrase)
	}

	/**
	 * Import from encrypted backup string
	 * @param encryptedBackup - Encrypted backup from exportBackup()
	 * @param passphrase - Passphrase used to encrypt the backup
	 */
	async importBackup(
		encryptedBackup: string,
		passphrase: string,
	): Promise<WalletKeys> {
		const backup = (await decryptBackup(
			encryptedBackup,
			passphrase,
		)) as OneSatBackup

		this.keys = {
			paymentKey: PrivateKey.fromWif(backup.payPk),
			ordinalKey: PrivateKey.fromWif(backup.ordPk),
			identityKey: PrivateKey.fromWif(backup.identityPk),
		}

		this.meta = {
			paymentAddress: this.keys.paymentKey.toAddress(),
			ordinalAddress: this.keys.ordinalKey.toAddress(),
			identityPubKey: this.keys.identityKey.toPublicKey().toString(),
			createdAt: backup.createdAt || new Date().toISOString(),
			label: backup.label,
		}

		return this.keys
	}

	/**
	 * Clear all wallet data from storage
	 * WARNING: This is irreversible if you don't have a backup!
	 */
	async clear(): Promise<void> {
		this.keys = null
		this.meta = null
		await browser.storage.local.remove([ENCRYPTED_WALLET_KEY, WALLET_META_KEY])
	}

	/**
	 * Clear keys from memory (keeps encrypted data in storage)
	 * Call this when user locks the wallet or extension goes idle
	 */
	clearMemory(): void {
		this.keys = null
	}

	/**
	 * Set a label for the wallet
	 */
	async setLabel(label: string): Promise<void> {
		if (this.meta) {
			this.meta.label = label
			await browser.storage.local.set({ [WALLET_META_KEY]: this.meta })
		}
	}
}

/**
 * Create a new KeyStore instance
 */
export function createKeyStore(): KeyStore {
	return new KeyStore()
}

// ============================================================================
// Standalone Utility Functions
// ============================================================================

/**
 * Derive a single private key from mnemonic and path
 */
export function deriveKeyFromMnemonic(
	mnemonic: string,
	path: string,
): PrivateKey {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const masterNode = HD.fromSeed(seed)
	return masterNode.derive(path).privKey
}

/**
 * Derive keys from mnemonic with specified paths
 */
export function deriveKeysFromMnemonic(
	mnemonic: string,
	paths: DerivationPaths = DEFAULT_DERIVATION_PATHS,
): WalletKeys {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const masterNode = HD.fromSeed(seed)

	const paymentKey = masterNode.derive(paths.paymentPath).privKey
	const ordinalKey = masterNode.derive(paths.ordinalPath).privKey
	const identityKey = paths.identityPath
		? masterNode.derive(paths.identityPath).privKey
		: ordinalKey

	return { paymentKey, ordinalKey, identityKey }
}

/**
 * Find keys from mnemonic with "1s" vanity ordinal address
 * Standalone function (doesn't require KeyStore)
 */
export async function findKeysFromMnemonic(
	mnemonic: string,
	timeout = 100000,
): Promise<{ keys: WalletKeys; paymentIndex: number; ordinalIndex: number }> {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const masterNode = HD.fromSeed(seed)

	// Payment key at m/0
	const paymentKey = masterNode.derive('m/0').privKey

	// Search for ordinal key with "1s" prefix
	const startTime = Date.now()
	let index = 1

	while (Date.now() - startTime < timeout) {
		const ordinalNode = masterNode.derive(`m/${index}`)
		const address = ordinalNode.privKey.toAddress()

		if (address.startsWith('1s')) {
			const ordinalKey = ordinalNode.privKey

			return {
				keys: {
					paymentKey,
					ordinalKey,
					identityKey: ordinalKey,
				},
				paymentIndex: 0,
				ordinalIndex: index,
			}
		}

		index++

		// Yield to event loop periodically
		if (index % 100 === 0) {
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
	}

	throw new Error(
		`Timeout: Could not find "1s" prefixed address within ${timeout}ms`,
	)
}

/**
 * Generate a new random BIP39 mnemonic
 */
export function generateMnemonic(): string {
	return Mnemonic.fromRandom().toString()
}

/**
 * Validate a BIP39 mnemonic phrase
 */
export function validateMnemonic(mnemonic: string): boolean {
	try {
		Mnemonic.fromString(mnemonic)
		return true
	} catch {
		return false
	}
}

/**
 * Convert WIF to hex format (for wallet-toolbox compatibility)
 */
export function wifToHex(wif: string): string {
	return PrivateKey.fromWif(wif).toString()
}

/**
 * Get address from WIF
 */
export function wifToAddress(wif: string): string {
	return PrivateKey.fromWif(wif).toAddress()
}

/**
 * Get public key from WIF
 */
export function wifToPubKey(wif: string): string {
	return PrivateKey.fromWif(wif).toPublicKey().toString()
}
