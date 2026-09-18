/**
 * `ordfs/dir` — binary directory manifest codec.
 *
 * The binary sibling of the `ord-fs/json` manifest: same logical structure
 * (a directory maps child names to outpoint references), encoded as a fixed
 * byte layout so the encoding is canonical — same logical directory always
 * produces byte-identical output, giving manifests a stable SHA-256.
 *
 * Layout (all integers big-endian; no varints; no padding):
 *
 *   dir :=
 *     [1B  version]          0x01
 *     [2B  entry count]      uint16
 *     [entries × N]          sorted ascending by raw name bytes
 *
 *   entry :=
 *     [1B  flags]
 *          bit0 KIND     0 = file, 1 = directory
 *          bit1 EXEC     executable (file)
 *          bit2 SYMLINK  content = target path (file)
 *          bit3 REFTYPE  0 = same-tx output, 1 = full outpoint
 *          bits4–7       MUST be zero
 *     [1B  name length]      1..255
 *     [NB  name]             raw UTF-8 path component; no 0x00, no '/'
 *     [target]
 *          REFTYPE 0:  [1B vout]              sibling output in the same tx
 *          REFTYPE 1:  [32B txid][4B vout]    exact Bitcoin outpoint bytes
 *                                             (vout little-endian)
 *
 * Spec: docs/plans/ordfs-formats.html in the gib repo. Writers MUST emit
 * canonical form; readers MUST reject anything else.
 */

/** Content type written on `ordfs/dir` inscription outputs. */
export const DIR_CONTENT_TYPE = 'ordfs/dir'

/** Legacy JSON manifest content type (read support only going forward). */
export const JSON_MANIFEST_CONTENT_TYPE_LEGACY = 'ord-fs/json'

/** Current manifest format version. */
export const DIR_VERSION = 1

/** Maximum number of entries in one manifest (uint16 entry count). */
export const MAX_DIR_ENTRIES = 0xffff

/** A reference to another output in the same transaction (`_N` in JSON). */
export interface SameTxRef {
	kind: 'same-tx'
	vout: number
}

/** A reference to an exact outpoint elsewhere (native Bitcoin serialization). */
export interface OutpointRef {
	kind: 'outpoint'
	txid: string
	vout: number
}

export type DirRef = SameTxRef | OutpointRef

/** One child entry in a directory manifest. */
export interface DirEntry {
	/** Raw UTF-8 name bytes; a single path component (never contains '/'). */
	name: Uint8Array
	/** Directory (true) vs file (false). */
	isDir: boolean
	/** Executable file bit (git mode 100755). Files only. */
	exec?: boolean
	/** Symlink: the leaf content is a relative target path. Files only. */
	symlink?: boolean
	/** What this entry points at. */
	ref: DirRef
}

/** A decoded directory manifest. */
export interface DirManifest {
	version: number
	entries: DirEntry[]
}

const FLAG_DIR = 0x01
const FLAG_EXEC = 0x02
const FLAG_SYMLINK = 0x04
const FLAG_REFTYPE = 0x08
const FLAGS_RESERVED = 0xf0

/** Thrown for any spec violation: malformed, non-canonical, or invalid input. */
export class DirFormatError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DirFormatError'
	}
}

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: false })

const toHex = (b: Uint8Array): string =>
	Array.from(b)
		.map((x) => x.toString(16).padStart(2, '0'))
		.join('')

