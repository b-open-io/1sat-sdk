/**
 * AddressManager - Manages BRC-29 receive addresses.
 *
 * Accepts pre-derived addresses and provides lookup/management.
 * Derivation is done externally (via deriveDepositAddresses action or equivalent).
 */

import { type AddressDerivation, BRC29_PROTOCOL_ID } from '@1sat/types'
import { P2PKH } from '@bsv/sdk'

// Re-export from @1sat/types for backwards compatibility
export { BRC29_PROTOCOL_ID, type AddressDerivation }

/**
 * AddressManager manages BRC-29 receive addresses.
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
