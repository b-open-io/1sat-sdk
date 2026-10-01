import { encode as cborEncode } from 'cbor2'
import { sortLengthFirstDeterministic } from 'cbor2/sorts'

/** A DAG-CBOR link (tag 42): the CID bytes, without the leading 0x00 multibase prefix */
export class DagCborLink {
	constructor(public readonly cid: Uint8Array) {}
}

/** A value decoded from strict DAG-CBOR */
export type DagCborValue =
	| number
	| bigint
	| string
	| boolean
	| null
	| Uint8Array
	| DagCborLink
	| DagCborValue[]
	| { [key: string]: DagCborValue }

const MAX_DEPTH = 64
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Encode a map of text keys to DAG-CBOR. Keys are sorted length-first then
 * bytewise (the DAG-CBOR order); integers and lengths are minimal; all lengths
 * are definite. Values are limited to what the 1Color display fields need:
 * text, unsigned integers and byte strings.
 */
export function encodeDagCborMap(
	map: Record<string, string | number | bigint | Uint8Array>,
): Uint8Array {
	for (const [key, value] of Object.entries(map)) {
		if (
			typeof value === 'number' &&
			(!Number.isSafeInteger(value) || value < 0)
		) {
			throw new Error(`${key}: only unsigned integers are supported`)
		}
		if (typeof value === 'bigint' && value < 0n) {
			throw new Error(`${key}: only unsigned integers are supported`)
		}
	}
	return cborEncode(map, { sortKeys: sortLengthFirstDeterministic })
}

/**
 * Strictly decode a complete DAG-CBOR document. Returns `undefined` (not
 * `null`, which is a valid value) when the bytes are not valid DAG-CBOR.
 *
 * Enforced: definite lengths only; minimal integer and length encodings;
 * map keys are text, unique, in length-first-then-bytewise order; strings are
 * valid UTF-8; the only tag is 42 (a byte string starting 0x00); the only
 * simple values are false, true, null and 64-bit floats that are finite
 * (DAG-CBOR forbids undefined, NaN and the infinities, and requires floats to
 * be encoded as 64-bit); no trailing bytes.
 */
export function decodeDagCbor(
	bytes: Uint8Array | number[],
): DagCborValue | undefined {
	const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
	const reader = { buf, pos: 0 }
	try {
		const value = readItem(reader, 0)
		if (reader.pos !== buf.length) return undefined
		return value
	} catch {
		return undefined
	}
}

interface Reader {
	buf: Uint8Array
	pos: number
}

function need(r: Reader, n: number): void {
	if (n > r.buf.length - r.pos) throw new Error('truncated')
}

/** Read the argument of a head with additional info `ai`, rejecting non-minimal forms */
function readArg(r: Reader, ai: number): bigint {
	if (ai < 24) return BigInt(ai)
	let len: number
	let min: bigint
	switch (ai) {
		case 24:
			len = 1
			min = 24n
			break
		case 25:
			len = 2
			min = 0x100n
			break
		case 26:
			len = 4
			min = 0x10000n
			break
		case 27:
			len = 8
			min = 0x100000000n
			break
		default:
			throw new Error('indefinite or reserved length')
	}
	need(r, len)
	let v = 0n
	for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(r.buf[r.pos + i])
	r.pos += len
	if (v < min) throw new Error('non-minimal')
	return v
}

function readLength(r: Reader, ai: number): number {
	const v = readArg(r, ai)
	if (v > BigInt(r.buf.length - r.pos)) throw new Error('length too large')
	return Number(v)
}

function toNumber(v: bigint): number | bigint {
	return v <= BigInt(Number.MAX_SAFE_INTEGER) &&
		v >= BigInt(Number.MIN_SAFE_INTEGER)
		? Number(v)
		: v
}

function compareKeys(a: Uint8Array, b: Uint8Array): number {
	if (a.length !== b.length) return a.length - b.length
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return a[i] - b[i]
	}
	return 0
}

function readItem(r: Reader, depth: number): DagCborValue {
	if (depth > MAX_DEPTH) throw new Error('too deep')
	need(r, 1)
	const head = r.buf[r.pos++]
	const major = head >> 5
	const ai = head & 0x1f
	switch (major) {
		case 0:
			return toNumber(readArg(r, ai))
		case 1:
			return toNumber(-1n - readArg(r, ai))
		case 2: {
			const len = readLength(r, ai)
			const out = r.buf.slice(r.pos, r.pos + len)
			r.pos += len
			return out
		}
		case 3: {
			const len = readLength(r, ai)
			const out = utf8.decode(r.buf.subarray(r.pos, r.pos + len))
			r.pos += len
			return out
		}
		case 4: {
			const len = readLength(r, ai)
			const out: DagCborValue[] = []
			for (let i = 0; i < len; i++) out.push(readItem(r, depth + 1))
			return out
		}
		case 5: {
			const len = readLength(r, ai)
			const entries: [string, DagCborValue][] = []
			let prev: Uint8Array | undefined
			for (let i = 0; i < len; i++) {
				need(r, 1)
				if (r.buf[r.pos] >> 5 !== 3) throw new Error('non-text key')
				const start = r.pos
				const key = readItem(r, depth + 1) as string
				const keyBytes = r.buf.subarray(start, r.pos)
				if (prev && compareKeys(prev, keyBytes) >= 0) {
					throw new Error('keys out of order or duplicated')
				}
				prev = keyBytes
				entries.push([key, readItem(r, depth + 1)])
			}
			return Object.fromEntries(entries)
		}
		case 6: {
			if (readArg(r, ai) !== 42n) throw new Error('tag other than 42')
			const cid = readItem(r, depth + 1)
			if (!(cid instanceof Uint8Array) || cid.length < 2 || cid[0] !== 0) {
				throw new Error('malformed CID')
			}
			return new DagCborLink(cid.slice(1))
		}
		default: {
			if (ai === 20) return false
			if (ai === 21) return true
			if (ai === 22) return null
			if (ai !== 27) throw new Error('simple value not allowed')
			need(r, 8)
			const view = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 8)
			const f = view.getFloat64(0, false)
			r.pos += 8
			if (!Number.isFinite(f)) throw new Error('NaN or Infinity')
			return f
		}
	}
}
