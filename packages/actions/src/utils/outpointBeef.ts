import { Beef } from '@bsv/sdk'

/**
 * BRC-158 Outpoint BEEF envelope.
 *
 * ```
 * 16a7beef || txid (32 bytes, LE on wire) || vout (uint32 LE) || BEEF
 * ```
 *
 * TXID byte order mirrors Atomic BEEF: display hex is the reverse of the
 * wire bytes.
 */

export const OUTPOINT_BEEF_PREFIX = [0x16, 0xa7, 0xbe, 0xef] as const

export interface ParsedOutpointBeef {
	/** Subject txid, display hex (lowercase). */
	txid: string
	/** Subject output index. */
	vout: number
	/** Subject outpoint, BRC-100 dot form. */
	outpoint: string
	/** Inner bundle. */
	beef: Beef
}

function toHexLower(bytes: ArrayLike<number>): string {
	let s = ''
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i] ?? 0
		s += (b < 16 ? '0' : '') + b.toString(16)
	}
	return s.toLowerCase()
}

export function parseOutpointBeef(
	input: Uint8Array | number[],
): ParsedOutpointBeef {
	const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input)
	if (bytes.length < 40) throw new Error('outpoint-beef-too-short')
	for (let i = 0; i < 4; i++) {
		if (bytes[i] !== OUTPOINT_BEEF_PREFIX[i]) {
			throw new Error('outpoint-beef-bad-prefix')
		}
	}
	const txidWire = bytes.subarray(4, 36)
	const txid = toHexLower(Array.from(txidWire).reverse())
	if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('outpoint-beef-bad-txid')
	const vout =
		(bytes[36] ?? 0) |
		((bytes[37] ?? 0) << 8) |
		((bytes[38] ?? 0) << 16) |
		((bytes[39] ?? 0) << 24)
	if (!Number.isInteger(vout) || vout < 0) {
		throw new Error('outpoint-beef-bad-vout')
	}
	const beef = Beef.fromBinary(Array.from(bytes.subarray(40)))
	return { txid, vout, outpoint: `${txid}.${vout}`, beef }
}
