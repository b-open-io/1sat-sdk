import { describe, expect, it } from 'bun:test'
import {
	DEFAULT_STREAM_CHUNK_SIZE,
	MAX_INSCRIPTION_BYTES,
	ORDFS_STREAM_CONTENT_TYPE,
	ORDFS_STREAM_PARAM,
} from '../src/constants'
import {
	shouldStreamInscription,
	splitStreamChunks,
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

describe('shouldStreamInscription', () => {
	it('auto-streams above the single-tx soft cap', () => {
		expect(
			shouldStreamInscription(MAX_INSCRIPTION_BYTES + 1, {
				maxSingleBytes: MAX_INSCRIPTION_BYTES,
			}),
		).toBe(true)
		expect(
			shouldStreamInscription(MAX_INSCRIPTION_BYTES, {
				maxSingleBytes: MAX_INSCRIPTION_BYTES,
			}),
		).toBe(false)
	})

	it('uses explicit streamChunkSize as the fit threshold', () => {
		expect(
			shouldStreamInscription(500, {
				streamChunkSize: 400,
				maxSingleBytes: MAX_INSCRIPTION_BYTES,
			}),
		).toBe(true)
		expect(
			shouldStreamInscription(300, {
				streamChunkSize: 400,
				maxSingleBytes: MAX_INSCRIPTION_BYTES,
			}),
		).toBe(false)
	})
})

describe('OrdFS stream constants', () => {
	it('matches the documented content-type markers', () => {
		expect(ORDFS_STREAM_CONTENT_TYPE).toBe('ordfs/stream')
		expect(ORDFS_STREAM_PARAM).toBe('stream=ordfs')
		expect(DEFAULT_STREAM_CHUNK_SIZE).toBe(1024 * 1024)
		// Auto-stream aligns with single-tx soft cap (no dead zone).
		expect(MAX_INSCRIPTION_BYTES).toBe(50 * 1024 * 1024)
	})
})
