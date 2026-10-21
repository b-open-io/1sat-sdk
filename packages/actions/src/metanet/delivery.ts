/**
 * BRC-232 transaction delivery: the DAG-CBOR body and its MIME entity, the
 * encrypted `content` of a BRC-169 envelope sent to the recipient's
 * `transaction-delivery` box.
 *
 * MIME entity: `Content-Type: application/vnd.metanet.transaction+cbor` and
 * `Content-Transfer-Encoding: binary`, CRLF line ends, one CRLF CRLF, then
 * the DAG-CBOR body. The body has exactly the members `version` (1), `txid`
 * (32 bytes, display order), `beef` (plain BEEF V1/V2), `outputs` (receipt
 * maps strictly increasing by `outputIndex`), `lifecycles` (BRC-177
 * `{statement, signer, signature}` carriers), and optionally `memo` (at most
 * 2000 UTF-8 bytes) and `profileData`. Output entries are BRC-100
 * `wallet payment` or `basket insertion` receipts with no other members.
 */

import { TRANSACTION_CBOR_CONTENT_TYPE } from '@1sat/utils'
import { Utils } from '@bsv/sdk'
import {
	decode as dagCborDecode,
	encode as dagCborEncode,
} from '@ipld/dag-cbor'

/** `wallet payment` receipt: a BRC-29 output. */
export interface DeliveryPaymentOutput {
	outputIndex: number
	protocol: 'wallet payment'
	paymentRemittance: {
		derivationPrefix: string
		derivationSuffix: string
		/** bstr(33): compressed public key */
		senderIdentityKey: Uint8Array
	}
}

/** `basket insertion` receipt: a module basket (BRC-207 `p color …`). */
export interface DeliveryBasketOutput {
	outputIndex: number
	protocol: 'basket insertion'
	insertionRemittance: {
		basket: string
		customInstructions: string
		tags?: string[]
	}
}

export type DeliveryOutput = DeliveryPaymentOutput | DeliveryBasketOutput

/** A BRC-177 portable lifecycle carrier, carried unchanged. */
export interface DeliveryLifecycle {
	statement: Record<string, unknown>
	signer: string
	signature: string
}

/** The BRC-232 body. */
export interface TransactionDelivery {
	version: 1
	/** bstr(32), display byte order */
	txid: Uint8Array
	/** Plain BRC-62 BEEF (V1 or V2) */
	beef: Uint8Array
	outputs: DeliveryOutput[]
	lifecycles: DeliveryLifecycle[]
	memo?: string
	/** Application context; not produced here, accepted and ignored on receipt */
	profileData?: unknown
}

const MIME_HEADER = `Content-Type: ${TRANSACTION_CBOR_CONTENT_TYPE}\r\nContent-Transfer-Encoding: binary\r\n\r\n`
const MAX_HEADER_BYTES = 8 * 1024
const MAX_ENTITY_BYTES = 32 * 1024 * 1024
const MAX_MEMO_BYTES = 2000
const UINT32_MAX = 0xffffffff
const BODY_MEMBERS = [
	'version',
	'txid',
	'beef',
	'outputs',
	'lifecycles',
	'memo',
	'profileData',
]
const UTF8 = new TextEncoder()

type CborMap = Record<string, unknown>

function isMap(v: unknown): v is CborMap {
	return (
		v !== null &&
		typeof v === 'object' &&
		!Array.isArray(v) &&
		!(v instanceof Uint8Array) &&
		Object.getPrototypeOf(v) === Object.prototype
	)
}

/** Fail unless `map` has every `required` member and nothing outside `allowed`. */
function exactMembers(
	map: CborMap,
	required: string[],
	allowed: string[],
	what: string,
): void {
	for (const key of Object.keys(map)) {
		if (!allowed.includes(key)) {
			throw new Error(`BRC-232: ${what} has an unknown member ${key}`)
		}
	}
	for (const key of required) {
		if (!(key in map)) throw new Error(`BRC-232: ${what} lacks ${key}`)
	}
}

function bytes(v: unknown, what: string, length?: number): Uint8Array {
	if (
		!(v instanceof Uint8Array) ||
		(length !== undefined && v.length !== length)
	) {
		throw new Error(
			`BRC-232: ${what} must be a byte string${length === undefined ? '' : ` of ${length} bytes`}`,
		)
	}
	return v
}

