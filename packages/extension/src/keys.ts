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

import { PrivateKey } from '@bsv/sdk'
import { type OneSatBackup, decryptBackup, encryptBackup } from 'bitcoin-backup'
import browser from 'webextension-polyfill'

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
