/**
 * Key derivation utilities for BSV wallets
 *
 * @example
 * ```typescript
 * import { getKeysFromMnemonicAndPaths, YOURS_WALLET_PATH, YOURS_ORD_PATH } from '@1sat/utils'
 *
 * const keys = getKeysFromMnemonicAndPaths(mnemonic, {
 *   changeAddressPath: YOURS_WALLET_PATH,
 *   ordAddressPath: YOURS_ORD_PATH,
 * })
 * ```
 */

import { BigNumber, HD, Hash, Mnemonic, PrivateKey } from '@bsv/sdk'

// ============================================================================
// Types
// ============================================================================

/**
 * Wallet keys in WIF format
 * This is the standard format used by 1sat-web and compatible wallets
 */
export interface WalletKeys {
	/** Payment private key (WIF) */
	payPk: string
	/** Ordinal private key (WIF) */
	ordPk: string
	/** Original mnemonic (optional, for backup) */
	mnemonic?: string
	/** Derivation path for payment key */
	changeAddressPath?: number | string
	/** Derivation path for ordinal key */
	ordAddressPath?: number | string
	/** Identity private key (WIF, optional) */
	identityPk?: string
	/** Derivation path for identity key */
	identityAddressPath?: number | string
}

/**
 * Configuration for key derivation paths
 */
export interface KeyDerivationPaths {
	/** Path for payment/change address (e.g., "m/44'/236'/0'/1/0") */
	changeAddressPath: string
	/** Path for ordinal address (e.g., "m/44'/236'/1'/0/0") */
	ordAddressPath: string
	/** Path for identity address (optional) */
	identityAddressPath?: string
}

// ============================================================================
// Standard Derivation Paths
// ============================================================================

/** Yours Wallet payment derivation path */
export const YOURS_WALLET_PATH = "m/44'/236'/0'/1/0"

/** Yours Wallet identity derivation path */
export const YOURS_ID_PATH = "m/0'/236'/0'/0/0"

/** Yours Wallet ordinal derivation path */
export const YOURS_ORD_PATH = "m/44'/236'/1'/0/0"

/** RelayX ordinal derivation path */
export const RELAYX_ORD_PATH = "m/44'/236'/0'/2/0"

/** RelayX identity path (same as Yours) */
export const RELAYX_ID_PATH = YOURS_ID_PATH

/** RelayX payment path (same as Yours) */
export const RELAYX_WALLET_PATH = YOURS_WALLET_PATH

/** RelayX sweep path */
export const RELAYX_SWEEP_PATH = "m/44'/236'/0'/0/0"

/** Twetch payment derivation path */
export const TWETCH_WALLET_PATH = 'm/0/0'

/** Twetch ordinal path (same as Yours) */
export const TWETCH_ORD_PATH = YOURS_ORD_PATH

/** AYM payment derivation path */
export const AYM_WALLET_PATH = 'm/0/0'

/** AYM ordinal derivation path (master key) */
export const AYM_ORD_PATH = 'm'

// ============================================================================
// Key Conversion Utilities
// ============================================================================

/**
 * Convert a WIF (Wallet Import Format) private key to hex format
 * Useful for wallet-toolbox which uses rootKeyHex format
 */
export function wifToHex(wif: string): string {
	return PrivateKey.fromWif(wif).toString()
}

/**
 * Get the public address from a WIF private key
 */
export function wifToAddress(wif: string): string {
	return PrivateKey.fromWif(wif).toAddress()
}

/**
 * Get the public key (hex) from a WIF private key
 */
export function wifToPublicKey(wif: string): string {
	return PrivateKey.fromWif(wif).toPublicKey().toString()
}

// ============================================================================
// Key Derivation Functions
// ============================================================================

/**
 * Derive a single private key from a mnemonic and path
 *
 * @param mnemonic - BIP39 mnemonic phrase
 * @param path - Derivation path (e.g., "m/44'/236'/0'/0/0")
 * @returns PrivateKey object
 */
export function deriveKeyFromMnemonic(
	mnemonic: string,
	path: string,
): PrivateKey {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const masterNode = HD.fromSeed(seed)
	const derived = masterNode.derive(path)
	return derived.privKey
}

/**
 * Derive wallet keys from a mnemonic using specified paths
 * Returns keys in WIF format for compatibility with 1sat-web
 *
 * @param mnemonic - BIP39 mnemonic phrase
 * @param paths - Derivation paths for each key type
 * @returns WalletKeys with WIF-encoded private keys
 */
