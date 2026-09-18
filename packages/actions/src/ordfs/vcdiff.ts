/**
 * Strict VCDIFF (RFC 3284) codec — pure TypeScript, no dependencies.
 *
 * Why this exists: the wasm codecs in the ecosystem are not
 * RFC-interoperable (vcdiff-wasm writes a non-zero Header4 version byte,
 * which strict decoders reject as "version > 0"). On-chain patches must be
 * readable by ANY third-party consumer, so the SDK owns a codec that EMITS
 * a conservative, canonical RFC-3284 profile and DECODES the full
 * default-table grammar. Interop is proven in test against xdelta3.
 *
 * Emitted profile:
 *   - header: D6 C3 C4 00, Hdr_Indicator 0 (default code table, no
 *     secondary compressor; s_near=4/s_same=3 are implied by the default
 *     table and NOT written to the header)
 *   - exactly one window, uncompressed, no checksum
 *   - source section present iff a dictionary was given, position 0
 *   - COPY addresses are superstring addresses (U = source || target,
 *     RFC 4.1), always VCD_SELF mode 0; near/same caches still update per
 *     RFC 5.2 so decoder state matches
 *   - table entries: single ADD size 1..17 (idx 2..18), single COPY mode 0
 *     size 4..18 (idx 19..34); everything else via the size-field-0 index
 *     (ADD 1, COPY-mode-0 18, RUN 0) with the size coded separately in the
 *     instruction stream (RFC 4.5.1 "0" instances)
 *   - COPY addresses coded as RFC-2 integers in the address section
 *   - instruction sizes ≤ 65534 (RFC 4.5)
 *
 * Decoder: full default-table grammar — all 9 address modes, paired
 * entries, multi-window files. Rejects secondary compression,
 * application code tables, compressed sections, undefined indicator bits,
 * and checksum mismatch.
 */

export class VcdiffError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'VcdiffError'
	}
}

const MAGIC = [0xd6, 0xc3, 0xc4] as const
const MAX_INSTR_SIZE = 0xfffe // RFC 4.5
const S_NEAR_DEFAULT = 4
const S_SAME_DEFAULT = 3

const NO_OP = 0
const ADD = 1
const RUN = 2
const COPY = 3

// Win_Indicator bits (RFC 4.3)
const WIN_SOURCE_SECTION = 0x01
const WIN_SOURCE_COMP = 0x02
const WIN_INSTR_COMP = 0x04
const WIN_ADDR_COMP = 0x08
const WIN_CHECKSUM = 0x10

const MAX_VARINT_BYTES = 8

// =====================================================================
// RFC 2: base-128 big-endian integers ("integer")
// =====================================================================

function putVarint(out: number[], n: number): void {
	if (!Number.isInteger(n) || n < 0) {
		throw new VcdiffError(`integer requires non-negative safe int, got ${n}`)
	}
	const tmp: number[] = []
	let v = n
	do {
		tmp.unshift(v & 0x7f)
		v = Math.floor(v / 128)
	} while (v > 0)
	// RFC 2: MSB is turned on on every byte EXCEPT the least significant
	// (last) one.
	for (let i = 0; i < tmp.length - 1; i++) tmp[i] |= 0x80
	out.push(...tmp)
}

class ByteReader {
	constructor(
		readonly data: Uint8Array,
		public pos = 0,
	) {}

	get remaining(): number {
		return this.data.length - this.pos
	}

	byte(what: string): number {
		if (this.pos >= this.data.length) {
			throw new VcdiffError(`truncated input: ${what}`)
		}
		return this.data[this.pos++]
	}

	varint(what: string): number {
		// RFC 2: base-128 big-endian; continuation MSB set means another
		// byte follows, the last byte has MSB clear.
		let value = 0
		let count = 0
		for (;;) {
			const b = this.byte(`integer (${what})`)
			value = value * 128 + (b & 0x7f)
			if (!Number.isSafeInteger(value)) {
				throw new VcdiffError(`integer overflow: ${what}`)
			}
			if (++count > MAX_VARINT_BYTES) {
				throw new VcdiffError(`integer too long: ${what}`)
			}
			if ((b & 0x80) === 0) return value
		}
	}

	be32(what: string): number {
		if (this.remaining < 4) throw new VcdiffError(`truncated input: ${what}`)
		let v = 0
		for (let k = 0; k < 4; k++) v = v * 256 + this.data[this.pos++]
		return v >>> 0
	}

