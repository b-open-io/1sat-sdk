import { describe, expect, it } from 'bun:test'
import { Hash, Utils } from '@bsv/sdk'
import { deriveFundAddress } from '../../src/indexers/Bsv21Indexer'

describe('deriveFundAddress', () => {
	it('derives a valid address when hash words have the high bit set', () => {
		// Outpoint BE bytes from issue #14 — SHA256 produces path segments that
		// were negative under signed >> and must stay non-negative with >>>.
		const bytes = [
			...Buffer.from(
				'e4d6d9cd6817dc4c5b848f02a38e4479fa6de05cf08c6e0ddb9a75830673804c00000000',
				'hex',
			),
		]
		const hash = Hash.sha256(bytes)
		const reader = new Utils.Reader(hash)
		const a = reader.readUInt32BE() >>> 1
		reader.pos = 24
		const b = reader.readUInt32BE() >>> 1
		expect(a).toBeGreaterThanOrEqual(0)
		expect(b).toBeGreaterThanOrEqual(0)

		const address = deriveFundAddress(bytes)
		expect(address).toBe('1M52KxbNVFW2C6LAEc4oGUNAWUybnzrt26')
	})

	it('derives a stable address for outpoints with low high-bits', () => {
		const bytes = [...Buffer.from('00'.repeat(36), 'hex')]
		const address = deriveFundAddress(bytes)
		expect(typeof address).toBe('string')
		expect(address.length).toBeGreaterThan(20)
		// Re-derive must match (deterministic)
		expect(deriveFundAddress(bytes)).toBe(address)
	})
})
