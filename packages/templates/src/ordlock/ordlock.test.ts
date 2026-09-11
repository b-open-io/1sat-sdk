import { describe, expect, it } from 'bun:test'
import { ORDLOCK_LISTING_CREATE_DISABLED } from '@1sat/types'
import OrdLock from './ordlock.js'

describe('OrdLock listing create disable (OPL-4690)', () => {
	it('lock() refuses new listing scripts', () => {
		expect(() =>
			OrdLock.lock(
				'1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
				'1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
				1000,
			),
		).toThrow(ORDLOCK_LISTING_CREATE_DISABLED)
	})

	it('buy/cancel helpers remain exported', () => {
		expect(typeof OrdLock.decode).toBe('function')
		expect(typeof OrdLock.isOrdLock).toBe('function')
		expect(typeof OrdLock.cancelListing).toBe('function')
		expect(typeof OrdLock.cancelWithWallet).toBe('function')
		expect(typeof OrdLock.purchaseListing).toBe('function')
	})
})
