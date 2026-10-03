import { describe, expect, it } from 'bun:test'
import type { OneSatServices } from '@1sat/client'
import {
	type Indexer,
	OPNS_BASKET,
	ORDINALS_BASKET,
	type ParseContext,
	type Txo,
} from '@1sat/types'
import {
	LockingScript,
	OP,
	P2PKH,
	PrivateKey,
	Script,
	Transaction,
	Utils,
} from '@bsv/sdk'
import type { Inscription } from '../../src/indexers/InscriptionIndexer'
import { OpNSIndexer } from '../../src/indexers/OpNSIndexer'
import { type Origin, OriginIndexer } from '../../src/indexers/OriginIndexer'
import { Outpoint } from '../../src/indexers/Outpoint'

const address = PrivateKey.fromRandom().toAddress()
const p2pkh = new P2PKH().lock(address)
const txid = 'aa'.repeat(32)
const sourceTxid = 'bb'.repeat(32)

const makeTxo = (id: string, vout: number, satoshis: number): Txo => ({
	output: { satoshis, lockingScript: p2pkh },
	outpoint: new Outpoint(id, vout),
	data: {},
})

const withInscription = (txo: Txo, type: string): Txo => {
	const insc: Inscription = {
		file: { hash: '', size: 20, type, content: [] },
	}
	txo.data.insc = { data: insc, tags: [] }
	return txo
}

const stubServices = (
	contentType?: string,
	body = new Uint8Array(),
	onGetContent?: () => void,
) =>
	({
		ordfs: {
			getMetadata: async () => ({
				origin: `${sourceTxid}_0`,
				sequence: 0,
				contentType,
				contentLength: body.length || 20,
			}),
			getContent: async () => {
				onGetContent?.()
				return { data: body }
			},
		},
	}) as unknown as OneSatServices

describe('OriginIndexer basket routing', () => {
	it('parse files provisionally in ORDINALS_BASKET (origin not yet known)', async () => {
		const indexer = new OriginIndexer(
			new Set([address]),
			'mainnet',
			stubServices(),
		)
		const txo = withInscription(makeTxo(txid, 0, 1), 'application/op-ns')
		const result = await indexer.parse(txo)
		expect(result?.basket).toBe(ORDINALS_BASKET)
	})

	it('parse routes other inscriptions to ORDINALS_BASKET', async () => {
		const indexer = new OriginIndexer(
			new Set([address]),
			'mainnet',
			stubServices(),
		)
		const txo = withInscription(makeTxo(txid, 0, 1), 'image/png')
		const result = await indexer.parse(txo)
		expect(result?.basket).toBe(ORDINALS_BASKET)
	})

	it('parse still ignores bsv-20 outputs', async () => {
		const indexer = new OriginIndexer(
			new Set([address]),
			'mainnet',
			stubServices(),
		)
		const txo = withInscription(makeTxo(txid, 0, 1), 'application/bsv-20')
		expect(await indexer.parse(txo)).toBeUndefined()
	})

	const summarizeTransfer = async (
		contentType: string,
		body = new Uint8Array(),
		onGetContent?: () => void,
	): Promise<Txo> => {
		const indexer = new OriginIndexer(
			new Set([address]),
			'mainnet',
			stubServices(contentType, body, onGetContent),
		)

		// A transferred name is a bare 1-sat P2PKH output — no inscription in
		// the script, so the content type is only discoverable via ORDFS.
		const txo = makeTxo(txid, 0, 1)
		const result = await indexer.parse(txo)
		if (!result) throw new Error('parse did not claim the output')
		txo.data[indexer.tag] = {
			data: result.data,
			tags: result.tags,
			content: result.content,
		}
		txo.owner = result.owner
		txo.basket = result.basket

		const ctx: ParseContext = {
			tx: new Transaction(),
			txid,
			txos: [txo],
			spends: [makeTxo(sourceTxid, 0, 1)],
			summary: {},
			indexers: [indexer],
		}
		await indexer.summarize(ctx)
		return txo
	}

	it('summarize re-routes transferred op-ns outputs to OPNS_BASKET', async () => {
		const txo = await summarizeTransfer('application/op-ns')
		expect(txo.basket).toBe(OPNS_BASKET)
	})

	it('summarize fetches content for transferred op-ns outputs', async () => {
		let fetched = false
		const name = 'shruggr12345'
		const body = new TextEncoder().encode(name)
		const txo = await summarizeTransfer('application/op-ns', body, () => {
			fetched = true
		})
		expect(fetched).toBe(true)
		expect(txo.data.origin?.content).toBe(name)
	})

	it('summarize keeps transferred inscriptions in ORDINALS_BASKET', async () => {
		const txo = await summarizeTransfer('image/png')
		expect(txo.basket).toBe(ORDINALS_BASKET)
	})
})

