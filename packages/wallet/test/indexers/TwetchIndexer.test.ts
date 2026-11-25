import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TWETCH_BASKET } from '@1sat/types'
import { LockingScript, P2PKH, Script, Utils } from '@bsv/sdk'
import { Outpoint } from '../../src/indexers/Outpoint'
import { TwetchIndexer } from '../../src/indexers/TwetchIndexer'

// Muties #15: output 14 of a7595e9f7400390d34f193a4011212ddebc7c2065716db525c399bb91856665b.
const muties = readFileSync(
	join(import.meta.dir, 'fixtures/twetch-muties-15.hex'),
	'utf8',
).trim()

const txo = (hex: string, satoshis = 2180) => ({
	output: { lockingScript: LockingScript.fromHex(hex), satoshis },
	outpoint: new Outpoint('00'.repeat(32), 0),
	data: {},
})

// Prefix (hash lock + P2PKH + OP_RETURN) of the Muties script with other JSON.
const withJson = (json: string) => {
	const prefix = muties.slice(0, 49 * 2)
	const push = new Script()
	push.writeBin(Utils.toArray(json, 'utf8'))
	return prefix + push.toHex()
}

describe('TwetchIndexer', () => {
	it('reads the owner and metadata of a Muties output', async () => {
		const result = await new TwetchIndexer().parse(txo(muties))
		expect(result?.owner).toBe('1J82Vbt4Uz8kKr2Xb3Kro9WtCh6udoctCJ')
		expect(result?.basket).toBe(TWETCH_BASKET)
		expect(result?.tags).toEqual(['twetch', 'name:Muties #15'])
		const data = result?.data as Record<string, unknown>
		expect(data.hashLock).toBe('414cc1fb9b5114dec30ced7446d88574d959f131')
		expect(data.image).toBe(
			'b://55068f35629f5fa80866882efba1cf86782e86130e2a35091965e4e577f7abcf',
		)
		expect(data.number).toBe(15)
		expect(data.series).toBe(456)
		expect(data.rarity).toBe('Rare')
		expect((data.attributes as unknown[]).length).toBe(4)
	})

	it('reads numbers given as strings', async () => {
		const result = await new TwetchIndexer().parse(
			txo(withJson('{"title":"X","number":"7"}')),
		)
		expect((result?.data as { number: number }).number).toBe(7)
	})

	it('ignores other scripts', async () => {
		const indexer = new TwetchIndexer()
		const p2pkh = new P2PKH().lock('1J82Vbt4Uz8kKr2Xb3Kro9WtCh6udoctCJ').toHex()
		expect(await indexer.parse(txo(p2pkh))).toBeUndefined()
		expect(await indexer.parse(txo(withJson('hello')))).toBeUndefined()
		expect(await indexer.parse(txo(withJson('{"foo":1}')))).toBeUndefined()
		expect(await indexer.parse(txo(muties.slice(0, 48 * 2)))).toBeUndefined()
	})
})
