import { describe, expect, it } from 'bun:test'
import type { OneSatServices } from '@1sat/client'
import {
	OPNS_BASKET,
	ORDINALS_BASKET,
	type ParseContext,
	type Txo,
} from '@1sat/types'
import { P2PKH, PrivateKey, Transaction } from '@bsv/sdk'
import type { Inscription } from '../../src/indexers/InscriptionIndexer'
import { OriginIndexer } from '../../src/indexers/OriginIndexer'
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
	it('parse routes in-script op-ns inscriptions to OPNS_BASKET', async () => {
		const indexer = new OriginIndexer(
			new Set([address]),
			'mainnet',
			stubServices(),
		)
		const txo = withInscription(makeTxo(txid, 0, 1), 'application/op-ns')
		const result = await indexer.parse(txo)
		expect(result?.basket).toBe(OPNS_BASKET)
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
