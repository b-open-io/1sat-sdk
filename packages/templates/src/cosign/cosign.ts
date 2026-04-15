import { OP, type Script, Utils } from '@bsv/sdk'

/**
 * Cosign decoded data structure
 */
export interface CosignData {
	/** Owner's address (base58check encoded) */
	address: string
	/** Cosigner's compressed public key (hex encoded) */
	cosigner: string
}

/**
 * Cosign - Multi-signature template requiring owner + cosigner authorization
 *
 * The Cosign template creates outputs that require both the owner's signature
 * and a cosigner's signature to spend. The owner is identified by their public
 * key hash (address), while the cosigner is identified by their full public key.
 *
 * Script pattern:
 * OP_DUP OP_HASH160 <20-byte PKHash> OP_EQUALVERIFY OP_CHECKSIGVERIFY <33-byte pubkey> OP_CHECKSIG
 *
 * @example
 * ```typescript
 * const cosign = Cosign.decode(script)
 * if (cosign) {
 *   console.log(`Owner address: ${cosign.address}`)
 *   console.log(`Cosigner pubkey: ${cosign.cosigner}`)
 * }
 * ```
 */
export default class Cosign {
	/**
	 * Decodes a Cosign from a script
	 *
	 * @param script - The script to decode
	 * @param mainnet - Whether to use mainnet address prefix (default: true)
	 * @returns Decoded Cosign data or null if not found/invalid
	 */
	static decode(script: Script, mainnet = true): CosignData | null {
		try {
			const chunks = script.chunks
			for (let i = 0; i <= chunks.length - 7; i++) {
				if (
					chunks[i].op === OP.OP_DUP &&
					chunks[i + 1].op === OP.OP_HASH160 &&
					chunks[i + 2].data?.length === 20 &&
					chunks[i + 3].op === OP.OP_EQUALVERIFY &&
					chunks[i + 4].op === OP.OP_CHECKSIGVERIFY &&
					chunks[i + 5].data?.length === 33 &&
					chunks[i + 6].op === OP.OP_CHECKSIG
				) {
					const addressPrefix = mainnet ? [0x00] : [0x6f]
					const address = Utils.toBase58Check(
						chunks[i + 2].data as number[],
						addressPrefix,
					)
					const cosigner = Utils.toHex(chunks[i + 5].data as number[])
					return { address, cosigner }
				}
			}
			return null
		} catch {
			return null
		}
	}

	/**
	 * Checks if a script contains a Cosign pattern
	 *
	 * @param script - The script to check
	 * @returns true if the script contains Cosign pattern
	 */
	static isCosign(script: Script): boolean {
		return Cosign.decode(script) !== null
	}
}
