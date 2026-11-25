import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TWETCH_BASKET, type Txo } from '@1sat/types'
import { FundIndexer, Outpoint, TwetchIndexer } from '@1sat/wallet'
import { LockingScript } from '@bsv/sdk'
import { buildInternalizeOutput } from '../src/utils/internalizeBeef'

// Muties #15: output 14 of a7595e9f7400390d34f193a4011212ddebc7c2065716db525c399bb91856665b.
const muties = readFileSync(
	join(
		import.meta.dir,
		'../../wallet/test/indexers/fixtures/twetch-muties-15.hex',
	),
	'utf8',
).trim()

describe('internalizing a Twetch NFT', () => {
	it('files it in the twetch basket, not the deposit basket', async () => {
		const txo: Txo = {
			output: { lockingScript: LockingScript.fromHex(muties), satoshis: 2180 },
			outpoint: new Outpoint('11'.repeat(32), 14),
			data: {},
		}
		// Same order and first-wins rule as internalizeBeef's parseTransaction.
		for (const indexer of [new TwetchIndexer(), new FundIndexer()]) {
			const result = await indexer.parse(txo)
			if (!result) continue
			txo.data[indexer.tag] = { data: result.data, tags: result.tags }
			if (result.owner && !txo.owner) txo.owner = result.owner
			if (result.basket && !txo.basket) txo.basket = result.basket
		}

		const out = buildInternalizeOutput(
			txo,
			{
				outputIndex: 14,
				derivationPrefix: 'p',
				derivationSuffix: 's',
				senderIdentityKey: '02'.padEnd(66, '1'),
				protocolID: [2, '3241645161d8'],
			},
			'action',
		)
		expect(out?.protocol).toBe('basket insertion')
		expect(out?.insertionRemittance?.basket).toBe(TWETCH_BASKET)
		expect(out?.insertionRemittance?.tags).toContain('twetch')
		expect(out?.insertionRemittance?.tags).toContain('name:Muties #15')
	})
})
