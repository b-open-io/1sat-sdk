import { Utils } from '@bsv/sdk'

/**
 * Parsed pieces of a BIP-143 sighash preimage that the module cares about.
 */
export interface ParsedPreimage {
	/** `txid.vout` of the input being signed. */
	outpoint: string
	/** 32-byte hashOutputs (hex). */
	hashOutputs: string
}

/**
 * Minimum size for a BIP-143 preimage:
 *   4 (version) + 32 (hashPrevouts) + 32 (hashSequence)
 * + 36 (outpoint) + 1 (varint scriptCodeLen, min) + 0 (empty scriptCode allowed)
 * + 8 (value) + 4 (nSequence) + 32 (hashOutputs) + 4 (nLockTime) + 4 (nHashType)
 * = 157 bytes.
 *
 * Anything shorter cannot be a BIP-143 preimage; treat as standalone signing.
 */
export const MIN_BIP143_PREIMAGE_BYTES = 157

/**
 * Parse a BIP-143 preimage and extract the input outpoint and hashOutputs.
 *
 * Returns null if the buffer is shorter than {@link MIN_BIP143_PREIMAGE_BYTES}
 * or if varint decoding runs off the end. The caller treats null as
 * "not a BIP-143 preimage; prompt the user."
 */
export function parsePreimage(data: number[] | Uint8Array): ParsedPreimage | null {
	const buf = data instanceof Uint8Array ? Array.from(data) : data
	if (buf.length < MIN_BIP143_PREIMAGE_BYTES) return null

	// Outpoint at offset 68: 32-byte txid (LE) + 4-byte vout (LE).
	const txidBytes = buf.slice(68, 100).reverse()
	const txid = Utils.toHex(txidBytes)
	const vout =
		buf[100] | (buf[101] << 8) | (buf[102] << 16) | (buf[103] << 24)

	// Varint scriptCode length at offset 104.
	const varint = readVarint(buf, 104)
	if (!varint) return null
	const scriptCodeStart = 104 + varint.size
	const scriptCodeEnd = scriptCodeStart + varint.value
	if (scriptCodeEnd > buf.length) return null

	// After scriptCode: 8 bytes value, 4 bytes nSequence, 32 bytes hashOutputs.
	const hashOutputsStart = scriptCodeEnd + 8 + 4
	const hashOutputsEnd = hashOutputsStart + 32
	if (hashOutputsEnd > buf.length) return null

	const hashOutputs = Utils.toHex(buf.slice(hashOutputsStart, hashOutputsEnd))
	return {
		outpoint: `${txid}.${vout >>> 0}`,
		hashOutputs,
	}
}

interface ReadVarint {
	value: number
	size: number
}

function readVarint(buf: number[], offset: number): ReadVarint | null {
	if (offset >= buf.length) return null
	const first = buf[offset]
	if (first < 0xfd) return { value: first, size: 1 }
	if (first === 0xfd) {
		if (offset + 2 >= buf.length) return null
		return {
			value: buf[offset + 1] | (buf[offset + 2] << 8),
			size: 3,
		}
	}
	if (first === 0xfe) {
		if (offset + 4 >= buf.length) return null
		return {
			value:
				(buf[offset + 1] |
					(buf[offset + 2] << 8) |
					(buf[offset + 3] << 16) |
					(buf[offset + 4] << 24)) >>>
				0,
			size: 5,
		}
	}
	// 0xff — 8-byte varint. JS numbers safely represent up to 2^53. ScriptCode
	// lengths in the wild won't approach that; reject if it would.
	if (offset + 8 >= buf.length) return null
	let value = 0
	for (let i = 0; i < 8; i++) {
		const byte = buf[offset + 1 + i]
		if (i >= 6 && byte !== 0) return null
		value += byte * 2 ** (8 * i)
	}
	return { value, size: 9 }
}
