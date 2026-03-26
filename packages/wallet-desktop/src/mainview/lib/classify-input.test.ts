import { describe, expect, it } from 'bun:test'
import type { Bookmark } from '../hooks/use-bookmarks'
import { classifyInput } from './classify-input'

const mockBookmarks: Bookmark[] = [
	{
		id: '1',
		url: 'https://bitchat.app',
		title: 'BitChat',
		category: 'web',
		createdAt: 1,
	},
	{
		id: '2',
		url: '1sat://abc123_0',
		title: 'ReactOnChain',
		category: 'onchain',
		createdAt: 2,
	},
	{
		id: '3',
		url: 'https://bitcoin.com',
		title: 'Bitcoin.com',
		category: 'web',
		createdAt: 3,
	},
]

describe('classifyInput', () => {
	it('returns app-match for fuzzy bookmark match', () => {
		const result = classifyInput('bitc', mockBookmarks)
		expect(result.type).toBe('app-match')
		if (result.type === 'app-match') {
			expect(result.apps.length).toBeGreaterThan(0)
			expect(result.apps[0].title).toBe('BitChat')
		}
	})

	it('returns url for scheme URLs', () => {
		const result = classifyInput('https://example.com', mockBookmarks)
		expect(result).toEqual({ type: 'url', url: 'https://example.com' })
	})

	it('returns url for 1sat:// internal pages', () => {
		const result = classifyInput('1sat://settings', mockBookmarks)
		expect(result).toEqual({ type: 'internal', page: 'settings' })
	})

	it('returns outpoint for 64-hex_N pattern', () => {
		const txid = 'a'.repeat(64)
		const result = classifyInput(`${txid}_0`, mockBookmarks)
		expect(result).toEqual({ type: 'outpoint', txid, vout: 0 })
	})

	it('returns url for hostname-like input', () => {
		const result = classifyInput('whatsonchain.com', mockBookmarks)
		expect(result).toEqual({ type: 'url', url: 'https://whatsonchain.com' })
	})

	it('returns ai-query for natural language', () => {
		const result = classifyInput(
			'explain how ordinal locks work',
			mockBookmarks,
		)
		expect(result).toEqual({
			type: 'ai-query',
			text: 'explain how ordinal locks work',
		})
	})

	it('returns app-match over url when bookmark matches hostname input', () => {
		const result = classifyInput('bitcoin.com', mockBookmarks)
		// Bookmark match takes priority, but the input also looks like a URL
		expect(result.type).toBe('app-match')
	})

	it('returns ai-query for empty input', () => {
		const result = classifyInput('', mockBookmarks)
		expect(result).toEqual({ type: 'ai-query', text: '' })
	})
})
