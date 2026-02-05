/**
 * AddressManager - Manages yours receive addresses using BRC-29 derivation format.
 *
 * Yours receive addresses are fixed, public addresses that users share publicly.
 * They are derived deterministically from the identity key using:
 * - derivationPrefix: "yours receive" (fixed)
 * - derivationSuffix: "0", "1", "2", ... (sequential counter)
 * - senderIdentityKey: our own identity public key (self-referential derivation)
 *
 * This allows:
 * 1. Deterministic regeneration on wallet restore
 * 2. Syncing external payments to these addresses
 * 3. Auto-signing via BRC-29/ScriptTemplateBRC29 (wallet knows the derivation info)
 *
 * Address derivation is done externally (in yours-wallet) and passed to this class.
 */

import { P2PKH, type WalletProtocol } from '@bsv/sdk'

/** Fixed prefix for yours receive addresses */
export const YOURS_PREFIX = 'yours'

/** BRC-29 protocol ID - used by wallet-toolbox for key derivation and signing */
export const BRC29_PROTOCOL_ID: WalletProtocol = [2, '3241645161d8']

/**
 * Derivation info for a yours receive address.
 * This is what's needed for internalizeAction's paymentRemittance.
 */
export interface AddressDerivation {
	/** The Bitcoin address (base58check) */
	address: string
	/** The key index (0, 1, 2, etc.) for internal lookups */
	index: number
	/** Base64-encoded derivation prefix (e.g., base64("yours receive")) */
	derivationPrefix: string
	/** Base64-encoded derivation suffix (e.g., base64("0"), base64("1"), etc.) */
	derivationSuffix: string
	/** Our own identity public key (self-referential) */
	senderIdentityKey: string
	/** The public key for this address */
	publicKey: string
}

/**
 * AddressManager manages yours receive addresses.
 * Accepts pre-derived addresses - derivation is done externally.
 */
export class AddressManager {
	private addressMap: Map<string, AddressDerivation> = new Map()
	private maxKeyIndex = -1

	/**
	 * @param derivations - Pre-derived address derivations
	 */
	constructor(derivations: AddressDerivation[]) {
		for (const derivation of derivations) {
			this.addressMap.set(derivation.address, derivation)
			if (derivation.index > this.maxKeyIndex) {
				this.maxKeyIndex = derivation.index
			}
		}
	}

	/**
	 * Add a new address derivation.
	 */
	addAddress(derivation: AddressDerivation): void {
		this.addressMap.set(derivation.address, derivation)
		if (derivation.index > this.maxKeyIndex) {
			this.maxKeyIndex = derivation.index
		}
	}

	/**
	 * Get the current max key index.
	 * This should be persisted to chrome.storage.
	 */
	getMaxKeyIndex(): number {
		return this.maxKeyIndex
	}

	/**
	 * Get all known addresses.
	 */
	getAddresses(): string[] {
		return Array.from(this.addressMap.keys())
	}

	/**
	 * Get derivation info for an address, or undefined if not ours.
	 */
	getDerivation(address: string): AddressDerivation | undefined {
		return this.addressMap.get(address)
	}

	/**
	 * Check if an address belongs to this wallet.
	 */
	isOurAddress(address: string): boolean {
		return this.addressMap.has(address)
	}

	/**
	 * Get the primary receive address (index 0).
	 */
	getPrimaryAddress(): string | undefined {
		for (const derivation of this.addressMap.values()) {
			if (derivation.index === 0) {
				return derivation.address
			}
		}
		return undefined
	}

	/**
	 * Get address at a specific index.
	 */
	getAddressAtIndex(index: number): AddressDerivation | undefined {
		for (const derivation of this.addressMap.values()) {
			if (derivation.index === index) {
				return derivation
			}
		}
		return undefined
	}

	/**
	 * Build the locking script for an address at a specific index.
	 * Useful for verifying outputs match expected scripts.
	 */
	getLockingScriptAtIndex(index: number): string | undefined {
		const derivation = this.getAddressAtIndex(index)
		if (!derivation) return undefined

		const p2pkh = new P2PKH()
		return p2pkh.lock(derivation.address).toHex()
	}
}
