import { BSV21 } from '@1sat/templates'
import { TOKEN_CONTENT_TYPE } from '@1sat/types'
import { P2PKH, PrivateKey } from '@bsv/sdk'
import { describe, expect, test } from 'bun:test'
import {
	isBsv21Transfer,
	listedTransfer,
	tokenTransferLock,
} from './listingToken.js'

describe('listedTransfer', () => {
	test('locks BSV21.transfer with the integer amt', () => {
		const id = `${'ab'.repeat(32)}_0`
		const amt = '9007199254740993'
		const token = listedTransfer({
			tags: [`type:${TOKEN_CONTENT_TYPE}`, `bsv21:${id}`, `amt:${amt}`],
			customInstructions: JSON.stringify({ id, amt, op: 'transfer' }),
		})
		expect(token).toEqual({ id, amt })
		if (!token || !isBsv21Transfer(token)) throw new Error('expected bsv21')
		const address = PrivateKey.fromRandom().toAddress()
		const script = tokenTransferLock(address, token)
		expect(BSV21.decode(script)?.tokenData.amt).toBe(amt)
		expect(BSV21.decode(script)?.tokenData.id).toBe(id)
		expect(BSV21.decode(script)?.tokenData.op).toBe('transfer')
		expect(script.toHex()).not.toBe(new P2PKH().lock(address).toHex())
	})

	test('throws when MIME is application/bsv-20 but amt is missing', () => {
		expect(() =>
			listedTransfer({ tags: [`type:${TOKEN_CONTENT_TYPE}`] }),
		).toThrow('token-listing-requires-transfer-identity')
	})
})