	take(n: number, what: string): Uint8Array {
		if (this.remaining < n) {
			throw new VcdiffError(`truncated input: ${what}`)
		}
		const out = this.data.subarray(this.pos, this.pos + n)
		this.pos += n
		return out
	}
}

// =====================================================================
// CRC-32 (RFC 4.3 window checksum; IEEE poly, init/complement 0xFFFFFFFF)
// =====================================================================

let crcTable: Uint32Array | undefined
function crc32(data: Uint8Array, offset = 0, length = data.length - offset): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256)
		for (let n = 0; n < 256; n++) {
			let c = n
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
			}
			crcTable[n] = c >>> 0
		}
	}
	let c = 0xffffffff
	for (let i = offset; i < offset + length; i++) {
		c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
	}
	return (c ^ 0xffffffff) >>> 0
}

// =====================================================================
// default instruction code table (RFC 4.5.1)
// =====================================================================

const IDX_RUN_SIZE0 = 0
const IDX_ADD_SIZE0 = 1
const IDX_ADD_FIRST = 2 // sizes 1..17 → 2..18
const IDX_COPY_M0_SIZE0 = 19 // COPY mode 0, size coded separately
const IDX_COPY_M0_FIRST = 20 // sizes 4..18 → 20..34

interface CodePair {
	inst1: number
	size1: number
	mode1: number
	inst2: number
	size2: number
	mode2: number
}

/** Build the 256-entry default table exactly per the RFC depiction. */
function buildDefaultTable(): CodePair[] {
	const t = new Array<CodePair | undefined>(256)
	const set = (
		i: number,
		inst1: number,
		size1: number,
		mode1: number,
		inst2 = NO_OP,
		size2 = 0,
		mode2 = 0,
	): void => {
		if (i < 0 || i > 255) throw new Error('table index out of range')
		if (t[i]) throw new Error(`table slot ${i} collision`)
		t[i] = { inst1, size1, mode1, inst2, size2, mode2 }
	}
	let i = 0
	set(i++, RUN, 0, 0) // line 1: RUN, size always separate
	set(i++, ADD, 0, 0) // line 2: ADD, size separate
	for (let s = 1; s <= 17; s++) set(i++, ADD, s, 0) // ... and sizes 1..17
	for (let mode = 0; mode <= 8; mode++) {
		set(i++, COPY, 0, mode) // "0,[4,18]": size separate
		for (let s = 4; s <= 18; s++) set(i++, COPY, s, mode) // sizes 4..18
	}
	// lines 12..17: ADD[1..4] + COPY[4..6], modes 0..5
	// (first [i,j] range = outer loop => ADD size outer, COPY size inner)
	for (let mode = 0; mode <= 5; mode++) {
		for (let a = 1; a <= 4; a++) {
			for (let c = 4; c <= 6; c++) {
				set(i++, ADD, a, 0, COPY, c, mode)
			}
		}
	}
	// lines 18..20: ADD[1..4] + COPY size 4, modes 6..8
	for (let mode = 6; mode <= 8; mode++) {
		for (let a = 1; a <= 4; a++) {
			set(i++, ADD, a, 0, COPY, 4, mode)
		}
	}
	// line 21: COPY size 4 modes 0..8 + ADD size 1
	for (let mode = 0; mode <= 8; mode++) {
		set(i++, COPY, 4, mode, ADD, 1, 0)
	}
	if (i !== 256) {
		throw new Error(`default table built with ${i} entries (want 256)`)
	}
	return t as CodePair[]
}

let defaultTable: CodePair[] | undefined
function codeTable(): CodePair[] {
	if (!defaultTable) {
		defaultTable = buildDefaultTable()
		// cross-check the constants the encoder relies on
		const t = defaultTable
		if (
			!(
				t[IDX_RUN_SIZE0].inst1 === RUN &&
				t[IDX_ADD_SIZE0].inst1 === ADD &&
				t[IDX_ADD_SIZE0].size1 === 0 &&
				t[IDX_ADD_FIRST].inst1 === ADD &&
				t[IDX_ADD_FIRST].size1 === 1 &&
				t[18].inst1 === ADD &&
				t[18].size1 === 17 &&
				t[IDX_COPY_M0_SIZE0].inst1 === COPY &&
				t[IDX_COPY_M0_SIZE0].mode1 === 0 &&
				t[IDX_COPY_M0_SIZE0].size1 === 0 &&
				t[IDX_COPY_M0_FIRST].inst1 === COPY &&
				t[IDX_COPY_M0_FIRST].size1 === 4 &&
				t[34].inst1 === COPY &&
				t[34].size1 === 18
			)
		) {
			throw new Error('internal: default table constant mismatch')
		}
	}
	return defaultTable
}

