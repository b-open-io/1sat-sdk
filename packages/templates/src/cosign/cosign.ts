import {
	LockingScript,
	OP,
	type Script,
	UnlockingScript,
	Utils,
} from '@bsv/sdk'

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
 * Unlock pattern (top of stack last):
 * <approver-sig+hashtype> <owner-sig+hashtype> <owner-pubkey>
 *
 * @example
 * ```typescript
 * // Decode a Cosign from a script
 * const cosign = Cosign.decode(script)
 * if (cosign) {
 *   console.log(`Owner address: ${cosign.address}`)
 *   console.log(`Cosigner pubkey: ${cosign.cosigner}`)
 * }
 *
 * // Build a cosign locking script
 * const lock = Cosign.lock(ownerAddress, cosignerPubKeyHex)
 *
 * // Build the owner half of the unlock (sig + pubkey)
 * const ownerUnlock = Cosign.ownerUnlock(ownerSigDER, sigHashFlag, ownerPubKeyHex)
 *
 * // Prepend the approver sig to produce the full unlock
 * const fullUnlock = Cosign.approverUnlock(approverSigDER, sigHashFlag, ownerUnlock)
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

	/**
	 * Builds a Cosign locking script.
	 *
	 * @param ownerAddress - Owner's base58check address (mainnet or testnet)
	 * @param cosignerPubKey - Cosigner's compressed public key (hex)
	 * @returns Locking script: OP_DUP OP_HASH160 <pkhash> OP_EQUALVERIFY OP_CHECKSIGVERIFY <cosignerPubKey> OP_CHECKSIG
	 * @throws if the address does not decode to a 20-byte pkhash, or the pubkey is not 33 bytes
	 */
	static lock(ownerAddress: string, cosignerPubKey: string): LockingScript {
		const decoded = Utils.fromBase58Check(ownerAddress)
		const pkhash = decoded.data as number[]
		if (pkhash.length !== 20) {
			throw new Error(
				`Cosign.lock: invalid owner address (expected 20-byte pkhash, got ${pkhash.length})`,
			)
		}
		const cosignerPubKeyBytes = Utils.toArray(cosignerPubKey, 'hex')
		if (cosignerPubKeyBytes.length !== 33) {
			throw new Error(
				`Cosign.lock: invalid cosigner pubkey (expected 33-byte compressed, got ${cosignerPubKeyBytes.length})`,
			)
		}
		return new LockingScript()
			.writeOpCode(OP.OP_DUP)
			.writeOpCode(OP.OP_HASH160)
			.writeBin(pkhash)
			.writeOpCode(OP.OP_EQUALVERIFY)
			.writeOpCode(OP.OP_CHECKSIGVERIFY)
			.writeBin(cosignerPubKeyBytes)
			.writeOpCode(OP.OP_CHECKSIG)
	}

	/**
	 * Builds the owner half of a cosign unlocking script: <ownerSig+hashtype> <ownerPubKey>.
	 *
	 * The caller computes the input sighash externally (e.g. via wallet.createSignature against
	 * the cosign locking script as the subscript) and provides the DER-encoded signature here.
	 *
	 * The result is the unlock that the cosigner will subsequently prepend its signature onto
	 * via {@link approverUnlock}.
	 *
	 * @param ownerSigDER - DER-encoded ECDSA signature
	 * @param sigHashFlag - sighash type byte to append to the signature (e.g. SIGHASH_ALL | SIGHASH_FORKID)
	 * @param ownerPubKey - Owner's compressed public key (hex)
	 */
	static ownerUnlock(
		ownerSigDER: number[],
		sigHashFlag: number,
		ownerPubKey: string,
	): UnlockingScript {
		const ownerPubKeyBytes = Utils.toArray(ownerPubKey, 'hex')
		if (ownerPubKeyBytes.length !== 33) {
			throw new Error(
				`Cosign.ownerUnlock: invalid owner pubkey (expected 33-byte compressed, got ${ownerPubKeyBytes.length})`,
			)
		}
		const sigWithHashType = [...ownerSigDER, sigHashFlag & 0xff]
		return new UnlockingScript()
			.writeBin(sigWithHashType)
			.writeBin(ownerPubKeyBytes)
	}

	/**
	 * Builds the full cosign unlocking script by prepending the approver's signature
	 * to an existing owner-side unlock.
	 *
	 * Result chunks (top of stack last):
	 *   <approverSig+hashtype> <ownerSig+hashtype> <ownerPubKey>
	 *
	 * @param approverSigDER - DER-encoded ECDSA signature from the cosigner
	 * @param sigHashFlag - sighash type byte to append to the approver signature
	 * @param ownerUnlock - Owner-side unlock as produced by {@link ownerUnlock}
	 */
	static approverUnlock(
		approverSigDER: number[],
		sigHashFlag: number,
		ownerUnlock: Script | UnlockingScript,
	): UnlockingScript {
		const sigWithHashType = [...approverSigDER, sigHashFlag & 0xff]
		const out = new UnlockingScript().writeBin(sigWithHashType)
		for (const chunk of ownerUnlock.chunks) {
			if (chunk.data) {
				out.writeBin(Array.from(chunk.data))
			} else if (typeof chunk.op === 'number') {
				out.writeOpCode(chunk.op)
			}
		}
		return out
	}
}
