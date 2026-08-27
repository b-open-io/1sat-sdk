import { describe, expect, it } from 'bun:test'
import { OPNS_BASKET, type ParseContext, type Txo } from '@1sat/types'
import { P2PKH, PrivateKey, Transaction } from '@bsv/sdk'
import type { Inscription } from '../../src/indexers/InscriptionIndexer'
import { OpNSIndexer } from '../../src/indexers/OpNSIndexer'
import type { Origin } from '../../src/indexers/OriginIndexer'
import { Outpoint } from '../../src/indexers/Outpoint'

const address = PrivateKey.fromRandom().toAddress()
const p2pkh = new P2PKH().lock(address)
const txid = 'aa'.repeat(32)

const makeTxo = (): Txo => ({
	output: { satoshis: 1, lockingScript: p2pkh },
	outpoint: new Outpoint(txid, 0),
	owner: address,
	data: {},
})

describe('OpNSIndexer', () => {
	it('parse tags plain-string inscription content as name:', async () => {
		const indexer = new OpNSIndexer(new Set([address]), 'mainnet')
		const name = 'shruggr12345'
		const insc: Inscription = {
			file: {
				hash: '',
				size: name.length,
				type: 'application/op-ns',
				content: Array.from(new TextEncoder().encode(name)),
			},
		}
		const txo = makeTxo()
		txo.data.insc = { data: insc, tags: [] }
		const result = await indexer.parse(txo)
		expect(result?.basket).toBe(OPNS_BASKET)
		expect(result?.tags).toContain(`name:${name}`)
	})

	it('parse does not JSON-decode content', async () => {
		const indexer = new OpNSIndexer(new Set([address]), 'mainnet')
		const insc: Inscription = {
			file: {
				hash: '',
				size: 20,
				type: 'application/op-ns',
				// Would have been "JSON" path before — name is the whole body.
				content: Array.from(new TextEncoder().encode('{"name":"nope"}')),
			},
		}
		const txo = makeTxo()
		txo.data.insc = { data: insc, tags: [] }
		const result = await indexer.parse(txo)
		expect(result?.tags).toContain('name:{"name":"nope"}')
		expect(result?.tags.some((t) => t === 'name:nope')).toBe(false)
	})

	it('summarize tags name from origin.content on transfers', async () => {
		const indexer = new OpNSIndexer(new Set([address]), 'mainnet')
		const name = 'shruggr12345'
		const txo = makeTxo()
		const origin: Origin = {
			outpoint: `${'bb'.repeat(32)}_0`,
			insc: {
				file: {
					hash: '',
					size: name.length,
					type: 'application/op-ns',
					content: [],
				},
			},
		}
		txo.data.origin = { data: origin, tags: [], content: name }

		const ctx: ParseContext = {
			tx: new Transaction(),
			txid,
			txos: [txo],
			spends: [],
			summary: {},
			indexers: [indexer],
		}
		await indexer.summarize(ctx)
		expect(txo.basket).toBe(OPNS_BASKET)
		expect(txo.data.opns?.tags).toContain(`name:${name}`)
	})
})