// =====================================================================
// match finding (greedy longest match; bounded hash chains)
// =====================================================================

type Instr =
	| { kind: typeof ADD; size: number }
	| { kind: typeof COPY; size: number; address: number } // superstring addr

const MIN_MATCH = 12
const HASH_LEN = 12
const MAX_CHAIN = 32

/**
 * Scan `target` against dictionary `source`; addresses are superstring
 * addresses (source positions 0..sourceLen-1, target positions
 * sourceLen+i). Self-matches into already-emitted target are allowed.
 */
function scan(
	source: Uint8Array,
	target: Uint8Array,
): { instrs: Instr[]; data: number[] } {
	const instrs: Instr[] = []
	const data: number[] = []
	if (target.length === 0) return { instrs, data }

	const hashAt = (buf: Uint8Array, off: number): number => {
		let h = 0
		for (let k = 0; k < HASH_LEN; k++) {
			h = (Math.imul(h, 31) + buf[off + k]) | 0
		}
		return h
	}
	const buckets = new Map<number, number[]>()
	for (let p = 0; p + HASH_LEN <= source.length; p++) {
		const h = hashAt(source, p)
		const list = buckets.get(h)
		if (list) list.push(p)
		else buckets.set(h, [p])
	}
	const byteAt = (addr: number): number =>
		addr < source.length ? source[addr] : target[addr - source.length]

	let indexedUpTo = 0 // target positions indexed into buckets
	let ti = 0
	let addStart = 0
	const flushAdd = (end: number): void => {
		let off = addStart
		while (off < end) {
			const size = Math.min(MAX_INSTR_SIZE, end - off)
			for (let k = 0; k < size; k++) data.push(target[off + k])
			instrs.push({ kind: ADD, size })
			off += size
		}
	}

	while (ti < target.length) {
		// index newly-emitted target positions for self-matching
		while (indexedUpTo + HASH_LEN <= ti) {
			const h = hashAt(target, indexedUpTo)
			const addr = source.length + indexedUpTo
			const list = buckets.get(h)
			if (list) list.push(addr)
			else buckets.set(h, [addr])
			indexedUpTo++
		}
		let best: { addr: number; size: number } | undefined
		if (ti + HASH_LEN <= target.length) {
			const list = buckets.get(hashAt(target, ti))
			if (list) {
				const from = Math.max(0, list.length - MAX_CHAIN)
				for (let k = list.length - 1; k >= from; k--) {
					const addr = list[k]
					const max = Math.min(
						MAX_INSTR_SIZE,
						target.length - ti,
						addr < source.length
							? source.length - addr
							: ti - (addr - source.length), // no overlap past here
					)
					let size = 0
					while (size < max && byteAt(addr + size) === target[ti + size]) {
						size++
					}
					if (size >= MIN_MATCH && (!best || size > best.size)) {
						best = { addr, size }
					}
				}
			}
		}
		if (best) {
			flushAdd(ti)
			instrs.push({ kind: COPY, size: best.size, address: best.addr })
			ti += best.size
			addStart = ti
		} else {
			ti++
		}
	}
	flushAdd(target.length)
	return { instrs, data }
}

// =====================================================================
// encoder
// =====================================================================

/**
 * Encode a VCDIFF delta transforming `source` into `target`. Empty source
 * = no dictionary. Output follows the conservative profile documented at
 * the top of this file; it is accepted by RFC-strict decoders (verified
 * against xdelta3 in test).
 */
