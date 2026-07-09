import { Utils } from '@bsv/sdk'
import { decode as cborDecode, encode as cborEncode } from 'cbor2'
import { sortCoreDeterministic } from 'cbor2/sorts'

/** Inscription content type for shrug token display metadata */
export const SHRUG_METADATA_CONTENT_TYPE = 'application/shrug+cbor'

/**
 * Display metadata carried by an inscription on a token's deploy output.
 * All fields are optional.
 */
export interface ShrugMetadata {
	/** Token symbol. Uniqueness is not enforced */
	sym?: string
	/** Icon outpoint as `txid_vout` */
	icon?: string
	/** Decimal precision 0-18, default 0 */
	dec?: number
}

/** Convert a `txid_vout` outpoint string to its 36-byte wire encoding */
export function outpointToBytes(outpoint: string): number[] | null {
	if (outpoint.charAt(64) !== '_') return null
	const txid = outpoint.slice(0, 64)
	if (!/^[0-9a-fA-F]{64}$/.test(txid)) return null
	const vout = Number(outpoint.slice(65))
	if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
		return null
	}
	const bytes = Utils.toArray(txid, 'hex').reverse()
	bytes.push(
		vout & 0xff,
		(vout >>> 8) & 0xff,
		(vout >>> 16) & 0xff,
		(vout >>> 24) & 0xff,
	)
	return bytes
}

/** Convert a 36-byte wire outpoint to its `txid_vout` string form */
export function outpointFromBytes(bytes: number[]): string | null {
	if (bytes.length !== 36) return null
	const txid = Utils.toHex(bytes.slice(0, 32).reverse())
	const vout =
		(bytes[32] | (bytes[33] << 8) | (bytes[34] << 16) | (bytes[35] << 24)) >>> 0
	return `${txid}_${vout}`
}

/**
 * Encode shrug metadata as a deterministic CBOR map (RFC 8949 §4.2).
 * The icon is encoded as a 36-byte byte string.
 */
export function encodeShrugMetadata(meta: ShrugMetadata): number[] {
	const wire: Record<string, unknown> = {}
	if (meta.sym !== undefined) {
		wire.sym = meta.sym
	}
	if (meta.dec !== undefined) {
		if (!Number.isInteger(meta.dec) || meta.dec < 0 || meta.dec > 18) {
			throw new Error(`dec ${meta.dec} out of range 0-18`)
		}
		wire.dec = meta.dec
	}
	if (meta.icon !== undefined) {
		const bytes = outpointToBytes(meta.icon)
		if (!bytes) {
			throw new Error(`invalid icon outpoint: ${meta.icon}`)
		}
		wire.icon = new Uint8Array(bytes)
	}
	return Array.from(cborEncode(wire, { sortKeys: sortCoreDeterministic }))
}

/**
 * Decode a shrug metadata document. Unknown map keys are ignored.
 * Returns null when the document is not a valid metadata map.
 */
export function decodeShrugMetadata(
	content: number[] | Uint8Array,
): ShrugMetadata | null {
	let value: unknown
	try {
		value = cborDecode(
			content instanceof Uint8Array ? content : new Uint8Array(content),
		)
	} catch {
		return null
	}

	let get: (key: string) => unknown
	if (value instanceof Map) {
		get = (key) => value.get(key)
	} else if (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value)
	) {
		get = (key) => (value as Record<string, unknown>)[key]
	} else {
		return null
	}

	const meta: ShrugMetadata = {}

	const sym = get('sym')
	if (sym !== undefined) {
		if (typeof sym !== 'string') return null
		meta.sym = sym
	}

	const dec = get('dec')
	if (dec !== undefined) {
		const num = typeof dec === 'bigint' ? Number(dec) : dec
		if (
			typeof num !== 'number' ||
			!Number.isInteger(num) ||
			num < 0 ||
			num > 18
		) {
			return null
		}
		meta.dec = num
	}

	const icon = get('icon')
	if (icon !== undefined) {
		if (!(icon instanceof Uint8Array)) return null
		const outpoint = outpointFromBytes(Array.from(icon))
		if (!outpoint) return null
		meta.icon = outpoint
	}

	return meta
}
