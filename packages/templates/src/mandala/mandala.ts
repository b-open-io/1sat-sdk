import {
	LockingScript,
	OP,
	P2PKH,
	type PrivateKey,
	Script,
	type ScriptTemplate,
	type Transaction,
	type UnlockingScript,
	Utils,
} from '@bsv/sdk'
import {
	decode as dagCborDecode,
	decodeOptions as dagCborDecodeOptions,
	encode as dagCborEncode,
} from '@ipld/dag-cbor'
import { Tokenizer, decodeFirst } from 'cborg'

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

/**
 * Decode a DAG-CBOR document with `@ipld/dag-cbor`, as-is. Returns `undefined`
 * (not `null`, which is a valid value) when the library rejects the bytes.
 * Tag 42 links come back as {@link DagCborLink}.
 */
export function decodeDagCbor(
	bytes: Uint8Array | number[],
): DagCborValue | undefined {
	const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
	try {
		return fromIpld(dagCborDecode(buf))
	} catch {
		return undefined
	}
}

/** Replace the CIDs `@ipld/dag-cbor` decodes tag 42 into with {@link DagCborLink}s */
function fromIpld(value: unknown): DagCborValue {
	if (Array.isArray(value)) return value.map(fromIpld)
	if (
		value === null ||
		typeof value !== 'object' ||
		value instanceof Uint8Array
	) {
		return value as DagCborValue
	}
	const cid = value as { asCID?: unknown; bytes?: Uint8Array }
	if (cid.asCID === value && cid.bytes instanceof Uint8Array) {
		return new DagCborLink(Uint8Array.from(cid.bytes))
	}
	const out: { [key: string]: DagCborValue } = {}
	for (const [k, v] of Object.entries(value)) out[k] = fromIpld(v)
	return out
}

/**
 * Role of a Mandala output, determined only by the id and amount fields:
 *
 * | id    | amount | role                                     |
 * |-------|--------|------------------------------------------|
 * | OP_0  | > 0    | `deploy` (fixed supply)                  |
 * | OP_0  | 0      | `deploy` (first authority)               |
 * | push  | 0      | `authority` (minting capability)         |
 * | push  | > 0    | `value` (spendable balance)              |
 */
export type MandalaRole = 'deploy' | 'value' | 'authority'

/**
 * Deploy display fields, carried as a DAG-CBOR map payload on the deploy output.
 */
export interface MandalaMetadata {
	/** Ticker / name for UI. Not unique: key tokens by id */
	sym?: string
	/** Decimal places, 0-18 (default 0) */
	dec?: number
	/**
	 * Icon pointer. A `txid_vout` string is an absolute outpoint (36 bytes on
	 * the wire); a number is an output index in the deploy transaction (4 bytes).
	 */
	icon?: string | number
}

/** Where an output's inner lock comes from: a script, or an address / pubkey hash for P2PKH */
export type MandalaLock = LockingScript | Script | string | number[]

/** Options shared by every Mandala constructor */
export interface MandalaOptions {
	/** The locking script after the prefix; an address or pubkey hash makes a P2PKH */
	lock: MandalaLock
	/**
	 * Optional payload: display fields (encoded as DAG-CBOR) or raw bytes pushed
	 * as-is. Display fields only carry protocol meaning on deploys.
	 */
	payload?: MandalaMetadata | Uint8Array | number[]
}

/** A decoded Mandala output */
export interface MandalaToken {
	role: MandalaRole
	/** Token id `txid_vout` (display-order txid); absent on deploys */
	tokenId?: string
	/** The id as written: 32 bytes (vout 0) or 36 bytes (legacy BRC-161, vout > 0); absent on deploys */
	idBytes?: Uint8Array
	/** 0n marks authority; otherwise the value carried, 1 .. 2^64-1 */
	amount: bigint
	/** The payload push, when present (OP_1..OP_16 / OP_1NEGATE give the pushed byte) */
	payload?: Uint8Array
	/** The payload as a DAG-CBOR map, when `@ipld/dag-cbor` decodes it to one */
	payloadMap?: Record<string, DagCborValue>
	/**
	 * Display fields read from `payloadMap`; deploys only. Attribute types are
	 * checked per BRC-162 at the CBOR token level; malformed fields are omitted.
	 */
	metadata?: MandalaMetadata
	/** The rest of the script after the prefix (and payload) */
	lock: LockingScript
}

