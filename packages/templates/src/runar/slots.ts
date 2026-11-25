/**
 * Generic Rúnar artifact helpers: fill constructor slots into a compiled
 * template, and read them back out of a deployed script.
 *
 * A Rúnar artifact is a script template with an OP_0 placeholder at each
 * `constructorSlots[i].byteOffset`. Deploying replaces every placeholder with
 * a minimal push of the corresponding constructor argument. Decoding is the
 * exact inverse: walk template and deployed script in lockstep, and at each
 * slot read one push from the deployed script. Nothing here is specific to a
 * particular contract.
 */

import type { RunarConstructorSlot } from '@1sat/types'

export type ConstructorSlot = RunarConstructorSlot

/** Minimal push encoding of `data` (OP_0 for empty, direct push, PUSHDATA1/2/4). */
export function encodePush(data: number[]): number[] {
	const n = data.length
	if (n === 0) return [0x00]
	if (n <= 0x4b) return [n, ...data]
	if (n <= 0xff) return [0x4c, n, ...data]
	if (n <= 0xffff) return [0x4d, n & 0xff, n >>> 8, ...data]
	return [
		0x4e,
		n & 0xff,
		(n >>> 8) & 0xff,
		(n >>> 16) & 0xff,
		(n >>> 24) & 0xff,
		...data,
	]
}

/**
 * Reads one push operation at `off`. Returns the pushed data and the total
 * bytes consumed, or null if the byte at `off` is not a push (or truncated).
 */
export function readPush(
	b: number[],
	off: number,
): { data: number[]; size: number } | null {
	const op = b[off]
	if (op === undefined) return null
	let n: number
	let hdr: number
	if (op === 0x00) {
		return { data: [], size: 1 }
	}
	if (op >= 0x01 && op <= 0x4b) {
		n = op
		hdr = 1
	} else if (op === 0x4c) {
		n = b[off + 1]
		hdr = 2
	} else if (op === 0x4d) {
		n = b[off + 1] | (b[off + 2] << 8)
		hdr = 3
	} else if (op === 0x4e) {
		n =
			(b[off + 1] | (b[off + 2] << 8) | (b[off + 3] << 16)) +
			b[off + 4] * 2 ** 24
		hdr = 5
	} else {
		return null
	}
	if (Number.isNaN(n) || off + hdr + n > b.length) return null
	return { data: b.slice(off + hdr, off + hdr + n), size: hdr + n }
}

/**
 * Fills the template's constructor slots with `args[slot.paramIndex]`.
 * Throws if a slot does not sit on an OP_0 placeholder.
 */
export function fillSlots(
	template: number[],
	slots: ReadonlyArray<ConstructorSlot>,
	args: ReadonlyArray<number[]>,
): number[] {
	const ordered = [...slots].sort((a, b) => a.byteOffset - b.byteOffset)
	const out: number[] = []
	let ti = 0
	for (const slot of ordered) {
		if (template[slot.byteOffset] !== 0x00) {
			throw new Error(
				`runar: slot at byte ${slot.byteOffset} is not an OP_0 placeholder`,
			)
		}
		const arg = args[slot.paramIndex]
		if (!arg) {
			throw new Error(`runar: missing constructor arg ${slot.paramIndex}`)
		}
		for (; ti < slot.byteOffset; ti++) out.push(template[ti])
		out.push(...encodePush(arg))
		ti++ // skip placeholder
	}
	for (; ti < template.length; ti++) out.push(template[ti])
	return out
}

/**
 * Inverse of {@link fillSlots}. Walks `deployed` from `offset` against the
 * template; every non-slot byte must match, and at each slot exactly one push
 * is read. Returns the args indexed by paramIndex plus the number of deployed
 * bytes consumed (so callers can tolerate trailing data such as OP_RETURN
 * metadata), or null if the script does not match the template.
 */
export function readSlots(
	template: number[],
	slots: ReadonlyArray<ConstructorSlot>,
	deployed: number[],
	offset = 0,
): { args: number[][]; end: number } | null {
	const ordered = [...slots].sort((a, b) => a.byteOffset - b.byteOffset)
	const args: number[][] = []
	let ti = 0
	let di = offset
	let si = 0
	while (ti < template.length) {
		const slot = ordered[si]
		if (slot && ti === slot.byteOffset) {
			const push = readPush(deployed, di)
			if (!push) return null
			args[slot.paramIndex] = push.data
			ti++
			di += push.size
			si++
			continue
		}
		if (deployed[di] !== template[ti]) return null
		ti++
		di++
	}
	return { args, end: di }
}