function text(v: unknown, what: string): string {
	if (typeof v !== 'string') throw new Error(`BRC-232: ${what} must be text`)
	return v
}

function uint32(v: unknown, what: string): number {
	if (
		typeof v !== 'number' ||
		!Number.isInteger(v) ||
		v < 0 ||
		v > UINT32_MAX
	) {
		throw new Error(`BRC-232: ${what} must be a uint32`)
	}
	return v
}

function parseOutput(v: unknown, i: number): DeliveryOutput {
	const what = `outputs[${i}]`
	if (!isMap(v)) throw new Error(`BRC-232: ${what} must be a map`)
	const outputIndex = uint32(v.outputIndex, `${what}.outputIndex`)
	if (v.protocol === 'wallet payment') {
		exactMembers(
			v,
			['outputIndex', 'protocol', 'paymentRemittance'],
			['outputIndex', 'protocol', 'paymentRemittance'],
			what,
		)
		const r = v.paymentRemittance
		if (!isMap(r))
			throw new Error(`BRC-232: ${what}.paymentRemittance must be a map`)
		const members = [
			'derivationPrefix',
			'derivationSuffix',
			'senderIdentityKey',
		]
		exactMembers(r, members, members, `${what}.paymentRemittance`)
		return {
			outputIndex,
			protocol: 'wallet payment',
			paymentRemittance: {
				derivationPrefix: text(r.derivationPrefix, `${what}.derivationPrefix`),
				derivationSuffix: text(r.derivationSuffix, `${what}.derivationSuffix`),
				senderIdentityKey: bytes(
					r.senderIdentityKey,
					`${what}.senderIdentityKey`,
					33,
				),
			},
		}
	}
	if (v.protocol === 'basket insertion') {
		exactMembers(
			v,
			['outputIndex', 'protocol', 'insertionRemittance'],
			['outputIndex', 'protocol', 'insertionRemittance'],
			what,
		)
		const r = v.insertionRemittance
		if (!isMap(r)) {
			throw new Error(`BRC-232: ${what}.insertionRemittance must be a map`)
		}
		exactMembers(
			r,
			['basket', 'customInstructions'],
			['basket', 'customInstructions', 'tags'],
			`${what}.insertionRemittance`,
		)
		const insertionRemittance: DeliveryBasketOutput['insertionRemittance'] = {
			basket: text(r.basket, `${what}.basket`),
			customInstructions: text(
				r.customInstructions,
				`${what}.customInstructions`,
			),
		}
		if (r.tags !== undefined) {
			if (!Array.isArray(r.tags)) {
				throw new Error(`BRC-232: ${what}.tags must be an array`)
			}
			insertionRemittance.tags = r.tags.map((t, j) =>
				text(t, `${what}.tags[${j}]`),
			)
		}
		return { outputIndex, protocol: 'basket insertion', insertionRemittance }
	}
	throw new Error(
		`BRC-232: ${what} has an unsupported protocol ${String(v.protocol)}`,
	)
}

function parseLifecycle(v: unknown, i: number): DeliveryLifecycle {
	const what = `lifecycles[${i}]`
	if (!isMap(v)) throw new Error(`BRC-232: ${what} must be a map`)
	const members = ['statement', 'signer', 'signature']
	exactMembers(v, members, members, what)
	if (!isMap(v.statement)) {
		throw new Error(`BRC-232: ${what}.statement must be a map`)
	}
	return {
		statement: v.statement,
		signer: text(v.signer, `${what}.signer`),
		signature: text(v.signature, `${what}.signature`),
	}
}

