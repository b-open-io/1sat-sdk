import { describe, expect, it } from 'bun:test'
import {
	DEFAULT_STREAM_CHUNK_SIZE,
	MAX_INSCRIPTION_BYTES,
	ORDFS_STREAM_CONTENT_TYPE,
	ORDFS_STREAM_PARAM,
} from '../src/constants'
import {
	splitStreamChunks,
	wantsStreamInscription,
} from '../src/inscriptions/stream'

describe('splitStreamChunks', () => {
	it('splits evenly', () => {
		const content = new Uint8Array(10).fill(1)
		const chunks = splitStreamChunks(content, 4)
		expect(chunks.map((c) => c.length)).toEqual([4, 4, 2])
	})

	it('returns one chunk when content fits', () => {
		const content = new Uint8Array(3).fill(2)
		const chunks = splitStreamChunks(content, 10)
		expect(chunks).toHaveLength(1)
		expect(chunks[0].length).toBe(3)
	})

	it('returns a single empty chunk for empty content', () => {
		const chunks = splitStreamChunks(new Uint8Array(0), 100)
		expect(chunks).toHaveLength(1)
		expect(chunks[0].length).toBe(0)
	})

	it('rejects invalid chunk size', () => {
		expect(() => splitStreamChunks(new Uint8Array(1), 0)).toThrow()
	})
})

describe('wantsStreamInscription', () => {
	it('is false by default (no auto-stream)', () => {
		expect(wantsStreamInscription({})).toBe(false)
		expect(wantsStreamInscription({ stream: false })).toBe(false)
	})

	it('opts in with stream: true', () => {
		expect(wantsStreamInscription({ stream: true })).toBe(true)
	})

	it('opts in when streamChunkSize is set', () => {
		expect(wantsStreamInscription({ streamChunkSize: 1024 })).toBe(true)
	})
})

describe('OrdFS stream constants', () => {
	it('matches the documented markers and defaults', () => {
		expect(ORDFS_STREAM_CONTENT_TYPE).toBe('ordfs/stream')
		expect(ORDFS_STREAM_PARAM).toBe('stream=ordfs')
		expect(DEFAULT_STREAM_CHUNK_SIZE).toBe(1024 * 1024)
		expect(MAX_INSCRIPTION_BYTES).toBe(50 * 1024 * 1024)
	})
})
