import { describe, expect, it } from 'bun:test'
import { getDisplayLabel } from '../../shared/url-types'
import { parseUrl } from './url-parser'

// ─── Internal pages ─────────────────────────────────────────────────────────

describe('parseUrl — internal pages', () => {
	it('parses 1sat://wallet/overview', () => {
		const result = parseUrl('1sat://wallet/overview')
		expect(result).toEqual({
			type: 'internal',
			page: 'wallet/overview',
			params: {},
		})
	})

	it('parses 1sat://ordinals/gallery', () => {
		const result = parseUrl('1sat://ordinals/gallery')
		expect(result).toEqual({
			type: 'internal',
			page: 'ordinals/gallery',
			params: {},
		})
	})

	it('parses 1sat://settings (single-segment page)', () => {
		const result = parseUrl('1sat://settings')
		expect(result).toEqual({
			type: 'internal',
			page: 'settings',
			params: {},
		})
	})

	it('parses 1sat://chat', () => {
		const result = parseUrl('1sat://chat')
		expect(result).toEqual({
			type: 'internal',
			page: 'chat',
			params: {},
		})
	})

	it('parses 1sat://apps', () => {
		const result = parseUrl('1sat://apps')
		expect(result).toEqual({
			type: 'internal',
			page: 'apps',
			params: {},
		})
	})

	it('parses 1sat://browser/new', () => {
		const result = parseUrl('1sat://browser/new')
		expect(result).toEqual({
			type: 'internal',
			page: 'browser/new',
			params: {},
		})
	})

	it('parses 1sat://onboarding/create', () => {
		const result = parseUrl('1sat://onboarding/create')
		expect(result).toEqual({
			type: 'internal',
			page: 'onboarding/create',
			params: {},
		})
	})

	it('parses all internal pages', () => {
		const pages = [
			'wallet/overview',
			'wallet/send',
			'wallet/receive',
			'wallet/history',
			'ordinals/gallery',
			'ordinals/inscribe',
			'tokens/all',
			'collections/all',
			'locks/all',
			'opns/all',
			'social/feed',
			'chat',
			'identity/profile',
			'settings',
			'browser/new',
			'publish/new',
			'apps',
			'onboarding/create',
			'onboarding/import',
			'onboarding/unlock',
		]
		for (const page of pages) {
			const result = parseUrl(`1sat://${page}`)
			expect(result).toEqual({
				type: 'internal',
				page,
				params: {},
			})
		}
	})

	it('parses internal page with query params', () => {
		const result = parseUrl('1sat://wallet/send?address=1abc&amount=1000')
		expect(result).toEqual({
			type: 'internal',
			page: 'wallet/send',
			params: { address: '1abc', amount: '1000' },
		})
	})

	it('returns null for unknown internal page', () => {
		const result = parseUrl('1sat://wallet/nonexistent')
		expect(result).toBeNull()
	})
})

// ─── On-chain outpoints via 1sat:// ─────────────────────────────────────────

describe('parseUrl — on-chain outpoint', () => {
	const txid = 'a'.repeat(64)

	it('parses 1sat://<txid>_<vout>', () => {
		const result = parseUrl(`1sat://${txid}_0`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			partition: `${txid}_0`,
		})
	})

	it('parses 1sat://<txid>_<vout> with non-zero vout', () => {
		const result = parseUrl(`1sat://${txid}_42`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 42,
			partition: `${txid}_42`,
		})
	})

	it('parses outpoint with subpath', () => {
		const result = parseUrl(`1sat://${txid}_0/some/path`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			path: '/some/path',
			partition: `${txid}_0`,
		})
	})

	it('parses bare outpoint (no 1sat:// prefix)', () => {
		const result = parseUrl(`${txid}_0`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			partition: `${txid}_0`,
		})
	})

	it('parses bare 64-hex txid without vout (defaults to _0)', () => {
		const result = parseUrl(txid)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			partition: `${txid}_0`,
		})
	})

	it('handles mixed-case hex in txid', () => {
		const mixedTxid = 'aAbBcCdD'.repeat(8)
		const result = parseUrl(`1sat://${mixedTxid}_1`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid: mixedTxid,
			vout: 1,
			partition: `${mixedTxid}_1`,
		})
	})
})