/** Largest amount: 2^64 - 1 */
export const MANDALA_MAX_AMOUNT = 0xffffffffffffffffn

const OP_2DROP = 0x6d
const OP_DROP = 0x75
const OP_1NEGATE = 0x4f
const OP_1 = 0x51
const OP_16 = 0x60

/** Encode a non-negative bigint as a minimal script number (little-endian) */
function scriptNumBytes(n: bigint): number[] {
	const out: number[] = []
	let v = n
	while (v > 0n) {
		out.push(Number(v & 0xffn))
		v >>= 8n
	}
	if (out.length > 0 && (out[out.length - 1] & 0x80) !== 0) out.push(0)
	return out
}

/** Minimal, non-negative script number of at most 9 bytes up to 2^64-1, else null */
function scriptNumU64(b: Uint8Array): bigint | null {
	if (b.length === 0) return 0n
	if (b.length > 9) return null
	const last = b[b.length - 1]
	if ((last & 0x80) !== 0) return null
	if (last === 0 && (b.length === 1 || (b[b.length - 2] & 0x80) === 0)) {
		return null
	}
	if (b.length === 9 && last !== 0) return null
	let v = 0n
	for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i])
	return v
}

/** The minimal (MINIMALDATA) push of `data` */
function pushChunk(data: number[]): { op: number; data?: number[] } {
	if (data.length === 0) return { op: OP.OP_0 }
	if (data.length === 1 && data[0] >= 1 && data[0] <= 16) {
		return { op: OP_1 - 1 + data[0] }
	}
	if (data.length === 1 && data[0] === 0x81) return { op: OP_1NEGATE }
	if (data.length <= 75) return { op: data.length, data }
	if (data.length <= 0xff) return { op: OP.OP_PUSHDATA1, data }
	if (data.length <= 0xffff) return { op: OP.OP_PUSHDATA2, data }
	return { op: OP.OP_PUSHDATA4, data }
}

interface Push {
	op: number
	data: Uint8Array
	next: number
}

/** The push operation at `pos`, or null when it is not a push or overruns the script */
function readPush(s: Uint8Array, pos: number): Push | null {
	if (pos >= s.length) return null
	const op = s[pos]
	let at = pos + 1
	let len: number
	if (op === OP.OP_0) {
		len = 0
	} else if (op <= 0x4b) {
		len = op
	} else if (op === OP.OP_PUSHDATA1) {
		if (at + 1 > s.length) return null
		len = s[at]
		at += 1
	} else if (op === OP.OP_PUSHDATA2) {
		if (at + 2 > s.length) return null
		len = s[at] | (s[at + 1] << 8)
		at += 2
	} else if (op === OP.OP_PUSHDATA4) {
		if (at + 4 > s.length) return null
		len =
			(s[at] | (s[at + 1] << 8) | (s[at + 2] << 16) | (s[at + 3] << 24)) >>> 0
		at += 4
	} else if (op === OP_1NEGATE) {
		return { op, data: Uint8Array.of(0x81), next: at }
	} else if (op >= OP_1 && op <= OP_16) {
		return { op, data: Uint8Array.of(op - OP_1 + 1), next: at }
	} else {
		return null
	}
	if (len > s.length - at) return null
	return { op, data: s.slice(at, at + len), next: at + len }
}

/** Whether a script begins with a push operation followed by OP_DROP */
function startsWithPushDrop(script: Script): boolean {
	const s = Uint8Array.from(script.toBinary())
	const p = readPush(s, 0)
	return p !== null && p.next < s.length && s[p.next] === OP_DROP
}

function amountOf(p: Push): bigint | null {
	if (p.op === OP.OP_0) return 0n
	if (p.op >= OP_1 && p.op <= OP_16) return BigInt(p.op - OP_1 + 1)
	if (p.op >= 0x01 && p.op <= 0x09) {
		const v = scriptNumU64(p.data)
		// MINIMALDATA: 0 and 1..16 have shorter opcode forms
		return v === null || v <= 16n ? null : v
	}
	return null
}