const hexToBytes = (hex: string): Uint8Array => {
	if (!/^([0-9a-fA-F]{2})*$/.test(hex) || hex.length !== 64) {
		throw new DirFormatError(`invalid txid hex: ${hex}`)
	}
	const out = new Uint8Array(32)
	for (let i = 0; i < 32; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

/** Compare two byte arrays lexicographically (unsigned bytes). Returns <0, 0, >0. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
	const n = Math.min(a.length, b.length)
	for (let i = 0; i < n; i++) {
		if (a[i] !== b[i]) return a[i] - b[i]
	}
	return a.length - b.length
}

/** Sort key for canonical ordering: ascending by raw name bytes. */
export function dirEntryNameCompare(a: DirEntry, b: DirEntry): number {
	return compareBytes(a.name, b.name)
}

/** Validate a single entry (name bytes, flags, ref ranges). Throws DirFormatError. */
function validateEntry(e: DirEntry): void {
	if (e.name.length < 1 || e.name.length > 255) {
		throw new DirFormatError(
			`entry name length ${e.name.length} out of range 1..255`,
		)
	}
	if (e.name.includes(0x00) || e.name.includes(0x2f)) {
		throw new DirFormatError('entry name must not contain NUL or "/"')
	}
	if (!e.isDir && e.symlink && e.exec) {
		// git has no 111xxx mode; symlink+exec is not a real git state
		throw new DirFormatError('entry cannot be both symlink and exec')
	}
	if (e.ref.kind === 'same-tx') {
		if (!Number.isInteger(e.ref.vout) || e.ref.vout < 0 || e.ref.vout > 255) {
			throw new DirFormatError(
				`same-tx vout ${e.ref.vout} out of range 0..255`,
			)
		}
	} else {
		if (
			!Number.isInteger(e.ref.vout) ||
			e.ref.vout < 0 ||
			e.ref.vout > 0xffffffff
		) {
			throw new DirFormatError(`outpoint vout ${e.ref.vout} out of range`)
		}
	}
}

/**
 * Encode a directory manifest to canonical bytes.
 *
 * Entries are sorted by raw name bytes; duplicates are rejected. Throws
 * {@link DirFormatError} on any spec violation.
 */
export function dirEncode(manifest: DirManifest): Uint8Array {
	if (manifest.version !== DIR_VERSION) {
		throw new DirFormatError(`unsupported dir version ${manifest.version}`)
	}
	const entries = [...manifest.entries]
	if (entries.length > MAX_DIR_ENTRIES) {
		throw new DirFormatError(`entry count ${entries.length} exceeds uint16`)
	}
	entries.sort(dirEntryNameCompare)
	for (let i = 1; i < entries.length; i++) {
		if (compareBytes(entries[i - 1].name, entries[i].name) === 0) {
			const dup = utf8Decoder.decode(entries[i].name)
			throw new DirFormatError(`duplicate entry name: ${dup}`)
		}
	}

	const size = 3 + entries.reduce(
		(acc, e) => acc + 2 + e.name.length + (e.ref.kind === 'same-tx' ? 1 : 36),
		0,
	)
	const out = new Uint8Array(size)
	const view = new DataView(out.buffer)
	let p = 0
	out[p++] = manifest.version
	view.setUint16(p, entries.length)
	p += 2

	for (const e of entries) {
		validateEntry(e)
		let flags = 0
		if (e.isDir) flags |= FLAG_DIR
		if (e.exec) flags |= FLAG_EXEC
		if (e.symlink) flags |= FLAG_SYMLINK
		if (e.ref.kind === 'outpoint') flags |= FLAG_REFTYPE
		out[p++] = flags
		out[p++] = e.name.length
		out.set(e.name, p)
		p += e.name.length
		if (e.ref.kind === 'same-tx') {
			out[p++] = e.ref.vout
		} else {
			out.set(hexToBytes(e.ref.txid), p)
			p += 32
			// native Bitcoin outpoint: vout is little-endian uint32
			view.setUint32(p, e.ref.vout, true)
			p += 4
		}
	}
	return out
}

/**
 * Decode `ordfs/dir` bytes. Validates strictly: known version, canonical
 * sorted order, unique names, zero reserved bits, sane name bytes. Throws
 * {@link DirFormatError} on anything else — including non-canonical input.
 */
export function dirDecode(bytes: Uint8Array): DirManifest {
	if (bytes.length < 3) {
		throw new DirFormatError('dir manifest too short')
	}
	if (bytes[0] !== DIR_VERSION) {
		throw new DirFormatError(`unsupported dir version ${bytes[0]}`)
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const count = view.getUint16(1)
	const entries: DirEntry[] = []
	let p = 3

	for (let i = 0; i < count; i++) {
		if (p + 2 > bytes.length) {
			throw new DirFormatError('truncated dir manifest')
		}
		const flags = bytes[p++]
		if ((flags & FLAGS_RESERVED) !== 0) {
			throw new DirFormatError('reserved flag bits must be zero')
		}
		const nameLen = bytes[p++]
		if (nameLen < 1 || p + nameLen > bytes.length) {
			throw new DirFormatError('truncated or empty entry name')
		}
		const name = bytes.subarray(p, p + nameLen)
		if (name.includes(0x00) || name.includes(0x2f)) {
			throw new DirFormatError('entry name contains NUL or "/"')
		}
		p += nameLen
		if (i > 0 && compareBytes(entries[i - 1].name, name) >= 0) {
			throw new DirFormatError(
				'entries not in canonical sorted order (or duplicate name)',
			)
		}

		let ref: DirRef
		if ((flags & FLAG_REFTYPE) === 0) {
			if (p + 1 > bytes.length) throw new DirFormatError('truncated vout')
			ref = { kind: 'same-tx', vout: bytes[p++] }
		} else {
			if (p + 36 > bytes.length) throw new DirFormatError('truncated outpoint')
			const txid = toHex(bytes.subarray(p, p + 32))
			p += 32
			const vout = view.getUint32(p, true)
			p += 4
			ref = { kind: 'outpoint', txid, vout }
		}

		entries.push({
			name,
			isDir: (flags & FLAG_DIR) !== 0,
			exec: (flags & FLAG_EXEC) !== 0,
			symlink: (flags & FLAG_SYMLINK) !== 0,
			ref,
		})
	}

	if (p !== bytes.length) {
		throw new DirFormatError(
			`trailing bytes after last entry (${bytes.length - p})`,
		)
	}
	return { version: DIR_VERSION, entries }
}

/** Helper: UTF-8 encode an entry name. Validates component legality. */
export function dirName(name: string): Uint8Array {
	const bytes = utf8Encoder.encode(name)
	if (bytes.length < 1 || bytes.length > 255) {
		throw new DirFormatError(`name "${name}" byte length out of range 1..255`)
	}
	if (name.includes('\0') || name.includes('/')) {
		throw new DirFormatError(`name "${name}" must not contain NUL or "/"`)
	}
	return bytes
}

/** Helper: UTF-8 decode an entry name. */
export function dirNameString(name: Uint8Array): string {
	return utf8Decoder.decode(name)
}

const DOT = utf8Encoder.encode('.')
const INDEX_HTML = utf8Encoder.encode('index.html')

/**
 * Default file for a directory with no remaining path: an entry named `.`,
 * else `index.html`. Same convention as `ord-fs/json`.
 */
export function dirDefault(manifest: DirManifest): DirEntry | undefined {
	let index: DirEntry | undefined
	for (const e of manifest.entries) {
		if (compareBytes(e.name, DOT) === 0) return e
		if (!index && compareBytes(e.name, INDEX_HTML) === 0) index = e
	}
	return index
}
