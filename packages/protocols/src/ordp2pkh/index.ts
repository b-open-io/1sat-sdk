/**
 * OrdP2PKH (1Sat Ordinal + Pay To Public Key Hash) for 1Sat Ordinals
 *
 * Extends P2PKH to include inscription envelope and MAP metadata
 */

import type { Inscription, MAP } from '@1sat/types'
import { toHex } from '@1sat/utils'
import { LockingScript, P2PKH, type Script, Utils } from '@bsv/sdk'
import { buildMapAsm } from '../map'

const { toArray, toHex: bsvToHex } = Utils

/**
 * Apply inscription envelope and optional MAP metadata to a locking script
 * @param lockingScript - Base locking script
 * @param inscription - Optional inscription data
 * @param metaData - Optional MAP metadata
 * @param withSeparator - Whether to include OP_CODESEPARATOR between inscription and script
 * @returns New script with inscription and metadata applied
 */
export function applyInscription(
	lockingScript: LockingScript,
	inscription?: Inscription,
	metaData?: MAP,
	withSeparator = false,
): Script {
	let ordAsm = ''

	// Build inscription envelope if provided
	if (
		inscription?.dataB64 !== undefined &&
		inscription?.contentType !== undefined
	) {
		const ordHex = toHex('ord')
		const fileBytes = toArray(inscription.dataB64, 'base64')
		const fileHex = bsvToHex(fileBytes).trim()

		if (!fileHex) {
			throw new Error('Invalid file data')
		}

		const contentTypeHex = toHex(inscription.contentType)
		if (!contentTypeHex) {
			throw new Error('Invalid content type')
		}

		ordAsm = `OP_0 OP_IF ${ordHex} OP_1 ${contentTypeHex} OP_0 ${fileHex} OP_ENDIF`
	}

	// Combine with base locking script
	let inscriptionAsm = ordAsm
		? `${ordAsm} ${withSeparator ? 'OP_CODESEPARATOR ' : ''}${lockingScript.toASM()}`
		: lockingScript.toASM()

	// Add MAP metadata if provided
	if (metaData) {
		if (!metaData.app || !metaData.type) {
			throw new Error('MAP.app and MAP.type are required fields')
		}

		const mapAsm = buildMapAsm(metaData)
		inscriptionAsm = `${inscriptionAsm} ${mapAsm}`
	}

	return LockingScript.fromASM(inscriptionAsm)
}

/**
 * OrdP2PKH class extending P2PKH with inscription support
 *
 * Provides methods to create ordinal outputs with inscriptions and metadata
 */
export class OrdP2PKH extends P2PKH {
	/**
	 * Creates a 1Sat Ordinal + P2PKH locking script for a given address
	 *
	 * @param address - Destination address for the ordinal
	 * @param inscription - Optional inscription with base64 data and content type
	 * @param metaData - Optional MAP metadata
	 * @returns Locking script with inscription envelope and P2PKH
	 */
	override lock(
		address: string,
		inscription?: Inscription,
		metaData?: MAP,
	): Script {
		const lockingScript = new P2PKH().lock(address)
		return applyInscription(lockingScript, inscription, metaData)
	}

	/**
	 * Creates a 1Sat Ordinal + P2PKH locking script with OP_CODESEPARATOR
	 * Used for reinscriptions that need signature separation
	 *
	 * @param address - Destination address for the ordinal
	 * @param inscription - Optional inscription with base64 data and content type
	 * @param metaData - Optional MAP metadata
	 * @returns Locking script with inscription envelope, OP_CODESEPARATOR, and P2PKH
	 */
	lockWithSeparator(
		address: string,
		inscription?: Inscription,
		metaData?: MAP,
	): Script {
		const lockingScript = new P2PKH().lock(address)
		return applyInscription(lockingScript, inscription, metaData, true)
	}
}

/**
 * Create an ordinal P2PKH locking script directly
 * Convenience function that doesn't require instantiating OrdP2PKH
 *
 * @param address - Destination address
 * @param inscription - Optional inscription data
 * @param metaData - Optional MAP metadata
 * @returns Locking script
 */
export function createOrdP2PKHScript(
	address: string,
	inscription?: Inscription,
	metaData?: MAP,
): Script {
	return new OrdP2PKH().lock(address, inscription, metaData)
}