function resolveLock(lock: MandalaLock): LockingScript {
	if (lock instanceof LockingScript) return lock
	if (lock instanceof Script) return LockingScript.fromBinary(lock.toBinary())
	return new P2PKH().lock(lock)
}

function encodeMetadata(meta: MandalaMetadata): Uint8Array | undefined {
	const wire: Record<string, string | number | Uint8Array> = {}
	if (meta.sym !== undefined) wire.sym = meta.sym
	if (meta.dec !== undefined) {
		if (!Number.isInteger(meta.dec) || meta.dec < 0 || meta.dec > 18) {
			throw new Error('dec must be an integer 0-18')
		}
		wire.dec = meta.dec
	}
	if (meta.icon !== undefined) {
		if (typeof meta.icon === 'number') {
			if (
				!Number.isInteger(meta.icon) ||
				meta.icon < 0 ||
				meta.icon > 0xffffffff
			) {
				throw new Error('icon vout must be a uint32')
			}
			wire.icon = Uint8Array.from(u32le(meta.icon))
		} else {
			wire.icon = outpointBytes(meta.icon)
		}
	}
	if (Object.keys(wire).length === 0) return undefined
	return dagCborEncode(wire)
}

function u32le(v: number): number[] {
	return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
}

function readU32le(b: Uint8Array, at: number): number {
	return (
		(b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
	)
}

/** `txid_vout` → 36 bytes (natural-order txid ‖ uint32 LE vout) */
function outpointBytes(outpoint: string): Uint8Array {
	const m = /^([0-9a-fA-F]{64})_(\d+)$/.exec(outpoint)
	if (!m) throw new Error(`invalid outpoint: ${outpoint}`)
	const vout = Number(m[2])
	if (vout > 0xffffffff) throw new Error(`invalid outpoint: ${outpoint}`)
	return Uint8Array.from([
		...Utils.toArray(m[1].toLowerCase(), 'hex').reverse(),
		...u32le(vout),
	])
}

function outpointString(bytes: Uint8Array): string {
	const txid = Utils.toHex(Array.from(bytes.subarray(0, 32)).reverse())
	return `${txid}_${bytes.length === 36 ? readU32le(bytes, 32) : 0}`
}

/**
 * The CBOR major type of each top-level value of a DAG-CBOR map, read from its
 * tokens with `cborg` (the tokenizer `@ipld/dag-cbor` is built on). The
 * decoded JavaScript value cannot tell an integer from an integral float, so
 * attribute types are checked here. Only called on payloads the library has
 * already decoded to a map.
 */
function mapValueTypes(payload: Uint8Array): Map<string, number> {
	const types = new Map<string, number>()
	const head = new Tokenizer(payload).next()
	if (head.type.major !== 5) return types
	let rest = payload.subarray(head.encodedLength ?? 1)
	for (let i = 0; i < head.value; i++) {
		const [key, afterKey] = decodeFirst(rest, dagCborDecodeOptions)
		types.set(key, new Tokenizer(afterKey).next().type.major)
		rest = decodeFirst(afterKey, dagCborDecodeOptions)[1]
	}
	return types
}

/**
 * The BRC-162 display fields of a deploy payload map. Each attribute must have
 * its BRC-162 CBOR type, checked at the token level: `sym` a text string,
 * `dec` an unsigned integer (major type 0) 0-18, `icon` a byte string of 4 or
 * 36 bytes. A malformed attribute is absent; the others are unaffected.
 */
function metadataOf(
	map: Record<string, DagCborValue>,
	payload: Uint8Array,
): MandalaMetadata {
	const types = mapValueTypes(payload)
	const meta: MandalaMetadata = {}
	if (types.get('sym') === 3 && typeof map.sym === 'string') {
		meta.sym = map.sym
	}
	if (types.get('dec') === 0 && typeof map.dec === 'number' && map.dec <= 18) {
		meta.dec = map.dec
	}
	const icon = map.icon
	if (types.get('icon') === 2 && icon instanceof Uint8Array) {
		if (icon.length === 36) meta.icon = outpointString(icon)
		else if (icon.length === 4) meta.icon = readU32le(icon, 0)
	}
	return meta
}

/**
 * Mandala (BRC-162) token template: the binary encoding of the BSV-21 token
 * model, a stack-neutral prefix of pushes in front of any locking script:
 *
 * ```
 * <push token id | OP_0> <push amount | OP_0> OP_2DROP [<push payload> OP_DROP] <lock>
 * ```
 *
 * There is no tag and no op field: id and amount alone set the role (see
 * {@link MandalaRole}). Minting is not an output type: a mint is a `value`
 * output in a transaction that spends an `authority` of the same token.
 *
 * - **Token id**: the deploy's txid in natural byte order (32 bytes), since
 *   Mandala deploys are always output 0. Tokens first deployed under BRC-161 at a
 *   non-zero output use 36 bytes (txid ‖ uint32 LE vout); a 36-byte id with
 *   vout 0 is invalid. The string form is `<display txid>_<vout>`.
 * - **Amount**: minimal script number, 1 .. 2^64-1 for value; `OP_0` for authority.
 * - **Payload** (optional): any single push followed by `OP_DROP`. On deploys a
 *   DAG-CBOR map may carry `sym`, `dec` and `icon`. The payload is decoded
 *   with `@ipld/dag-cbor` as-is; each attribute's type is checked per BRC-162
 *   at the CBOR token level (`sym` text, `dec` unsigned integer 0-18, `icon`
 *   4 or 36 bytes), and a malformed attribute is absent without affecting the
 *   others. The payload never affects balance or authority admission.
 * - **Empty payload rule**: when no payload is given and the inner lock itself
 *   begins with a push operation (`OP_0`, `OP_1NEGATE`, `OP_1`..`OP_16` or any
 *   data push) followed by `OP_DROP`, the prefix carries an explicit empty
 *   payload, `OP_0 OP_DROP`, so a decoder does not read the inner lock's first
 *   push as the payload. The instance's `payload` is then empty bytes, as the
 *   decoder reports (no `payloadMap`, no `metadata`). With a payload given,
 *   nothing changes.
 *
 * Everything built here uses minimal pushes (MINIMALDATA): 0 → `OP_0`,
 * 1..16 → `OP_1`..`OP_16`, otherwise the shortest direct push.
 *
 * {@link Mandala.decode} follows the amm-poc reference decoder (brc162.zig):
 * the id must be `OP_0` or a direct push of exactly 32 or 36 bytes (a PUSHDATA
 * form is not a token); the amount must be `OP_0`, `OP_1`..`OP_16`, or a
 * direct push of a minimal, non-negative script number above 16 and at most
 * 2^64-1; anything else returns null. The payload push is not checked for
 * minimality, matching the reference. One difference: for an `OP_1NEGATE` or
 * `OP_1`..`OP_16` payload the reference records empty bytes, while this
 * decoder records the byte the opcode pushes (`0x81`, `0x01`..`0x10`).
 *
 * Binary wins: a script with a valid prefix is a Mandala output even when the
 * rest carries a BRC-161 JSON inscription; that inscription is just part of
 * `lock`.
 *
 * @example
 * ```typescript
 * // Fixed-supply deploy (must be output 0) with display fields
 * const deploy = Mandala.deployValue(21_000_000n, {
 *   lock: address,
 *   payload: { sym: 'GOLD', dec: 8 },
 * })
 * tx.addOutput({ satoshis: 1, lockingScript: deploy.lock() })
 *
 * // Later: send value of that token
 * const tokenId = `${deployTx.id('hex')}_0`
 * const out = Mandala.value(tokenId, 5000n, { lock: recipient })
 *
 * // Read any output
 * const token = Mandala.decode(lockingScript)
 * if (token?.role === 'value') console.log(token.tokenId, token.amount)
 * ```
 */
export default class Mandala implements ScriptTemplate {
	/** Wire id: 32 or 36 bytes; undefined on a deploy */
	public readonly idBytes?: Uint8Array
	/** 0n = authority, otherwise value */
	public readonly amount: bigint
	/**
	 * Raw payload bytes, when present: the bytes given, or empty bytes under the
	 * empty payload rule. Always equal to what `decode` reads from `lock()`.
	 */
	public readonly payload?: Uint8Array
	/** The locking script after the prefix */
	public readonly inner: LockingScript

	/**
	 * @param fields.idBytes - wire id (32 or 36 bytes), or undefined for a deploy
	 * @param fields.amount - 0n for authority, otherwise 1 .. 2^64-1
	 * @param fields.payload - raw payload bytes, or undefined for none
	 * @param fields.lock - the inner locking script
	 */
	constructor(fields: {
		idBytes?: Uint8Array | number[]
		amount?: bigint
		payload?: Uint8Array | number[]
		lock: MandalaLock
	}) {
		const amount = fields.amount ?? 0n
		if (amount < 0n || amount > MANDALA_MAX_AMOUNT) {
			throw new Error('amount must be between 0 and 2^64-1')
		}
		if (fields.idBytes !== undefined) {
			const id = Uint8Array.from(fields.idBytes)
			Mandala.idToString(id) // validates length and canonical form
			this.idBytes = id
		}
		this.amount = amount
		this.inner = resolveLock(fields.lock)
		if (fields.payload !== undefined) {
			this.payload = Uint8Array.from(fields.payload)
		} else if (startsWithPushDrop(this.inner)) {
			// Empty payload rule: otherwise a decoder would read the inner lock's first push as the payload
			this.payload = new Uint8Array(0)
		}
	}

	/**
	 * A deploy output. Must be output 0 of its transaction; its outpoint
	 * becomes the token id.
	 *
	 * @param amount - the fixed supply, or undefined / 0n for an authority deploy
	 */
	static deploy(amount: bigint | undefined, options: MandalaOptions): Mandala {
		return new Mandala({
			amount: amount ?? 0n,
			payload: payloadBytes(options.payload),
			lock: options.lock,
		})
	}

	/** A fixed-supply deploy: the whole supply in this output (output 0) */
	static deployValue(amount: bigint, options: MandalaOptions): Mandala {
		if (amount <= 0n) throw new Error('Amount must be positive')
		return Mandala.deploy(amount, options)
	}

	/** An authority deploy: the token's first minting authority (output 0) */
	static deployAuthority(options: MandalaOptions): Mandala {
		return Mandala.deploy(0n, options)
	}

	/**
	 * A value output: a transfer, or a mint when the transaction also spends an
	 * authority of the token.
	 *
	 * @param tokenId - `txid_vout` string or wire id bytes
	 */
	static value(
		tokenId: string | Uint8Array,
		amount: bigint,
		options: MandalaOptions,
	): Mandala {
		if (amount <= 0n) throw new Error('Amount must be positive')
		return new Mandala({
			idBytes: idArg(tokenId),
			amount,
			payload: payloadBytes(options.payload),
			lock: options.lock,
		})
	}

	/**
	 * An authority output (minting capability). Valid only in a transaction that
	 * spends an authority of the same token.
	 *
	 * @param tokenId - `txid_vout` string or wire id bytes
	 */
	static authority(
		tokenId: string | Uint8Array,
		options: MandalaOptions,
	): Mandala {
		return new Mandala({
			idBytes: idArg(tokenId),
			amount: 0n,
			payload: payloadBytes(options.payload),
			lock: options.lock,
		})
	}

	/**
	 * Wire id → `txid_vout` (display-order txid). Throws on a length other than
	 * 32 or 36, or a 36-byte id with vout 0 (non-canonical).
	 */
	static idToString(bytes: Uint8Array | number[]): string {
		const b = Uint8Array.from(bytes)
		if (b.length !== 32 && b.length !== 36) {
			throw new Error('token id must be 32 or 36 bytes')
		}
		if (b.length === 36 && readU32le(b, 32) === 0) {
			throw new Error('36-byte token id with vout 0 is non-canonical')
		}
		return outpointString(b)
	}

	/**
	 * `txid_vout` → canonical wire id: 32 bytes (natural-order txid) when vout
	 * is 0, otherwise 36 bytes (txid ‖ uint32 LE vout).
	 */
	static idFromString(str: string): Uint8Array {
		const b = outpointBytes(str)
		return readU32le(b, 32) === 0 ? b.slice(0, 32) : b
	}

	/** Encode display fields as a DAG-CBOR map payload; undefined when there are none */
	static encodeMetadata(meta: MandalaMetadata): Uint8Array | undefined {
		return encodeMetadata(meta)
	}

	/**
	 * Decode a Mandala output. Returns null when the script does not begin with
	 * a valid Mandala prefix (see the class doc for the exact rules).
	 */
	static decode(script: Script): MandalaToken | null {
		const s = Uint8Array.from(script.toBinary())

		const idPush = readPush(s, 0)
		if (!idPush) return null
		let idBytes: Uint8Array | undefined
		if (idPush.op === 0x20) {
			idBytes = idPush.data
		} else if (idPush.op === 0x24) {
			if (readU32le(idPush.data, 32) === 0) return null
			idBytes = idPush.data
		} else if (idPush.op !== OP.OP_0) {
			return null
		}

		const amountPush = readPush(s, idPush.next)
		if (!amountPush) return null
		const amount = amountOf(amountPush)
		if (amount === null) return null
		let pos = amountPush.next
		if (pos >= s.length || s[pos] !== OP_2DROP) return null
		pos += 1

		let payload: Uint8Array | undefined
		const p = readPush(s, pos)
		if (p && p.next < s.length && s[p.next] === OP_DROP) {
			payload = p.data
			pos = p.next + 1
		}

		const role: MandalaRole =
			idBytes === undefined ? 'deploy' : amount === 0n ? 'authority' : 'value'
		const token: MandalaToken = {
			role,
			amount,
			lock: LockingScript.fromBinary(Array.from(s.subarray(pos))),
		}
		if (idBytes) {
			token.idBytes = idBytes
			token.tokenId = outpointString(idBytes)
		}
		if (payload) {
			token.payload = payload
			const map = decodeDagCbor(payload)
			if (
				map !== null &&
				typeof map === 'object' &&
				!Array.isArray(map) &&
				!(map instanceof Uint8Array) &&
				!(map instanceof DagCborLink)
			) {
				token.payloadMap = map as Record<string, DagCborValue>
				if (role === 'deploy') {
					token.metadata = metadataOf(token.payloadMap, payload)
				}
			}
		}
		return token
	}

	/** The output's role */
	get role(): MandalaRole {
		if (this.idBytes === undefined) return 'deploy'
		return this.amount === 0n ? 'authority' : 'value'
	}

	/** Token id `txid_vout`; undefined on a deploy (the id is that output's outpoint) */
	get tokenId(): string | undefined {
		return this.idBytes ? outpointString(this.idBytes) : undefined
	}

	/**
	 * The prefix alone: id, amount, OP_2DROP and, when {@link payload} is set
	 * (including the empty payload rule), the payload push with OP_DROP.
	 */
	prefix(): Script {
		const chunks: { op: number; data?: number[] }[] = []
		chunks.push(
			this.idBytes
				? { op: this.idBytes.length, data: Array.from(this.idBytes) }
				: { op: OP.OP_0 },
		)
		chunks.push(pushChunk(scriptNumBytes(this.amount)))
		chunks.push({ op: OP_2DROP })
		if (this.payload !== undefined) {
			chunks.push(pushChunk(Array.from(this.payload)))
			chunks.push({ op: OP_DROP })
		}
		return new Script(chunks)
	}

	/** The full locking script: prefix followed by the inner lock */
	lock(): LockingScript {
		return LockingScript.fromBinary([
			...this.prefix().toBinary(),
			...this.inner.toBinary(),
		])
	}

	/**
	 * Unlocker for a P2PKH inner lock. The prefix needs no unlocking data and
	 * the signature covers the whole source script, so this is the plain P2PKH
	 * unlocker. For any other inner lock, use that template's unlocker.
	 */
	unlock(
		privateKey: PrivateKey,
		signOutputs: 'all' | 'none' | 'single' = 'all',
		anyoneCanPay = false,
		sourceSatoshis?: number,
		lockingScript?: Script,
	): {
		sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
		estimateLength: () => Promise<number>
	} {
		return new P2PKH().unlock(
			privateKey,
			signOutputs,
			anyoneCanPay,
			sourceSatoshis,
			lockingScript,
		)
	}
}

function idArg(tokenId: string | Uint8Array): Uint8Array {
	return typeof tokenId === 'string' ? Mandala.idFromString(tokenId) : tokenId
}

function payloadBytes(
	payload: MandalaOptions['payload'],
): Uint8Array | undefined {
	if (payload === undefined) return undefined
	if (payload instanceof Uint8Array) return payload
	if (Array.isArray(payload)) return Uint8Array.from(payload)
	return encodeMetadata(payload)
}