// ─── On-chain OpNS names ────────────────────────────────────────────────────

describe('parseUrl — on-chain OpNS', () => {
	it('parses 1sat://<opns-name>', () => {
		const result = parseUrl('1sat://my-wallet')
		expect(result).toEqual({
			type: 'onchain-opns',
			name: 'my-wallet',
			partition: 'my-wallet',
		})
	})

	it('parses simple OpNS name', () => {
		const result = parseUrl('1sat://alice')
		expect(result).toEqual({
			type: 'onchain-opns',
			name: 'alice',
			partition: 'alice',
		})
	})

	it('parses OpNS name with path', () => {
		const result = parseUrl('1sat://my-wallet/profile')
		expect(result).toEqual({
			type: 'onchain-opns',
			name: 'my-wallet',
			path: '/profile',
			partition: 'my-wallet',
		})
	})

	it('parses OpNS starting with number', () => {
		const result = parseUrl('1sat://1sat')
		expect(result).toEqual({
			type: 'onchain-opns',
			name: '1sat',
			partition: '1sat',
		})
	})

	it('rejects OpNS name starting with hyphen', () => {
		const result = parseUrl('1sat://-invalid')
		expect(result).toBeNull()
	})
})

// ─── ORDFS URLs ─────────────────────────────────────────────────────────────

describe('parseUrl — ordfs:// URLs', () => {
	const txid = 'b'.repeat(64)

	it('parses ordfs://<txid>_<vout>', () => {
		const result = parseUrl(`ordfs://${txid}_0`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			partition: `${txid}_0`,
		})
	})

	it('parses ordfs://<txid>_<vout> with subpath', () => {
		const result = parseUrl(`ordfs://${txid}_0/index.html`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			path: '/index.html',
			partition: `${txid}_0`,
		})
	})

	it('parses ordfs://<opns-name>', () => {
		const result = parseUrl('ordfs://my-app')
		expect(result).toEqual({
			type: 'onchain-opns',
			name: 'my-app',
			partition: 'my-app',
		})
	})

	it('parses ordfs://<opns-name> with path', () => {
		const result = parseUrl('ordfs://my-app/assets/style.css')
		expect(result).toEqual({
			type: 'onchain-opns',
			name: 'my-app',
			path: '/assets/style.css',
			partition: 'my-app',
		})
	})
})

// ─── Web URLs ───────────────────────────────────────────────────────────────

describe('parseUrl — web URLs', () => {
	it('parses https:// URL', () => {
		const result = parseUrl('https://example.com')
		expect(result).toEqual({
			type: 'web',
			url: 'https://example.com',
		})
	})

	it('parses https:// URL with path', () => {
		const result = parseUrl('https://example.com/page?q=1')
		expect(result).toEqual({
			type: 'web',
			url: 'https://example.com/page?q=1',
		})
	})

	it('parses http:// URL', () => {
		const result = parseUrl('http://localhost:3000')
		expect(result).toEqual({
			type: 'web',
			url: 'http://localhost:3000',
		})
	})

	it('prepends https:// to bare hostname', () => {
		const result = parseUrl('example.com')
		expect(result).toEqual({
			type: 'web',
			url: 'https://example.com',
		})
	})

	it('prepends https:// to hostname with path', () => {
		const result = parseUrl('example.com/path')
		expect(result).toEqual({
			type: 'web',
			url: 'https://example.com/path',
		})
	})

	it('prepends https:// to subdomain hostname', () => {
		const result = parseUrl('docs.example.com')
		expect(result).toEqual({
			type: 'web',
			url: 'https://docs.example.com',
		})
	})
})

// ─── Search queries ─────────────────────────────────────────────────────────

