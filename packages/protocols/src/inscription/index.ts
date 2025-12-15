/**
 * Inscription envelope protocol for 1Sat Ordinals
 *
 * Builds inscription envelope scripts following the ordinals protocol format:
 * OP_FALSE OP_IF "ord" OP_1 <content-type> OP_0 <data> OP_ENDIF
 */

import type { Inscription } from '@1sat/types'
import { Script, Utils } from '@bsv/sdk'

const { toArray, toHex } = Utils

/** Convert UTF-8 string to hex */
const utf8ToHex = (str: string): string => toHex(toArray(str, 'utf8'))

/**
 * Build an inscription envelope script
 * @param inscription - Inscription data with base64-encoded content and content type
 * @returns Script containing the inscription envelope
 */
export function buildInscriptionEnvelope(inscription: Inscription): Script {
	const { dataB64, contentType } = inscription

	const ordHex = utf8ToHex('ord')
	const fileBytes = toArray(dataB64, 'base64')
	const fileHex = toHex(fileBytes).trim()

	if (!fileHex) {
		throw new Error('Invalid file data')
	}

	const contentTypeHex = utf8ToHex(contentType)
	if (!contentTypeHex) {
		throw new Error('Invalid content type')
	}

	return Script.fromASM(
		`OP_0 OP_IF ${ordHex} OP_1 ${contentTypeHex} OP_0 ${fileHex} OP_ENDIF`,
	)
}

/**
 * Build an inscription envelope ASM string (without the envelope being parsed into a Script)
 * Useful for combining with other script parts
 * @param inscription - Inscription data with base64-encoded content and content type
 * @returns ASM string for the inscription envelope
 */
export function buildInscriptionEnvelopeAsm(inscription: Inscription): string {
	const { dataB64, contentType } = inscription

	const ordHex = utf8ToHex('ord')
	const fileBytes = toArray(dataB64, 'base64')
	const fileHex = toHex(fileBytes).trim()

	if (!fileHex) {
		throw new Error('Invalid file data')
	}

	const contentTypeHex = utf8ToHex(contentType)
	if (!contentTypeHex) {
		throw new Error('Invalid content type')
	}

	return `OP_0 OP_IF ${ordHex} OP_1 ${contentTypeHex} OP_0 ${fileHex} OP_ENDIF`
}

/**
 * Check if a script contains an inscription envelope
 * @param script - Script to check
 * @returns True if the script contains an inscription envelope
 */
export function hasInscriptionEnvelope(script: Script): boolean {
	const asm = script.toASM()
	// Look for the ordinals envelope pattern
	const ordHex = utf8ToHex('ord')
	return asm.includes(`OP_0 OP_IF ${ordHex}`) && asm.includes('OP_ENDIF')
}

/**
 * Create inscription data from raw content
 * @param content - Raw content as Uint8Array or string
 * @param contentType - MIME type of the content
 * @returns Inscription object with base64-encoded data
 */
export function createInscription(
	content: Uint8Array | string,
	contentType: string,
): Inscription {
	let dataB64: string
	if (typeof content === 'string') {
		// Convert string to base64 via bytes
		const bytes = toArray(content, 'utf8')
		dataB64 = Utils.toBase64(bytes)
	} else {
		dataB64 = Utils.toBase64(Array.from(content))
	}

	return {
		dataB64,
		contentType,
	}
}

/**
 * Create a JSON inscription (common for BSV20/21 tokens)
 * @param data - JSON-serializable data
 * @param contentType - Content type (defaults to application/bsv-20)
 * @returns Inscription object
 */
export function createJsonInscription(
	data: Record<string, unknown>,
	contentType = 'application/bsv-20',
): Inscription {
	const jsonStr = JSON.stringify(data)
	const bytes = toArray(jsonStr, 'utf8')
	return {
		dataB64: Utils.toBase64(bytes),
		contentType,
	}
}
