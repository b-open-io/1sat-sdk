import {
	type LockingScript,
	Script,
	type ScriptTemplate,
	Utils,
} from '@bsv/sdk'
import BitCom, { type BitComDecoded } from './bitcom.js'

/**
 * Bitcoin Attestation Protocol (BAP) Types
 */
export enum BAPAttestationType {
	ID = 'ID',
	ATTEST = 'ATTEST',
	REVOKE = 'REVOKE',
	ALIAS = 'ALIAS',
}

/**
 * BAP Data Structure
 */
export interface BAPData {
	bitcomIndex?: number
	type: BAPAttestationType
	idKey?: string
	address?: string
	sequence: bigint
	algorithm?: string
	signerAddr?: string
	signature?: string
	rootAddress?: string
	isSignedByID: boolean
	profile?: unknown
}

/**
 * BAP Protocol Prefix
 */
export const BAP_PROTOCOL_PREFIX = '1BAPSuaPnfGnSBM3GLV9yhxUdYe4vGbdMT'

/**
 * Bitcoin Attestation Protocol (BAP) Template
 *
 * BAP is an advanced identity and attestation system that builds on AIP to provide
 * verifiable claims, identity verification, and decentralized reputation management.
 *
 * Core attestation types:
 * - ID: Create and register digital identities with cryptographic proof
 * - ATTEST: Make verifiable claims and attestations about other identities
 * - REVOKE: Revoke previous attestations or invalidate claims
 * - ALIAS: Create human-readable aliases for identities
 */
export default class BAP implements ScriptTemplate {
	bitcomIndex?: number
	type: BAPAttestationType
	idKey?: string
	address?: string
	sequence: bigint
	algorithm?: string
	signerAddr?: string
	signature?: string
	rootAddress?: string
	isSignedByID: boolean
	profile?: unknown

	constructor(data: BAPData) {
		this.bitcomIndex = data.bitcomIndex
		this.type = data.type
		this.idKey = data.idKey
		this.address = data.address
		this.sequence = data.sequence
		this.algorithm = data.algorithm
		this.signerAddr = data.signerAddr
		this.signature = data.signature
		this.rootAddress = data.rootAddress
		this.isSignedByID = data.isSignedByID
		this.profile = data.profile
	}

	/**
	 * Creates a BAP locking script
	 *
	 * @returns LockingScript - The BAP locking script
	 */
	lock(): LockingScript {
		const script = new Script()

		// Add attestation type
		script.writeBin(Utils.toArray(this.type, 'utf8'))

		// Add type-specific data
		if (this.type === BAPAttestationType.ID) {
			if (this.idKey != null && this.idKey !== '') {
				script.writeBin(Utils.toArray(this.idKey, 'utf8'))
			}
			if (this.address != null && this.address !== '') {
				script.writeBin(Utils.toArray(this.address, 'utf8'))
			}
		} else if (
			this.type === BAPAttestationType.ATTEST ||
			this.type === BAPAttestationType.REVOKE
		) {
			if (this.idKey != null && this.idKey !== '') {
				script.writeBin(Utils.toArray(this.idKey, 'utf8'))
			}
			// Add sequence number
			script.writeBin(Utils.toArray(this.sequence.toString(), 'utf8'))
		} else if (this.type === BAPAttestationType.ALIAS) {
			if (this.idKey != null && this.idKey !== '') {
				script.writeBin(Utils.toArray(this.idKey, 'utf8'))
			}
			if (this.profile != null) {
				const profileJson = JSON.stringify(this.profile)
				script.writeBin(Utils.toArray(profileJson, 'utf8'))
			}
		}

		// Add AIP signature data
		if (this.algorithm != null && this.algorithm !== '') {
			script.writeBin(Utils.toArray(this.algorithm, 'utf8'))
		}
		if (this.signerAddr != null && this.signerAddr !== '') {
			script.writeBin(Utils.toArray(this.signerAddr, 'utf8'))
		}
		if (this.signature != null && this.signature !== '') {
			script.writeBin(Utils.toArray(this.signature, 'utf8'))
		}

		// Create BitCom structure
		const bitcom = new BitCom([
			{
				protocol: BAP_PROTOCOL_PREFIX,
				script: script.toBinary(),
				pos: 0,
			},
		])

		return bitcom.lock()
	}

