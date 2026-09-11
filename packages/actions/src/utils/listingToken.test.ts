import { BSV21 } from '@1sat/templates'
import { TOKEN_CONTENT_TYPE } from '@1sat/types'
import { P2PKH, PrivateKey } from '@bsv/sdk'
import { describe, expect, test } from 'bun:test'
import { listingToken, tokenTransferLock } from './listingToken.js'

describe('listingToken', () => {
	test('cancel lock preserves integer amt via BSV21.transfer', () => {
		const id = `${'ab'.repeat(32)}_0`
		const amt = '9007199254740993'
		const kind = listingToken({
			satoshis: 1,
			outpoint: 'aa.0',
			tags: [`type:${TOKEN_CONTENT_TYPE}`, `bsv21:${id}`, `amt:${amt}`],
			customInstructions: JSON.stringify({ id, amt, op: 'transfer' }),
		} as never)
		expect(kind).toEqual({ kind: 'bsv21', id, amt })
		const address = PrivateKey.fromRandom().toAddress()
		const script = tokenTransferLock(
			address,
			kind as Extract<typeof kind, { kind: 'bsv21' }>,
		)
		expect(BSV21.decode(script)?.tokenData.amt).toBe(amt)
		expect(BSV21.decode(script)?.tokenData.id).toBe(id)
		expect(BSV21.decode(script)?.tokenData.op).toBe('transfer')
		expect(script.toHex()).not.toBe(new P2PKH().lock(address).toHex())
	})
})