/** Validate a decoded (or to-be-encoded) body against the BRC-232 schema. */
function parseBody(v: unknown): TransactionDelivery {
	if (!isMap(v)) throw new Error('BRC-232: the body must be a map')
	exactMembers(
		v,
		['version', 'txid', 'beef', 'outputs', 'lifecycles'],
		BODY_MEMBERS,
		'the body',
	)
	if (v.version !== 1) throw new Error('BRC-232: version must be 1')
	if (!Array.isArray(v.outputs) || v.outputs.length === 0) {
		throw new Error('BRC-232: outputs must be a nonempty array')
	}
	const outputs = v.outputs.map(parseOutput)
	for (let i = 1; i < outputs.length; i++) {
		if (outputs[i].outputIndex <= outputs[i - 1].outputIndex) {
			throw new Error(
				'BRC-232: outputs must be strictly increasing by outputIndex',
			)
		}
	}
	if (!Array.isArray(v.lifecycles)) {
		throw new Error('BRC-232: lifecycles must be an array')
	}
	const body: TransactionDelivery = {
		version: 1,
		txid: bytes(v.txid, 'txid', 32),
		beef: bytes(v.beef, 'beef'),
		outputs,
		lifecycles: v.lifecycles.map(parseLifecycle),
	}
	if (v.memo !== undefined) {
		const memo = text(v.memo, 'memo')
		if (UTF8.encode(memo).length > MAX_MEMO_BYTES) {
			throw new Error('BRC-232: memo exceeds 2000 UTF-8 bytes')
		}
		body.memo = memo
	}
	if (v.profileData !== undefined) body.profileData = v.profileData
	return body
}

/** DAG-CBOR bytes of a BRC-232 body, after checking it against the schema. */
export function encodeTransactionDelivery(
	delivery: TransactionDelivery,
): Uint8Array {
	const body = parseBody(
		Object.fromEntries(
			Object.entries(delivery).filter(([, v]) => v !== undefined),
		),
	)
	return dagCborEncode(body)
}

/** The BRC-232 MIME entity: the two headers, CRLF CRLF, the DAG-CBOR body. */
export function encodeTransactionDeliveryMime(
	delivery: TransactionDelivery,
): Uint8Array {
	const head = UTF8.encode(MIME_HEADER)
	const body = encodeTransactionDelivery(delivery)
	const out = new Uint8Array(head.length + body.length)
	out.set(head, 0)
	out.set(body, head.length)
	return out
}

/**
 * The DAG-CBOR body of a BRC-232 MIME entity. Requires exactly one
 * `Content-Type` of this type with no parameters and exactly one
 * `Content-Transfer-Encoding: binary`; rejects folded lines, duplicate or
 * malformed fields; other well-formed fields are ignored.
 */
export function transactionDeliveryBody(
	entity: Uint8Array | number[],
): Uint8Array {
	const b = Uint8Array.from(entity)
	if (b.length > MAX_ENTITY_BYTES) {
		throw new Error('BRC-232: the MIME entity exceeds 32 MiB')
	}
	let end = -1
	for (let i = 0; i + 3 < b.length && i <= MAX_HEADER_BYTES; i++) {
		if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) {
			end = i
			break
		}
	}
	if (end < 0) throw new Error('BRC-232: no MIME header block')
	const seen = new Map<string, string>()
	for (const line of Utils.toUTF8(Array.from(b.subarray(0, end))).split(
		'\r\n',
	)) {
		const m = /^([!-9;-~]+):[ \t]*(.*?)[ \t]*$/.exec(line)
		if (!m) throw new Error('BRC-232: malformed MIME header')
		const name = m[1].toLowerCase()
		if (seen.has(name))
			throw new Error(`BRC-232: duplicate MIME header ${m[1]}`)
		seen.set(name, m[2])
	}
	if (
		seen.get('content-type')?.toLowerCase() !== TRANSACTION_CBOR_CONTENT_TYPE
	) {
		throw new Error(
			`BRC-232: Content-Type must be ${TRANSACTION_CBOR_CONTENT_TYPE} with no parameters`,
		)
	}
	if (seen.get('content-transfer-encoding')?.toLowerCase() !== 'binary') {
		throw new Error('BRC-232: Content-Transfer-Encoding must be binary')
	}
	return b.subarray(end + 4)
}

/** Decode a BRC-232 body: strict DAG-CBOR, then the schema. */
export function decodeTransactionDelivery(
	body: Uint8Array,
): TransactionDelivery {
	let decoded: unknown
	try {
		decoded = dagCborDecode(body)
	} catch (error) {
		throw new Error(
			`BRC-232: the body is not canonical DAG-CBOR (${error instanceof Error ? error.message : String(error)})`,
		)
	}
	return parseBody(decoded)
}