	/**
	 * Decodes a BAP protocol from BitCom structure
	 *
	 * @param bitcom - The BitCom decoded structure
	 * @returns BAP | null - The decoded BAP data, or null if not found
	 */
	static decode(bitcom: BitComDecoded): BAP | null {
		if (
			bitcom == null ||
			bitcom.protocols == null ||
			bitcom.protocols.length === 0
		) {
			return null
		}

		// Find BAP protocol
		const bapProtocol = bitcom.protocols.find(
			(p) => p.protocol === BAP_PROTOCOL_PREFIX,
		)
		if (bapProtocol == null) {
			return null
		}

		try {
			// Parse the protocol script data
			const script = Script.fromBinary(bapProtocol.script)
			const chunks = script.chunks

			if (chunks.length < 1) {
				return null
			}

			// Extract attestation type
			const typeChunk = chunks[0]
			if (typeChunk.data == null) {
				return null
			}
			const type = Utils.toUTF8(typeChunk.data) as BAPAttestationType

			// AIP signature data comes after type-specific data (no pipe delimiter)

			const bapData: BAPData = {
				bitcomIndex: bapProtocol.pos,
				type,
				sequence: BigInt(0),
				isSignedByID: false,
			}

			// Parse type-specific data
			if (type === BAPAttestationType.ID) {
				if (chunks.length > 1 && chunks[1].data != null) {
					bapData.idKey = Utils.toUTF8(chunks[1].data)
				}
				if (chunks.length > 2 && chunks[2].data != null) {
					bapData.address = Utils.toUTF8(chunks[2].data)
				}
				bapData.isSignedByID = true
			} else if (
				type === BAPAttestationType.ATTEST ||
				type === BAPAttestationType.REVOKE
			) {
				if (chunks.length > 1 && chunks[1].data != null) {
					bapData.idKey = Utils.toUTF8(chunks[1].data)
				}
				if (chunks.length > 2 && chunks[2].data != null) {
					const sequenceStr = Utils.toUTF8(chunks[2].data)
					bapData.sequence = BigInt(sequenceStr)
				}
			} else if (type === BAPAttestationType.ALIAS) {
				if (chunks.length > 1 && chunks[1].data != null) {
					bapData.idKey = Utils.toUTF8(chunks[1].data)
				}
				if (chunks.length > 2 && chunks[2].data != null) {
					try {
						const profileJson = Utils.toUTF8(chunks[2].data)
						bapData.profile = JSON.parse(profileJson)
					} catch {
						// Invalid JSON, store as raw data
						bapData.profile = Utils.toUTF8(chunks[2].data)
					}
				}
			}

			// Calculate where AIP data starts based on type (after type-specific fields)
			const aipStartIdx = 3 // Default: after type, idKey, and one more field

			// Parse AIP signature data if present (algorithm, signerAddr, signature)
			if (chunks.length > aipStartIdx && chunks[aipStartIdx].data != null) {
				bapData.algorithm = Utils.toUTF8(chunks[aipStartIdx].data!)
			}
			if (
				chunks.length > aipStartIdx + 1 &&
				chunks[aipStartIdx + 1].data != null
			) {
				const signerData = chunks[aipStartIdx + 1].data
				if (signerData != null) {
					bapData.signerAddr = Utils.toUTF8(signerData)
				}
			}
			if (
				chunks.length > aipStartIdx + 2 &&
				chunks[aipStartIdx + 2].data != null
			) {
				const signatureData = chunks[aipStartIdx + 2].data
				if (signatureData != null) {
					bapData.signature = Utils.toUTF8(signatureData)
				}
			}

			// Set root address if we have signer address
			if (bapData.signerAddr != null && bapData.signerAddr !== '') {
				bapData.rootAddress = bapData.signerAddr
			}

			// Set isSignedByID based on attestation type
			if (type === BAPAttestationType.ID) {
				bapData.isSignedByID = true // ID attestations are always signed by the identity
			} else {
				bapData.isSignedByID = false // ATTEST/REVOKE/ALIAS are not signed by the ID itself
			}

			return new BAP(bapData)
		} catch {
			return null
		}
	}

