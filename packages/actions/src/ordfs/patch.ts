/**
 * `ordfs/patch` — the Gib record envelope.
 *
 * A patch record names its base content by outpoint and carries a
 * VCDIFF delta that transforms the base into the new content:
 *
 *   [1B version][36B base outpoint][vcdiff delta]
 *
 * The base outpoint is native Bitcoin outpoint bytes: 32B txid in
 * internal (little-endian) order — same as on the wire in a tx
 * input — followed by a 4B little-endian vout.
 *
 * Rules (see gib-format spec):
 *   - version must be 1
 *   - an empty/zero-window delta is NOT a "link"; content identical to
 *     its base is represented by the directory citing the existing
 *     outpoint directly, never by an empty patch
 *   - the delta's source is the full base content bytes, which the
 *     resolver fetches by the base outpoint; source bytes are never
 *     embedded here
 */

import { Utils } from '@bsv/sdk'
import { formatOutpoint, parseOutpoint } from '@1sat/utils'
import { vcdiffDecode, vcdiffEncode } from './vcdiff'

export const PATCH_VERSION = 1
const BASE_BYTES = 36

export class PatchFormatError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'PatchFormatError'
	}
}

export interface PatchRecord {
	/** Base content outpoint, string form txid.vout (BRC-100 wire). */
	baseOutpoint: string
	/** VCDIFF delta transforming base content into the new content. */
	delta: Uint8Array
}

/** 32B txid (internal order) + 4B LE vout — native Bitcoin outpoint. */
export function outpointToBytes(txid: string, vout: number): Uint8Array {
	if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
		throw new PatchFormatError(`bad txid: ${txid}`)
	}
	if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
		throw new PatchFormatError(`bad vout: ${vout}`)
	}
	const out = new Uint8Array(BASE_BYTES)
	out.set(Utils.toArray(txid, 'hex'), 0)
	out[32] = vout & 0xff
	out[33] = (vout >>> 8) & 0xff
	out[34] = (vout >>> 16) & 0xff
	out[35] = (vout >>> 24) & 0xff
	return out
}

export function outpointFromBytes(
	bytes: Uint8Array,
	offset = 0,
): { txid: string; vout: number } {
	if (bytes.length - offset < BASE_BYTES) {
		throw new PatchFormatError('truncated outpoint')
	}
	const txid = Utils.toHex(bytes.subarray(offset, offset + 32))
	const vout =
		(bytes[offset + 32] |
			(bytes[offset + 33] << 8) |
			(bytes[offset + 34] << 16) |
			(bytes[offset + 35] * 0x1000000)) >>> 0
	return { txid, vout }
}

/**
 * Build an `ordfs/patch` record from base content bytes and the new
 * content bytes. The base bytes must be exactly the content resolved
 * from `baseOutpoint`; a mismatched base produces a patch that
 * resolves to garbage at read time, so callers must resolve-then-diff.
 */
export async function patchEncode(
	newContent: Uint8Array,
	baseContent: Uint8Array,
	baseOutpoint: string,
): Promise<Uint8Array> {
	const { txid, vout } = parseOutpoint(baseOutpoint)
	const delta = await vcdiffEncode(newContent, baseContent)
	if (delta.length === 0) {
		// Defensive: identical content must not be encoded as a patch.
		throw new PatchFormatError(
			'empty delta: identical content must cite the base outpoint directly',
		)
	}
	const base = outpointToBytes(txid, vout)
	const out = new Uint8Array(1 + BASE_BYTES + delta.length)
	out[0] = PATCH_VERSION
	out.set(base, 1)
	out.set(delta, 1 + BASE_BYTES)
	return out
}

/** Split a record into its base outpoint and vcdiff delta. */
export function patchDecode(record: Uint8Array): PatchRecord {
	if (record.length < 1 + BASE_BYTES + 4) {
		throw new PatchFormatError('record too short')
	}
	if (record[0] !== PATCH_VERSION) {
		throw new PatchFormatError(`unsupported patch version ${record[0]}`)
	}
	const { txid, vout } = outpointFromBytes(record, 1)
	const delta = record.subarray(1 + BASE_BYTES)
	if (delta[0] !== 0xd6 || delta[1] !== 0xc3 || delta[2] !== 0xc4) {
		throw new PatchFormatError('body is not a VCDIFF delta')
	}
	return { baseOutpoint: formatOutpoint(txid, vout), delta }
}

/**
 * Apply a record against the base content bytes resolved from its
 * base outpoint, returning the new content.
 */
export async function patchApply(
	record: Uint8Array,
	baseContent: Uint8Array,
): Promise<Uint8Array> {
	const { delta } = patchDecode(record)
	return vcdiffDecode(delta, baseContent)
}
