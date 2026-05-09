import { Hash, type Transaction, Utils } from '@bsv/sdk'

/**
 * Compute the BIP-143 `hashOutputs` (double-SHA256 of the serialized output
 * set) for a transaction. This is the value the module captures at
 * `createAction` onResponse and verifies against `createSignature` preimages.
 *
 * Serialization per output:
 *   - 8 bytes value (little-endian)
 *   - varint locking-script length
 *   - locking-script bytes
 */
export function computeHashOutputs(tx: Transaction): string {
	const buf: number[] = []
	for (const out of tx.outputs) {
		writeUint64LE(buf, BigInt(out.satoshis ?? 0))
		const scriptBytes = out.lockingScript.toBinary()
		writeVarint(buf, scriptBytes.length)
		for (const b of scriptBytes) buf.push(b)
	}
	return Utils.toHex(Hash.hash256(buf))
}

function writeUint64LE(buf: number[], value: bigint): void {
	let v = value
	for (let i = 0; i < 8; i++) {
		buf.push(Number(v & 0xffn))
		v >>= 8n
	}
}

function writeVarint(buf: number[], n: number): void {
	if (n < 0xfd) {
		buf.push(n)
		return
	}
	if (n <= 0xffff) {
		buf.push(0xfd, n & 0xff, (n >> 8) & 0xff)
		return
	}
	if (n <= 0xffffffff) {
		buf.push(
			0xfe,
			n & 0xff,
			(n >> 8) & 0xff,
			(n >> 16) & 0xff,
			(n >> 24) & 0xff,
		)
		return
	}
	// > 4 GB script length — implausible in practice.
	buf.push(0xff)
	let v = BigInt(n)
	for (let i = 0; i < 8; i++) {
		buf.push(Number(v & 0xffn))
		v >>= 8n
	}
}
