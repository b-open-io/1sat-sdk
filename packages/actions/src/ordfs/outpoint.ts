/** Display-hex txid → 32-byte internal (tx-input) order. */
export function txidToWire(hex: string): Uint8Array {
	if (!/^([0-9a-fA-F]{2})*$/.test(hex) || hex.length !== 64) {
		throw new Error(`invalid txid hex: ${hex}`)
	}
	const out = new Uint8Array(32)
	for (let i = 0; i < 32; i++) {
		out[31 - i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

/** 32-byte internal order → display-hex txid. */
export function txidFromWire(bytes: Uint8Array): string {
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
	const view = new DataView(out.buffer)
	view.setUint32(32, vout, true)
	return out
}

export function outpointFromWire(bytes: Uint8Array): {
	txid: string
	vout: number
} {
	if (bytes.length !== 36) throw new Error('outpoint wire length must be 36')
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return {
		txid: txidFromWire(bytes.subarray(0, 32)),
		vout: view.getUint32(32, true),
	}
}