describe('OriginIndexer types by origin, not by the current output', () => {
	const recordingServices = (contentType: string, body = new Uint8Array()) => {
		const seqs: (number | undefined)[] = []
		const services = {
			ordfs: {
				getMetadata: async (_outpoint: string, seq?: number) => {
					seqs.push(seq)
					return {
						outpoint: `${sourceTxid}_0`,
						origin: `${sourceTxid}_0`,
						sequence: 0,
						contentType,
						contentLength: body.length || 20,
					}
				},
				getContent: async () => ({ data: body }),
			},
		} as unknown as OneSatServices
		return { services, seqs }
	}

	/** Run parse + summarize the way internalizeBeef does. */
	const run = async (
		indexers: Indexer[],
		txo: Txo,
		spends: Txo[],
	): Promise<Txo> => {
		for (const indexer of indexers) {
			const result = await indexer.parse(txo)
			if (!result) continue
			txo.data[indexer.tag] = {
				data: result.data,
				tags: result.tags,
				content: result.content,
			}
			if (result.owner && !txo.owner) txo.owner = result.owner
			if (result.basket && !txo.basket) txo.basket = result.basket
		}
		const ctx: ParseContext = {
			tx: new Transaction(),
			txid,
			txos: [txo],
			spends,
			summary: {},
			indexers,
		}
		for (const indexer of indexers) await indexer.summarize(ctx, true)
		return txo
	}

	it('a re-inscribed name (record + ordfs/dir) files into OPNS with its name', async () => {
		const name = 'shruggr12345'
		const { services, seqs } = recordingServices(
			'application/op-ns',
			new TextEncoder().encode(name),
		)
		const owners = new Set([address])
		const indexers = [
			new OriginIndexer(owners, 'mainnet', services),
			new OpNSIndexer(owners, 'mainnet'),
		]
		const identity = PrivateKey.fromRandom().toPublicKey()
		// PushDrop record lock followed by an ordfs/dir envelope.
		const script = new Script()
			.writeBin(identity.encode(true) as number[])
			.writeOpCode(OP.OP_CHECKSIG)
			.writeBin(Utils.toArray('identity', 'utf8'))
			.writeBin(identity.encode(true) as number[])
			.writeBin(new Array(71).fill(1))
			.writeOpCode(OP.OP_2DROP)
			.writeOpCode(OP.OP_DROP)
		const txo = withInscription(
			{
				output: {
					satoshis: 1,
					lockingScript: new LockingScript(script.chunks),
				},
				outpoint: new Outpoint(txid, 0),
				// A PushDrop has no address; the wallet knows it owns the name.
				owner: address,
				data: {},
			},
			'ordfs/dir',
		)
		await run(indexers, txo, [makeTxo(sourceTxid, 0, 1)])

		expect(seqs).toEqual([0])
		expect(txo.basket).toBe(OPNS_BASKET)
		const origin = txo.data.origin?.data as Origin
		expect(origin.insc?.file.type).toBe('application/op-ns')
		expect((txo.data.insc?.data as Inscription).file.type).toBe('ordfs/dir')
		expect(txo.data.opns?.tags).toContain(`name:${name}`)
	})

	it('a plain name transfer still files into OPNS', async () => {
		const name = 'alice'
		const { services, seqs } = recordingServices(
			'application/op-ns',
			new TextEncoder().encode(name),
		)
		const owners = new Set([address])
		const txo = await run(
			[
				new OriginIndexer(owners, 'mainnet', services),
				new OpNSIndexer(owners, 'mainnet'),
			],
			makeTxo(txid, 0, 1),
			[makeTxo(sourceTxid, 0, 1)],
		)
		expect(seqs).toEqual([0])
		expect(txo.basket).toBe(OPNS_BASKET)
		expect(txo.data.opns?.tags).toContain(`name:${name}`)
	})

	it('reinscribing op-ns content onto a non-name ordinal does not make it a name', async () => {
		const { services } = recordingServices('image/png')
		const owners = new Set([address])
		const txo = await run(
			[
				new OriginIndexer(owners, 'mainnet', services),
				new OpNSIndexer(owners, 'mainnet'),
			],
			withInscription(makeTxo(txid, 0, 1), 'application/op-ns'),
			[makeTxo(sourceTxid, 0, 1)],
		)
		expect(txo.basket).toBe(ORDINALS_BASKET)
		expect(txo.data.opns).toBeUndefined()
	})

	it('a fresh non-OpNS ordinal goes to ORDINALS without an ORDFS call', async () => {
		const { services, seqs } = recordingServices('application/op-ns')
		const owners = new Set([address])
		const txo = await run(
			[
				new OriginIndexer(owners, 'mainnet', services),
				new OpNSIndexer(owners, 'mainnet'),
			],
			withInscription(makeTxo(txid, 0, 1), 'image/png'),
			[],
		)
		expect(seqs).toEqual([])
		expect(txo.basket).toBe(ORDINALS_BASKET)
		expect((txo.data.origin?.data as Origin).outpoint).toBe(
			txo.outpoint.toString(),
		)
	})

	it('a fresh OpNS mint (output is its own origin) files into OPNS', async () => {
		const { services } = recordingServices('image/png')
		const owners = new Set([address])
		const name = 'newname'
		const txo = makeTxo(txid, 0, 1)
		txo.data.insc = {
			data: {
				file: {
					hash: '',
					size: name.length,
					type: 'application/op-ns',
					content: Array.from(new TextEncoder().encode(name)),
				},
			},
			tags: [],
		}
		await run(
			[
				new OriginIndexer(owners, 'mainnet', services),
				new OpNSIndexer(owners, 'mainnet'),
			],
			txo,
			[],
		)
		expect(txo.basket).toBe(OPNS_BASKET)
		expect(txo.data.opns?.tags).toContain(`name:${name}`)
	})
})