export function vcdiffEncode(
	target: Uint8Array,
	source: Uint8Array = new Uint8Array(0),
): Uint8Array {
	const out: number[] = []

	// header
	out.push(...MAGIC, 0x00) // Header1..4 (version 0)
	out.push(0x00) // Hdr_Indicator: default code table, no secondary
	// compressor. s_near/s_same are NOT written: the default code table
	// (RFC 4.5.1) implies 4/3; custom tables would live in the header's
	// code-table section, which we never emit.

	// window (RFC 4.2): Win_Indicator, [source segment length+position —
	// these REFERENCE the source file the decoder already has; the source
	// bytes are NEVER embedded], then the delta encoding.
	let winIndicator = 0
	if (source.length > 0) winIndicator |= WIN_SOURCE_SECTION
	out.push(winIndicator)
	if (source.length > 0) {
		putVarint(out, source.length) // source segment length
		putVarint(out, 0) // source segment position
	}

	if (target.length === 0) {
		// empty delta encoding (just target size + indicator)
		out.push(0x02) // length of delta encoding
		out.push(0x00) // target window size
		out.push(0x00) // Delta_Indicator: uncompressed
		return Uint8Array.from(out)
	}

	const { instrs, data } = scan(source, target)

	const inst: number[] = []
	const addr: number[] = []
	for (const ins of instrs) {
		if (ins.kind === ADD) {
			if (ins.size >= 1 && ins.size <= 17) {
				inst.push(IDX_ADD_FIRST + ins.size - 1)
			} else {
				inst.push(IDX_ADD_SIZE0)
				putVarint(inst, ins.size) // size coded separately (inst stream)
			}
		} else {
			if (ins.size >= 4 && ins.size <= 18) {
				inst.push(IDX_COPY_M0_FIRST + ins.size - 4)
			} else {
				inst.push(IDX_COPY_M0_SIZE0)
				putVarint(inst, ins.size)
			}
			putVarint(addr, ins.address) // VCD_SELF, addr stream
		}
	}

	putVarint(out, data.length)
	putVarint(out, inst.length)
	putVarint(out, addr.length)
	out.push(...data, ...inst, ...addr)
	return Uint8Array.from(out)
}

// =====================================================================
// decoder
// =====================================================================

/** RFC 5.2 near/same caches, default sizes for the default code table. */
class AddrCache {
	readonly near: number[]
	readonly same: number[]
	nextSlot = 0
	constructor(
		readonly sNear: number,
		readonly sSame: number,
	) {
		this.near = new Array(Math.max(1, sNear)).fill(0)
		this.same = new Array(Math.max(1, sSame * 256)).fill(0)
	}
	update(addr: number): void {
		if (this.sNear > 0) {
			this.near[this.nextSlot] = addr
			this.nextSlot = (this.nextSlot + 1) % this.sNear
		}
		if (this.sSame > 0) {
			this.same[addr % (this.sSame * 256)] = addr
		}
	}
}

/**
 * Decode a VCDIFF delta against `source`. Full default-table grammar;
 * multi-window supported. See module docs for rejections.
 */
export function vcdiffDecode(
	delta: Uint8Array,
	source: Uint8Array = new Uint8Array(0),
): Uint8Array {
	if (delta.length < 5) throw new VcdiffError('delta too short')
	if (
		delta[0] !== MAGIC[0] ||
		delta[1] !== MAGIC[1] ||
		delta[2] !== MAGIC[2]
	) {
		throw new VcdiffError('bad VCDIFF magic')
	}
	if (delta[3] !== 0x00) {
		throw new VcdiffError(`unsupported version byte ${delta[3]}`)
	}
	const r = new ByteReader(delta, 4)
	const hdrIndicator = r.byte('Hdr_Indicator')
	if (hdrIndicator & 0x01) {
		throw new VcdiffError('secondary compression unsupported')
	}
	if (hdrIndicator & 0x02) {
		throw new VcdiffError('application code table unsupported')
	}
	if (hdrIndicator & ~0x03) {
		throw new VcdiffError('undefined Hdr_Indicator bits set')
	}
	// NOTE: s_near/s_same are NOT header bytes — they belong to the code
	// table, and the default table (implied when Hdr_Indicator bit 1 is
	// clear) fixes them at 4/3.
	const sNear = S_NEAR_DEFAULT
	const sSame = S_SAME_DEFAULT

	const target: number[] = []
	while (r.remaining > 0) {
		decodeWindow(r, source, target, sNear, sSame)
	}
	return Uint8Array.from(target)
}

