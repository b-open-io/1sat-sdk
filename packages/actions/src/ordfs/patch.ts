import { VcdiffError, vcdiffDecode, vcdiffEncode } from './vcdiff.js'

/** Content type written on `ordfs/patch` inscription outputs. */
export const PATCH_CONTENT_TYPE = 'ordfs/patch'

/** Current patch envelope version. */
export const PATCH_VERSION = 0

export class PatchFormatError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'PatchFormatError'
	}
}

/** Native Bitcoin outpoint (txid bytes as hex + little-endian vout). */
export interface PatchOutpoint {
	txid: string
	vout: number
}

export interface PatchRecord {
	version: number
	base: PatchOutpoint
	delta: Uint8Array
}

const toHex = (b: Uint8Array): string =>
	Array.from(b)
		.map((x) => x.toString(16).padStart(2, '0'))
		.join('')

const hexToBytes = (hex: string): Uint8Array => {
	if (!/^([0-9a-fA-F]{2})*$/.test(hex) || hex.length !== 64) {
		throw new PatchFormatError(`invalid txid hex: ${hex}`)
	}
	const out = new Uint8Array(32)
	for (let i = 0; i < 32; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

/**
 * Encode an `ordfs/patch` envelope:
 * `[1B version][36B base outpoint][vcdiff delta]`.
 */
export function patchEncode(record: PatchRecord): Uint8Array {
	if (record.version !== PATCH_VERSION) {
		throw new PatchFormatError(`unsupported patch version ${record.version}`)
	}
	if (
		!Number.isInteger(record.base.vout) ||
		record.base.vout < 0 ||
		record.base.vout > 0xffffffff
	) {
		throw new PatchFormatError(`outpoint vout ${record.base.vout} out of range`)
	}
	if (record.delta.length < 5) {
		throw new PatchFormatError('empty vcdiff delta is invalid')
	}
	const out = new Uint8Array(1 + 36 + record.delta.length)
	const view = new DataView(out.buffer)
	out[0] = record.version
	out.set(hexToBytes(record.base.txid), 1)
	view.setUint32(33, record.base.vout, true)
	out.set(record.delta, 37)
	return out
}

export function patchDecode(bytes: Uint8Array): PatchRecord {
	if (bytes.length < 1 + 36 + 5) {
		throw new PatchFormatError('patch too short')
	}
	if (bytes[0] !== PATCH_VERSION) {
		throw new PatchFormatError(`unsupported patch version ${bytes[0]}`)
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const txid = toHex(bytes.subarray(1, 33))
	const vout = view.getUint32(33, true)
	const delta = bytes.subarray(37)
	if (delta.length < 5) {
		throw new PatchFormatError('empty vcdiff delta is invalid')
	}
	return {
		version: PATCH_VERSION,
		base: { txid, vout },
		delta,
	}
}

/**
 * Build a patch from source/target bytes. Identical content must be a
 * direct citation (manifest entry), never an empty/no-op patch.
 */
export async function patchFromContent(opts: {
	base: PatchOutpoint
	source: Uint8Array
	target: Uint8Array
}): Promise<Uint8Array> {
	if (bytesEqual(opts.source, opts.target)) {
		throw new PatchFormatError(
			'identical content must be a direct citation, never a patch',
		)
	}
	const delta = await vcdiffEncode(opts.target, opts.source)
	return patchEncode({
		version: PATCH_VERSION,
		base: opts.base,
		delta,
	})
}

export async function patchApply(
	record: PatchRecord,
	source: Uint8Array,
): Promise<Uint8Array> {
	try {
		return await vcdiffDecode(record.delta, source)
	} catch (e) {
		if (e instanceof VcdiffError) {
			throw new PatchFormatError(e.message)
		}
		throw e
	}
}
