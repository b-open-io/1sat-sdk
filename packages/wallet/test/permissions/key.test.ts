import { describe, expect, it } from 'bun:test'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'
import { normalizeOriginator } from '../../src/permissions/key'

// The toolbox WPM's own normalizer: the base class stores grants under it.
const wpm = (o: string): string =>
	(
		WalletPermissionsManager.prototype as unknown as {
			normalizeOriginator(o: string): string
		}
	).normalizeOriginator.call({}, o)

const CASES = [
	'localhost:8100',
	'localhost',
	'http://localhost:8100',
	'127.0.0.1:8100',
	'https://Swap.Skein.Nexus',
	'swap.skein.nexus:443',
	'http://example.com:80',
	'https://example.com:8443/path',
	'[::1]:8100',
	'',
	'  ',
]

describe('normalizeOriginator', () => {
	it('drops the port always: every port of a host shares the grants (hostname-scoped, as the toolbox WPM)', () => {
		expect(normalizeOriginator('localhost:8100')).toBe('localhost')
		expect(normalizeOriginator('http://localhost:8100')).toBe('localhost')
		expect(normalizeOriginator('127.0.0.1:8100')).toBe('127.0.0.1')
		expect(normalizeOriginator('https://example.com:8443/path')).toBe(
			'example.com',
		)
		expect(normalizeOriginator('https://Swap.Skein.Nexus')).toBe(
			'swap.skein.nexus',
		)
		expect(normalizeOriginator(undefined)).toBe('')
	})

	it("matches WalletPermissionsManager#normalizeOriginator on every case (the key a grant is stored under is the key it is looked up by)", () => {
		for (const c of CASES) expect(normalizeOriginator(c)).toBe(wpm(c))
	})
})
