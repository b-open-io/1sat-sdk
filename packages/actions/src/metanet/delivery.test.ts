import { afterEach, describe, expect, test } from 'bun:test'
import { OneColor } from '@1sat/templates'
import {
	type InternalizeActionArgs,
	Transaction,
	Utils,
	type WalletInterface,
} from '@bsv/sdk'
import { encode as dagCborEncode } from '@ipld/dag-cbor'
import {
	decodeTransactionDelivery,
	encodeTransactionDelivery,
	encodeTransactionDeliveryMime,
	transactionDeliveryBody,
} from './delivery.js'
import { internalizeTransactionDelivery } from './receive.js'
import vectorFile from './testdata/brc232-vectors.json'

/**
 * Vectors from the revised BRC-232 (bsv-blockchain/BRCs PR #300,
 * peer-to-peer/media/0169/transaction-delivery-vectors.json), reduced to the
 * members read here; `source` in the file names the commit.
 */
interface Vector {
	name: string
	txid: string
	bodyCborHex: string
	mimeHex: string
	internalize: {
		txHex: string
		outputs: InternalizeActionArgs['outputs']
	}
}
const VECTORS = (vectorFile as unknown as { fixtures: Vector[] }).fixtures
const vector = (name: string) => VECTORS.find((v) => v.name === name)!
const hexBytes = (h: string) => Uint8Array.from(Utils.toArray(h, 'hex'))
const hex = (b: Uint8Array | number[]) => Utils.toHex(Array.from(b))

const OVERLAY = 'https://overlay.example'
const realFetch = globalThis.fetch
afterEach(() => {
	globalThis.fetch = realFetch
})

/** Overlay fake admitting every submitted output index; records the topics. */
function overlay(log: string[]) {
	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		expect(String(url)).toBe(`${OVERLAY}/submit`)
		const topics = new Headers(init?.headers).get('X-Topics') ?? ''
		log.push(`submit ${topics}`)
		return new Response(
			JSON.stringify(
				Object.fromEntries(
					topics
						.split(',')
						.map((t) => [t, { outputsToAdmit: [0, 1, 2], coinsToRetain: [] }]),
				),
			),
		)
	}) as typeof fetch
}

function wallet(log: string[]) {
	const internalized: InternalizeActionArgs[] = []
	return {
		internalized,
		wallet: {
			internalizeAction: async (args: InternalizeActionArgs) => {
				log.push('internalize')
				internalized.push(args)
				return { accepted: true as const }
			},
		} as Pick<WalletInterface, 'internalizeAction'>,
	}
}

describe('BRC-232 vectors', () => {
	for (const name of ['ordinary-payment', 'token-value', 'token-authority']) {
		test(`${name}: decode, then byte-identical CBOR and MIME on re-encode`, () => {
			const v = vector(name)
			const body = transactionDeliveryBody(hexBytes(v.mimeHex))
			expect(hex(body)).toBe(v.bodyCborHex)
			const decoded = decodeTransactionDelivery(body)
			expect(hex(decoded.txid)).toBe(v.txid)
			expect(hex(encodeTransactionDelivery(decoded))).toBe(v.bodyCborHex)
			expect(hex(encodeTransactionDeliveryMime(decoded))).toBe(v.mimeHex)
		})
	}

	for (const name of ['token-value', 'token-authority']) {
		test(`${name}: submitted to its asset topic, then the vector's internalizeAction request`, async () => {
			const v = vector(name)
			const subject = Transaction.fromAtomicBEEF(
				Array.from(hexBytes(v.internalize.txHex)),
			)
			const assetId = OneColor.decode(subject.outputs[0].lockingScript)?.tokenId
			const log: string[] = []
			overlay(log)
			const { wallet: w, internalized } = wallet(log)
			const res = await internalizeTransactionDelivery(
				w,
				OVERLAY,
				transactionDeliveryBody(hexBytes(v.mimeHex)),
			)
			expect(res).toEqual({ txid: v.txid, assetIds: [assetId!] })
			expect(log).toEqual([`submit tm_color_${assetId}`, 'internalize'])
			expect(internalized[0].outputs).toEqual(v.internalize.outputs)
			expect(hex(internalized[0].tx)).toBe(v.internalize.txHex)
		})
	}

	test("ordinary-payment: the vector's internalizeAction request, no overlay submit", async () => {
		const v = vector('ordinary-payment')
		const log: string[] = []
		overlay(log)
		const { wallet: w, internalized } = wallet(log)
		const res = await internalizeTransactionDelivery(
			w,
			OVERLAY,
			transactionDeliveryBody(hexBytes(v.mimeHex)),
		)
		expect(res).toEqual({ txid: v.txid, assetIds: [] })
		expect(log).toEqual(['internalize'])
		expect(internalized[0].outputs).toEqual(v.internalize.outputs)
		expect(hex(internalized[0].tx)).toBe(v.internalize.txHex)
	})

	test('issue-receipt: an ISSUE receipt is not accepted (receipts name <txid>_<vout>)', async () => {
		const v = vector('issue-receipt')
		const log: string[] = []
		overlay(log)
		const { wallet: w } = wallet(log)
		await expect(
			internalizeTransactionDelivery(
				w,
				OVERLAY,
				transactionDeliveryBody(hexBytes(v.mimeHex)),
			),
		).rejects.toThrow('BRC-207: malformed receipt customInstructions')
		expect(log).toEqual([])
	})
})

