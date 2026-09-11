import { describe, expect, it } from 'bun:test'
import { OneSatServices } from '@1sat/client'
import type { IndexedOutput } from '@1sat/types'
import { isListedOutput, scanAddress } from './scan.js'

function out(
	partial: Partial<IndexedOutput> & Pick<IndexedOutput, 'outpoint'>,
): IndexedOutput {
	return { score: 0, ...partial }
}

describe('isListedOutput (OPL-4696)', () => {
	it('detects ordlock event', () => {
		expect(
			isListedOutput(out({ outpoint: 'a.0', events: ['ordlock', 'own:1x'] })),
		).toBe(true)
	})

	it('detects list: event', () => {
		expect(isListedOutput(out({ outpoint: 'a.0', events: ['list:1'] }))).toBe(
			true,
		)
	})

	it('detects data.ordlock', () => {
		expect(
			isListedOutput(
				out({ outpoint: 'a.0', data: { ordlock: { price: 1000 } } }),
			),
		).toBe(true)
	})

	it('ignores OrdLock v2 listings (ordlock2) and price tags', () => {
		expect(
			isListedOutput(
				out({
					outpoint: 'a.0',
					events: ['ordlock2', 'own:1x', 'price:1000'],
					data: { ordlock2: { price: 1000 } },
				}),
			),
		).toBe(false)
		expect(
			isListedOutput(out({ outpoint: 'a.0', events: ['price:1000'] })),
		).toBe(false)
	})

	it('ignores plain ordinals and time-locks', () => {
		expect(
			isListedOutput(out({ outpoint: 'a.0', events: ['type:image/png'] })),
		).toBe(false)
		expect(
			isListedOutput(out({ outpoint: 'a.0', events: ['lock:800000'] })),
		).toBe(false)
	})
})

describe('legacy owner scan', () => {
	it('requests listing data when the owner response has no public listing event', async () => {
		const paths: URL[] = []
		const listing = out({
			outpoint: 'a.0',
			satoshis: 1,
			events: ['own:owner', 'type:application/op-ns'],
			data: { ordlock: { price: 1000 } },
		})
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url)
				paths.push(url)
				if (url.pathname.endsWith('/txos')) {
					return new Response('event: done\ndata: {}\n\n')
				}
				return Response.json([
					url.searchParams.get('tags') === 'ordlock'
						? listing
						: { ...listing, data: undefined },
				])
			},
		})
		const services = new OneSatServices('main', server.url.origin)
		try {
			const result = await scanAddress(services, 'owner')
			expect(result.listings).toEqual([listing])
			expect(result.opnsNames).toEqual([])
			expect(result.ordinals).toEqual([])
			expect(paths).toHaveLength(2)
			expect(paths[1]?.searchParams.get('key')).toBe('own:owner')
			expect(paths[1]?.searchParams.get('limit')).toBe('0')
		} finally {
			services.close()
			server.stop(true)
		}
	})

	for (const [name, stream, message] of [
		[
			'early EOF',
			'event: sync\ndata: {"phase":"refresh"}\n\n',
			'Address sync ended before completion',
		],
		[
			'server error',
			'event: error\ndata: refresh failed\n\n',
			'refresh failed',
		],
	]) {
		it(`stops before searching stale inventory after ${name}`, async () => {
			let requests = 0
			const server = Bun.serve({
				port: 0,
				fetch() {
					requests++
					return new Response(stream)
				},
			})
			const services = new OneSatServices('main', server.url.origin)
			try {
				await expect(scanAddress(services, 'owner')).rejects.toThrow(message)
				expect(requests).toBe(1)
			} finally {
				services.close()
				server.stop(true)
			}
		})
	}
})