describe('parseUrl — search queries', () => {
	it('treats arbitrary text as a search query', () => {
		const result = parseUrl('what is bitcoin')
		expect(result).toEqual({
			type: 'search',
			query: 'what is bitcoin',
			url: 'https://duckduckgo.com/?q=what+is+bitcoin',
		})
	})

	it('encodes special characters in search query', () => {
		const result = parseUrl('price of BSV $USD')
		expect(result).toEqual({
			type: 'search',
			query: 'price of BSV $USD',
			url: 'https://duckduckgo.com/?q=price+of+BSV+%24USD',
		})
	})
})

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('parseUrl — edge cases', () => {
	it('returns null for empty string', () => {
		expect(parseUrl('')).toBeNull()
	})

	it('returns null for whitespace-only input', () => {
		expect(parseUrl('   ')).toBeNull()
	})

	it('trims whitespace from input', () => {
		const result = parseUrl('  1sat://settings  ')
		expect(result).toEqual({
			type: 'internal',
			page: 'settings',
			params: {},
		})
	})

	it('returns null for null-ish input', () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
		expect(parseUrl(null as any)).toBeNull()
		// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
		expect(parseUrl(undefined as any)).toBeNull()
	})

	it('parses uppercase 1SAT:// scheme', () => {
		const result = parseUrl('1SAT://wallet/overview')
		expect(result).toEqual({
			type: 'internal',
			page: 'wallet/overview',
			params: {},
		})
	})

	it('parses uppercase ORDFS:// scheme', () => {
		const txid = 'c'.repeat(64)
		const result = parseUrl(`ORDFS://${txid}_0`)
		expect(result).toEqual({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			partition: `${txid}_0`,
		})
	})

	it('does not match 63-char hex as txid', () => {
		const short = 'a'.repeat(63)
		const result = parseUrl(short)
		// Should NOT be an outpoint, should be search
		expect(result?.type).not.toBe('onchain-outpoint')
	})

	it('does not match 65-char hex as txid', () => {
		const long = 'a'.repeat(65)
		const result = parseUrl(long)
		expect(result?.type).not.toBe('onchain-outpoint')
	})
})

// ─── getDisplayLabel ────────────────────────────────────────────────────────

describe('getDisplayLabel', () => {
	it("returns 'Wallet' for wallet/overview", () => {
		const label = getDisplayLabel({
			type: 'internal',
			page: 'wallet/overview',
			params: {},
		})
		expect(label).toBe('Wallet')
	})

	it("returns 'Ordinals' for ordinals/gallery", () => {
		const label = getDisplayLabel({
			type: 'internal',
			page: 'ordinals/gallery',
			params: {},
		})
		expect(label).toBe('Ordinals')
	})

	it("returns 'Tokens' for tokens/all", () => {
		const label = getDisplayLabel({
			type: 'internal',
			page: 'tokens/all',
			params: {},
		})
		expect(label).toBe('Tokens')
	})

	it("returns 'Settings' for settings", () => {
		const label = getDisplayLabel({
			type: 'internal',
			page: 'settings',
			params: {},
		})
		expect(label).toBe('Settings')
	})

	it("returns 'New Tab' for browser/new", () => {
		const label = getDisplayLabel({
			type: 'internal',
			page: 'browser/new',
			params: {},
		})
		expect(label).toBe('New Tab')
	})

	it('returns truncated outpoint for onchain-outpoint', () => {
		const txid = 'abcdef1234567890'.repeat(4)
		const label = getDisplayLabel({
			type: 'onchain-outpoint',
			txid,
			vout: 0,
			partition: `${txid}_0`,
		})
		expect(label).toBe('abcdef...890_0')
	})

	it('returns OpNS name for onchain-opns', () => {
		const label = getDisplayLabel({
			type: 'onchain-opns',
			name: 'my-wallet',
			partition: 'my-wallet',
		})
		expect(label).toBe('my-wallet')
	})

	it('returns hostname for web URL', () => {
		const label = getDisplayLabel({
			type: 'web',
			url: 'https://example.com/page',
		})
		expect(label).toBe('example.com')
	})

	it('returns query text for search', () => {
		const label = getDisplayLabel({
			type: 'search',
			query: 'what is bitcoin',
			url: 'https://duckduckgo.com/?q=what+is+bitcoin',
		})
		expect(label).toBe('what is bitcoin')
	})
})