describe('BRC-232 body schema', () => {
	const v = vector('token-value')
	const base = () => decodeTransactionDelivery(hexBytes(v.bodyCborHex))
	const reject = (body: unknown, message: string) =>
		expect(() =>
			decodeTransactionDelivery(dagCborEncode(body as object)),
		).toThrow(message)

	test('unknown top-level members fail', () => {
		reject(
			{ ...base(), extra: 1 },
			'BRC-232: the body has an unknown member extra',
		)
	})

	test('version, txid and outputs are required and typed', () => {
		reject({ ...base(), version: 2 }, 'BRC-232: version must be 1')
		reject(
			{ ...base(), txid: new Uint8Array(31) },
			'BRC-232: txid must be a byte string of 32 bytes',
		)
		reject(
			{ ...base(), outputs: [] },
			'BRC-232: outputs must be a nonempty array',
		)
		const { lifecycles: _l, ...noLifecycles } = base()
		reject(noLifecycles, 'BRC-232: the body lacks lifecycles')
	})

	test('outputs strictly increase by outputIndex', () => {
		const b = base()
		reject(
			{ ...b, outputs: [b.outputs[0], b.outputs[0]] },
			'BRC-232: outputs must be strictly increasing by outputIndex',
		)
	})

	test('output entries have no other members', () => {
		const b = base()
		reject(
			{ ...b, outputs: [{ ...b.outputs[0], keyID: 'x' }] },
			'BRC-232: outputs[0] has an unknown member keyID',
		)
	})

	test('memo is at most 2000 UTF-8 bytes', () => {
		reject(
			{ ...base(), memo: 'é'.repeat(1001) },
			'BRC-232: memo exceeds 2000 UTF-8 bytes',
		)
		expect(
			decodeTransactionDelivery(
				dagCborEncode({ ...base(), memo: 'é'.repeat(1000) }),
			).memo,
		).toHaveLength(1000)
	})

	test('MIME: duplicate or folded headers and parameters are rejected', () => {
		const body = hexBytes(v.bodyCborHex)
		const mime = (head: string) =>
			Uint8Array.from([...Utils.toArray(head, 'utf8'), ...body])
		const ct = 'Content-Type: application/vnd.metanet.transaction+cbor\r\n'
		const te = 'Content-Transfer-Encoding: binary\r\n'
		expect(hex(transactionDeliveryBody(mime(`${ct}${te}\r\n`)))).toBe(
			v.bodyCborHex,
		)
		expect(() => transactionDeliveryBody(mime(`${ct}${ct}${te}\r\n`))).toThrow(
			'BRC-232: duplicate MIME header',
		)
		expect(() =>
			transactionDeliveryBody(mime(`${ct}${te} folded\r\n\r\n`)),
		).toThrow('BRC-232: malformed MIME header')
		expect(() =>
			transactionDeliveryBody(
				mime(
					`Content-Type: application/vnd.metanet.transaction+cbor; x=1\r\n${te}\r\n`,
				),
			),
		).toThrow('with no parameters')
	})
})