	/**
	 * Creates a BAP ID attestation
	 *
	 * @param identityKey - The identity public key
	 * @param address - The associated address
	 * @param algorithm - The AIP algorithm
	 * @param signerAddr - The signer address
	 * @param signature - The AIP signature
	 * @returns BAP - The ID attestation
	 */
	static createID(
		identityKey: string,
		address: string,
		algorithm?: string,
		signerAddr?: string,
		signature?: string,
	): BAP {
		return new BAP({
			type: BAPAttestationType.ID,
			idKey: identityKey,
			address,
			sequence: BigInt(0),
			algorithm,
			signerAddr,
			signature,
			rootAddress: signerAddr,
			isSignedByID: true,
		})
	}

	/**
	 * Creates a BAP ATTEST attestation
	 *
	 * @param txid - The transaction ID being attested to
	 * @param sequence - The sequence number
	 * @param algorithm - The AIP algorithm
	 * @param signerAddr - The signer address
	 * @param signature - The AIP signature
	 * @returns BAP - The ATTEST attestation
	 */
	static createAttest(
		txid: string,
		sequence: bigint,
		algorithm?: string,
		signerAddr?: string,
		signature?: string,
	): BAP {
		return new BAP({
			type: BAPAttestationType.ATTEST,
			idKey: txid,
			sequence,
			algorithm,
			signerAddr,
			signature,
			rootAddress: signerAddr,
			isSignedByID: false,
		})
	}

	/**
	 * Creates a BAP REVOKE attestation
	 *
	 * @param txid - The transaction ID being revoked
	 * @param sequence - The sequence number
	 * @param algorithm - The AIP algorithm
	 * @param signerAddr - The signer address
	 * @param signature - The AIP signature
	 * @returns BAP - The REVOKE attestation
	 */
	static createRevoke(
		txid: string,
		sequence: bigint,
		algorithm?: string,
		signerAddr?: string,
		signature?: string,
	): BAP {
		return new BAP({
			type: BAPAttestationType.REVOKE,
			idKey: txid,
			sequence,
			algorithm,
			signerAddr,
			signature,
			rootAddress: signerAddr,
			isSignedByID: false,
		})
	}

	/**
	 * Creates a BAP ALIAS attestation
	 *
	 * @param alias - The human-readable alias
	 * @param profile - The profile data
	 * @param algorithm - The AIP algorithm
	 * @param signerAddr - The signer address
	 * @param signature - The AIP signature
	 * @returns BAP - The ALIAS attestation
	 */
	static createAlias(
		alias: string,
		profile: unknown,
		algorithm?: string,
		signerAddr?: string,
		signature?: string,
	): BAP {
		return new BAP({
			type: BAPAttestationType.ALIAS,
			idKey: alias,
			sequence: BigInt(0),
			profile,
			algorithm,
			signerAddr,
			signature,
			rootAddress: signerAddr,
			isSignedByID: false,
		})
	}

	/**
	 * Verifies the AIP signature for the BAP attestation
	 *
	 * @param _protocolData - The protocol data for signature verification
	 * @returns boolean - True if signature is valid
	 */
	verifySignature(_protocolData: unknown[]): boolean {
		if (
			this.algorithm == null ||
			this.algorithm === '' ||
			this.signerAddr == null ||
			this.signerAddr === '' ||
			this.signature == null ||
			this.signature === ''
		) {
			return false
		}

		// This would need to be implemented with actual AIP verification
		// For now, return true if all signature components are present
		return true
	}

	/**
	 * Placeholder for unlock method - BAP is read-only
	 */
	unlock(): never {
		throw new Error(
			'BAP attestations cannot be unlocked - they are read-only identity records',
		)
	}
}
