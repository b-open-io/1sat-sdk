import { describe, expect, test } from 'bun:test'
import { P2PKH, PrivateKey, Transaction, Utils } from '@bsv/sdk'
import {
	ECOSYSTEM_ALIAS_LOOKUP_SERVICE,
	EcosystemAliasClient,
	OneSatServices,
} from '../src/index.js'
import { EcosystemAliasClient as ServiceExport } from '../src/services/index.js'

const BASE_URL = 'https://stack.example'
function atomicTransaction(satoshis: number): {
	txid: string
	beef: number[]
} {
	const address = PrivateKey.fromHex(
		'0000000000000000000000000000000000000000000000000000000000000001',
	)
		.toPublicKey()
		.toAddress()
	const transaction = new Transaction()
	transaction.addOutput({
		lockingScript: new P2PKH().lock(address),
		satoshis,
	})
	return {
		txid: transaction.id('hex').toLowerCase(),
		beef: transaction.toAtomicBEEF(true),
	}
}

function mockClient(
	body: unknown,
	requests: Array<{ url: string; init?: RequestInit }> = [],
): EcosystemAliasClient {
	const fetchImpl = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		requests.push({ url: String(input), init })
		return Response.json(body)
	}) as typeof fetch
	return new EcosystemAliasClient(`${BASE_URL}/`, { fetch: fetchImpl })
}

function requestBody(requests: Array<{ init?: RequestInit }>): unknown {
	const body = requests[0]?.init?.body
	if (typeof body !== 'string') throw new Error('expected a JSON request body')
	return JSON.parse(body)
}

describe('EcosystemAliasClient queries', () => {
	test('posts a normalized alias lookup to the frozen service and path', async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = []
		const result = await mockClient(
			{ type: 'output-list', outputs: [], result: '' },
			requests,
		).lookup({ alias: 'HandCash' })

		expect(requests[0]?.url).toBe(
			`${BASE_URL}/1sat/ecosystemalias/overlay/lookup`,
		)
		expect(requests[0]?.init?.method).toBe('POST')
		expect(requestBody(requests)).toEqual({
			service: 'ls_ecosystemalias',
			query: { alias: 'handcash' },
		})
		expect(result).toEqual({ type: 'output-list', outputs: [] })
	})

	test('posts a normalized punycode domain lookup', async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = []
		await mockClient(
			{ type: 'output-list', outputs: [], result: '' },
			requests,
		).lookup({
			domain: 'XN--BCHER-KVA.EXAMPLE',
			limit: 1,
		})

		expect(requestBody(requests)).toEqual({
			service: ECOSYSTEM_ALIAS_LOOKUP_SERVICE,
			query: { domain: 'xn--bcher-kva.example', limit: 1 },
		})
	})

	test('posts findAll with skip and limit', async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = []
		await mockClient(
			{ type: 'output-list', outputs: [], result: '' },
			requests,
		).lookup({
			findAll: true,
			limit: 500,
			skip: 500,
		})

		expect(requestBody(requests)).toEqual({
			service: 'ls_ecosystemalias',
			query: { findAll: true, limit: 500, skip: 500 },
		})
	})

	test('rejects invalid modes, query text, and limits before fetching', async () => {
		let calls = 0
		const client = new EcosystemAliasClient(BASE_URL, {
			fetch: (async () => {
				calls += 1
				return Response.json({ type: 'output-list', outputs: [], result: '' })
			}) as typeof fetch,
		})

		const invalid = [
			{ alias: ' handcash' },
			{ alias: 'hand--cash' },
			{ alias: 'händcash' },
			{ domain: 'example' },
			{ findAll: false },
			{ alias: 'handcash', domain: 'handcash.io' },
			{ alias: 'handcash', limit: 0 },
			{ alias: 'handcash', limit: 501 },
			{ alias: 'handcash', limit: 1.5 },
			...[
				-1,
				1.5,
				4294967296,
				Number.NaN,
				Number.POSITIVE_INFINITY,
				null,
				'1',
			].map((skip) => ({ findAll: true, skip })),
			{ findAll: true, cursor: 'ea1.obsolete' },
		]
		for (const query of invalid) {
			await expect(client.lookup(query as never)).rejects.toBeInstanceOf(
				TypeError,
			)
		}
		expect(calls).toBe(0)
	})
})