export function getKeysFromMnemonicAndPaths(
	mnemonic: string,
	paths: KeyDerivationPaths,
): WalletKeys {
	const seed = Mnemonic.fromString(mnemonic).toSeed()
	const masterNode = HD.fromSeed(seed)

	// Normalize payment path
	const changeAddressPath = paths.changeAddressPath.startsWith('m/')
		? paths.changeAddressPath
		: `m/${paths.changeAddressPath}`
	const payPrivKey = masterNode.derive(changeAddressPath)
	const payPk = payPrivKey.privKey.toWif()

	// Normalize ordinal path
	const ordAddressPath = paths.ordAddressPath.startsWith('m/')
		? paths.ordAddressPath
		: `m/${paths.ordAddressPath}`
	const ordPrivKey =
		paths.ordAddressPath === 'm'
			? masterNode
			: masterNode.derive(ordAddressPath)
	const ordPk = ordPrivKey.privKey.toWif()

	// Optional identity key
	let identityPk: string | undefined
	if (paths.identityAddressPath) {
		const identityPath = paths.identityAddressPath.startsWith('m/')
			? paths.identityAddressPath
			: `m/${paths.identityAddressPath}`
		const identityPrivKey = masterNode.derive(identityPath)
		identityPk = identityPrivKey.privKey.toWif()
	}

	const keys: WalletKeys = {
		mnemonic,
		payPk,
		ordPk,
		changeAddressPath: paths.changeAddressPath,
		ordAddressPath: paths.ordAddressPath,
	}

	if (identityPk) {
		keys.identityPk = identityPk
		keys.identityAddressPath = paths.identityAddressPath
	}

	return keys
}

/**
 * Find wallet keys from a mnemonic, searching for a "1s" vanity ordinal address
 * This searches child keys until finding an ordinal address starting with "1s"
 *
 * @param mnemonic - BIP39 mnemonic phrase
 * @param timeoutMs - Maximum time to search (default: 100000ms)
 * @returns Promise resolving to WalletKeys with the found vanity address
 */
export function findKeysWithVanityOrdinal(
	mnemonic: string,
	timeoutMs = 100000,
): Promise<WalletKeys> {
	return new Promise((resolve, reject) => {
		const seed = Mnemonic.fromString(mnemonic).toSeed()
		const masterNode = HD.fromSeed(seed)

		// Payment key is always at m/0
		const payPrivKey = masterNode.derive('m/0')
		const payPk = payPrivKey.privKey.toWif()

		const startTime = Date.now()
		let found = false

		const searchForAddress = (i: number) => {
			if (Date.now() - startTime > timeoutMs && !found) {
				reject(
					new Error('Timeout while searching for the desired address prefix.'),
				)
				return
			}

			const ordPrivKey = masterNode.derive(`m/${i}`)
			const ordAddress = ordPrivKey.privKey.toAddress()

			if (ordAddress?.startsWith('1s')) {
				found = true
				const ordPk = ordPrivKey.privKey.toWif()

				resolve({
					mnemonic,
					payPk,
					ordPk,
					changeAddressPath: 0,
					ordAddressPath: i,
				})
				return
			}

			// Continue searching on next tick
			setTimeout(() => searchForAddress(i + 1), 0)
		}

		// Start searching from child key 1
		searchForAddress(1)
	})
}

/**
 * Generate a new BIP39 mnemonic phrase
 *
 * @param strength - Bits of entropy (128 = 12 words, 256 = 24 words)
 * @returns Mnemonic phrase string
 */
export function generateMnemonic(strength: 128 | 256 = 128): string {
	return Mnemonic.fromRandom(strength).toString()
}

/**
 * Validate a BIP39 mnemonic phrase
 *
 * @param mnemonic - Mnemonic phrase to validate
 * @returns true if valid, false otherwise
 */
export function isValidMnemonic(mnemonic: string): boolean {
	try {
		Mnemonic.fromString(mnemonic)
		return true
	} catch {
		return false
	}
}

// ============================================================================
// Identity Key Derivation
// ============================================================================

/** secp256k1 curve order */
const SECP256K1_ORDER = new BigNumber(
	'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
	16,
)

/**
 * Derive an identity key from payment and ordinal private keys.
 * Uses SHA-256 of concatenated raw key bytes.
 * Compatible with yours-wallet identity derivation.
 */
export function deriveIdentityKey(payWif: string, ordWif: string): PrivateKey {
	const payKey = PrivateKey.fromWif(payWif)
	const ordKey = PrivateKey.fromWif(ordWif)
	const privBuf = payKey.toArray().concat(ordKey.toArray())
	let identityPrivKey: PrivateKey | undefined
	while (!identityPrivKey) {
		const bn = new BigNumber(Hash.sha256(privBuf))
		if (bn.lt(SECP256K1_ORDER)) {
			identityPrivKey = PrivateKey.fromString(bn.toHex(), 'hex')
		}
	}
	return identityPrivKey
}