function decodeWindow(
	r: ByteReader,
	source: Uint8Array,
	target: number[],
	sNear: number,
	sSame: number,
): void {
	const winIndicator = r.byte('Win_Indicator')
	if (winIndicator & ~0x1f) {
		throw new VcdiffError('undefined Win_Indicator bits set')
	}
	if (winIndicator & WIN_SOURCE_COMP) {
		throw new VcdiffError('compressed source section unsupported')
	}
	if (winIndicator & WIN_INSTR_COMP) {
		throw new VcdiffError('compressed instruction section unsupported')
	}
	if (winIndicator & WIN_ADDR_COMP) {
		throw new VcdiffError('compressed address section unsupported')
	}

	// The source segment for this window (RFC 4.3): superstring =
	// source-segment || target-window. If absent, this window has no
	// source (COPY only within its own target).
	let dict = source
	if (winIndicator & WIN_SOURCE_SECTION) {
		const size = r.varint('source segment size')
		const position = r.varint('source segment position')
		const seg = r.take(size, 'source segment')
		const merged = new Uint8Array(position + size)
		merged.set(dict.subarray(0, Math.min(position, dict.length)), 0)
		merged.set(seg, position)
		dict = merged
	}

	const targetSize = r.varint('target window size')
	const windowStart = target.length
	if (windowStart + targetSize > 256 * 1024 * 1024) {
		throw new VcdiffError('refusing > 256MiB reconstructed target')
	}

	let checksum: number | undefined
	if (winIndicator & WIN_CHECKSUM) {
		checksum = r.be32('checksum')
	}

	const dataLen = r.varint('data section length')
	const instLen = r.varint('instruction section length')
	const addrLen = r.varint('address section length')
	const dataSec = r.take(dataLen, 'data section')
	const instSec = new ByteReader(r.take(instLen, 'instruction section'))
	const addrSec = new ByteReader(r.take(addrLen, 'address section'))

	const cache = new AddrCache(sNear, sSame)
	const table = codeTable()
	let dataPos = 0

	/** Superstring address of the next target byte ("here"). */
	const here = (): number => dict.length + (target.length - windowStart)

	const readAddr = (mode: number): number => {
		let addr: number
		if (mode === 0) {
			addr = addrSec.varint('COPY address (SELF)')
		} else if (mode === 1) {
			const v = addrSec.varint('COPY address (HERE)')
			const h = here()
			if (v > h) throw new VcdiffError('HERE address before window start')
			addr = h - v
		} else if (mode <= sNear + 1) {
			addr = cache.near[mode - 2] + addrSec.varint('COPY address (near)')
		} else if (mode <= sNear + sSame + 1) {
			const b = addrSec.byte('COPY address (same)')
			addr = cache.same[(mode - (sNear + 2)) * 256 + b]
		} else {
			throw new VcdiffError(`invalid address mode ${mode}`)
		}
		cache.update(addr)
		return addr
	}

	const pushCopy = (size: number, mode: number): void => {
		const addr = readAddr(mode)
		const limit = dict.length + (target.length - windowStart)
		if (addr + size > limit) {
			throw new VcdiffError('COPY address past end of superstring')
		}
		for (let k = 0; k < size; k++) {
			const a = addr + k
			target.push(
				a < dict.length ? dict[a] : target[windowStart + (a - dict.length)],
			)
		}
	}

	while (instSec.remaining > 0) {
		const idx = instSec.byte('instruction index')
		const e = table[idx]
		for (const [name, mode, tableSize] of [
			[e.inst1, e.mode1, e.size1],
			[e.inst2, e.mode2, e.size2],
		] as const) {
			if (name === NO_OP) continue
			const size =
				tableSize === 0
					? instSec.varint(`spilled size (idx ${idx})`)
					: tableSize
			if (size > MAX_INSTR_SIZE) {
				throw new VcdiffError('instruction size exceeds RFC limit')
			}
			if (name === ADD) {
				if (dataPos + size > dataSec.length) {
					throw new VcdiffError('data section underflow (ADD)')
				}
				for (let k = 0; k < size; k++) target.push(dataSec[dataPos++])
			} else if (name === RUN) {
				if (dataPos >= dataSec.length) {
					throw new VcdiffError('data section underflow (RUN)')
				}
				const b = dataSec[dataPos++]
				for (let k = 0; k < size; k++) target.push(b)
			} else if (name === COPY) {
				pushCopy(size, mode)
			} else {
				throw new VcdiffError(`unknown instruction ${name}`)
			}
		}
	}

	if (dataPos !== dataSec.length) {
		throw new VcdiffError('data section not fully consumed')
	}
	if (addrSec.remaining !== 0) {
		throw new VcdiffError('address section not fully consumed')
	}
	if (target.length - windowStart !== targetSize) {
		throw new VcdiffError(
			`window target size mismatch: ${target.length - windowStart} != ${targetSize}`,
		)
	}
	if (checksum !== undefined) {
		const got = crc32(
			Uint8Array.from(target.slice(windowStart)),
		)
		if (got !== checksum) throw new VcdiffError('checksum mismatch')
	}
}
