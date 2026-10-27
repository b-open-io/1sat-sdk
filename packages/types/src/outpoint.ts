/**
 * Parse an outpoint string into its components.
 * Accepts both period (txid.vout) and underscore (txid_vout) delimiters.
 */
export function parseOutpoint(outpoint: string): {
	txid: string
	vout: number
} {
	if (outpoint.length < 66) {
		throw new Error(`Invalid outpoint format: ${outpoint}`)
	}
	const txid = outpoint.substring(0, 64)
	const separator = outpoint[64]
	if (separator !== '.' && separator !== '_') {
		throw new Error(
			`Invalid outpoint separator: expected '.' or '_', got '${separator}'`,
		)
	}
	const vout = Number.parseInt(outpoint.substring(65), 10)
	if (Number.isNaN(vout)) {
		throw new Error(`Invalid vout in outpoint: ${outpoint}`)
	}
	return { txid, vout }
}

/**
 * Validate that a string is a valid outpoint format.
 * Accepts both period (txid.vout) and underscore (txid_vout) delimiters.
 */
export function isValidOutpoint(outpoint: string): boolean {
	if (outpoint.length < 66) return false
	const separator = outpoint[64]
	if (separator !== '.' && separator !== '_') return false
	return (
		/^[0-9a-fA-F]{64}$/.test(outpoint.substring(0, 64)) &&
		/^\d+$/.test(outpoint.substring(65))
	)
}

/** Format txid and vout into an outpoint string (period-delimited, BRC-100 wire) */
export function formatOutpoint(txid: string, vout: number): string {
	return `${txid}.${vout}`
}

/** Re-format an outpoint string in either delimiter as lowercase `txid.vout`. */
export function normalizeOutpoint(outpoint: string): string {
	const { txid, vout } = parseOutpoint(outpoint.trim())
	return formatOutpoint(txid.toLowerCase(), vout)
}

/**
 * Ordinals / indexer id form: `txid_vout`.
 * Accepts dotted (BRC-100) or underscore input. Used for origin tags, CI
 * origin, BSV21 tokenId-style ids, and OrdFS keys.
 */
export function formatOrdinalOutpoint(outpoint: string): string {
	const s = outpoint.trim()
	if (s.length >= 66) {
		const sep = s[64]
		if (sep === '.' || sep === '_') {
			return `${s.slice(0, 64)}_${s.slice(65)}`
		}
	}
	const dot = s.indexOf('.')
	if (dot === 64) return `${s.slice(0, 64)}_${s.slice(65)}`
	return s.replace('.', '_')
}

/** Display-hex txid → 32-byte internal (tx-input) order. */
export function txidToWire(hex: string): Uint8Array {
	if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
		throw new Error(`invalid txid hex: ${hex}`)
	}
	const out = new Uint8Array(32)
	for (let i = 0; i < 32; i++) {
		out[31 - i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

/** 32-byte internal order → display-hex txid. */
export function txidFromWire(bytes: Uint8Array | number[]): string {
	if (bytes.length !== 32) throw new Error('txid wire length must be 32')
	let hex = ''
	for (let i = 31; i >= 0; i--) {
		hex += bytes[i].toString(16).padStart(2, '0')
	}
	return hex
}

/** 36-byte outpoint: reversed txid + little-endian vout. */
export function outpointToWire(txid: string, vout: number): Uint8Array {
	if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
		throw new Error(`outpoint vout ${vout} out of range`)
	}
	const out = new Uint8Array(36)
	out.set(txidToWire(txid), 0)
	new DataView(out.buffer).setUint32(32, vout, true)
	return out
}

export function outpointFromWire(bytes: Uint8Array | number[]): {
	txid: string
	vout: number
} {
	if (bytes.length !== 36) throw new Error('outpoint wire length must be 36')
	const b = Uint8Array.from(bytes)
	return {
		txid: txidFromWire(b.subarray(0, 32)),
		vout: new DataView(b.buffer).getUint32(32, true),
	}
}