describe('EcosystemAliasClient output-list validation', () => {
	test('accepts the live Go empty-page shape with null outputs', async () => {
		const result = await mockClient({
			type: 'output-list',
			outputs: null,
			result: '',
		}).lookup({ findAll: true })

		expect(result).toEqual({ type: 'output-list', outputs: [] })
	})

	test('accepts the live Go populated-page shape with base64 BEEF', async () => {
		const transaction = atomicTransaction(1)
		const result = await mockClient({
			type: 'output-list',
			outputs: [{ beef: Utils.toBase64(transaction.beef), outputIndex: 0 }],
			result: '',
		}).lookup({ alias: 'handcash' })

		expect(result.outputs).toHaveLength(1)
		expect(result.outputs[0]).toMatchObject({
			outputIndex: 0,
			txid: transaction.txid,
		})
	})

	test('decodes base64 and byte-array Atomic BEEF and derives txids', async () => {
		const first = atomicTransaction(1)
		const second = atomicTransaction(2)
		const result = await mockClient({
			type: 'output-list',
			outputs: [
				{
					beef: Utils.toBase64(first.beef),
					outputIndex: 0,
					context: [1, 2, 3],
				},
				{ beef: second.beef, outputIndex: 0 },
			],
			result: '',
		}).lookup({ alias: 'handcash' })

		expect(result.outputs).toHaveLength(2)
		expect(result.outputs[0]).toMatchObject({
			outputIndex: 0,
			txid: first.txid,
		})
		expect(result.outputs[0]?.beef).toBeInstanceOf(Uint8Array)
		expect(result.outputs[0]?.context).toEqual(new Uint8Array([1, 2, 3]))
		expect(result.outputs[1]).toMatchObject({
			outputIndex: 0,
			txid: second.txid,
		})
	})

	test('preserves conflicting results and provider order', async () => {
		const earlier = atomicTransaction(3)
		const later = atomicTransaction(4)
		const result = await mockClient({
			type: 'output-list',
			outputs: [
				{ beef: later.beef, outputIndex: 0 },
				{ beef: earlier.beef, outputIndex: 0 },
			],
			result: '',
		}).lookup({ domain: 'handcash.io' })

		expect(result.outputs.map(({ txid }) => txid)).toEqual([
			later.txid,
			earlier.txid,
		])
	})

	test('accepts standard output lists without a serializer-specific result', async () => {
		for (const outputs of [
			[],
			[{ beef: atomicTransaction(1).beef, outputIndex: 0 }],
		]) {
			const result = await mockClient({ type: 'output-list', outputs }).lookup({
				alias: 'sigma',
			})
			expect(result.outputs).toHaveLength(outputs.length)
		}
	})

	test('fails closed on malformed response envelopes', async () => {
		const malformed = [
			null,
			{},
			{ type: 'freeform', outputs: [], result: '' },
			{ type: 'output-list', outputs: [], result: 'non-empty' },
			{ type: 'output-list', outputs: {}, result: '' },
			{ type: 'output-list', outputs: [], result: '', extra: true },
		]
		for (const response of malformed) {
			await expect(
				mockClient(response).lookup({ alias: 'handcash' }),
			).rejects.toBeInstanceOf(TypeError)
		}
	})

	test('fails closed on malformed BEEF and output indices', async () => {
		const transaction = atomicTransaction(5)
		const malformedOutputs = [
			{ beef: 'not base64', outputIndex: 0 },
			{ beef: [0, 256], outputIndex: 0 },
			{ beef: [1, 2, 3], outputIndex: 0 },
			{ beef: transaction.beef, outputIndex: -1 },
			{ beef: transaction.beef, outputIndex: 0.5 },
			{ beef: transaction.beef, outputIndex: 1 },
			{ beef: transaction.beef, outputIndex: 0, txid: transaction.txid },
		]
		for (const output of malformedOutputs) {
			await expect(
				mockClient({
					type: 'output-list',
					outputs: [output],
					result: '',
				}).lookup({ alias: 'handcash' }),
			).rejects.toBeInstanceOf(TypeError)
		}
	})

	test('rejects one or more trailing bytes after valid Atomic BEEF', async () => {
		const transaction = atomicTransaction(6)
		const withTrailingBytes = [
			[...transaction.beef, 0],
			Utils.toBase64([...transaction.beef, 0xde, 0xad, 0xbe, 0xef]),
		]

		for (const beef of withTrailingBytes) {
			await expect(
				mockClient({
					type: 'output-list',
					outputs: [{ beef, outputIndex: 0 }],
					result: '',
				}).lookup({ alias: 'handcash' }),
			).rejects.toThrow('not valid Atomic BEEF')
		}
	})
})

describe('ecosystem alias public exports', () => {
	test('exports the client from both service and package entrypoints', () => {
		expect(ServiceExport).toBe(EcosystemAliasClient)
		expect(ECOSYSTEM_ALIAS_LOOKUP_SERVICE).toBe('ls_ecosystemalias')

		const services = new OneSatServices('main', BASE_URL)
		expect(services.ecosystemAlias).toBeInstanceOf(EcosystemAliasClient)
		services.close()
	})
})

test('accepts zero and max uint32 skip without wrapping', async () => {
	for (const skip of [0, 0xffffffff]) {
		const requests: Array<{ url: string; init?: RequestInit }> = []
		await mockClient({ type: 'output-list', outputs: [] }, requests).lookup({
			findAll: true,
			skip,
		})
		expect(requestBody(requests)).toEqual({
			service: ECOSYSTEM_ALIAS_LOOKUP_SERVICE,
			query: { findAll: true, skip },
		})
	}
})
