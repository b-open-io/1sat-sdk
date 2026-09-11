import { describe, expect, test } from 'bun:test'
import { BSV21 } from '@1sat/templates'
import { P2PKH, PrivateKey } from '@bsv/sdk'
import {
	classifyWalletListing,
	isTokenMime,
	tokenCancelScript,
} from './listingKind.js'

describe('listingKind', () => {
	test('detects token MIME variants', () => {
		expect(isTokenMime('application/bsv-20')).toBe(true)
		expect(isTokenMime('application/bsv-20; charset=utf-8')).toBe(true)
		expect(isTokenMime('application/bsv20')).toBe(true)
		expect(isTokenMime('image/png')).toBe(false)
	})

	test('classifies BSV-21 listings from tags and CI', () => {
		const id = `${'ab'.repeat(32)}_0`
		const kind = classifyWalletListing({
			satoshis: 1,
			outpoint: 'aa.0',
			tags: ['type:application/bsv-20', `bsv21:${id}`, 'amt:1111'],
			customInstructions: JSON.stringify({ id, amt: '1111', op: 'transfer' }),
		} as never)
		expect(kind).toEqual({ kind: 'bsv21', id, amt: '1111' })
		const script = tokenCancelScript(
			PrivateKey.fromRandom().toAddress(),
			kind as Extract<typeof kind, { kind: 'bsv21' }>,
		)
		expect(BSV21.decode(script)?.tokenData.amt).toBe('1111')
		expect(script.toHex()).not.toBe(
			new P2PKH().lock(PrivateKey.fromRandom().toAddress()).toHex(),
		)
	})

	test('token MIME without amt stays unknown, not NFT', () => {
		expect(
			classifyWalletListing({
				satoshis: 1,
				outpoint: 'aa.0',
				tags: ['type:application/bsv-20'],
			} as never),
		).toEqual({ kind: 'token-unknown' })
	})
})
