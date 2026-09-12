import { describe, expect, it } from 'bun:test'
import { OneSatServices } from '@1sat/client'
import type { IndexedOutput } from '@1sat/types'
import {
	bsv20SweepBatches,
	bsv21SweepBatches,
	groupBsv20Tokens,
	isBsv20Output,
	isBsv21Output,
	isListedOutput,
	parseBsv20Token,
	parseBsv21Amount,
	scanAddress,
} from './scan.js'
import type { ScanResult } from './types.js'

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

	it('detects OrdLock v2 listings (ordlock2)', () => {
		expect(
			isListedOutput(
				out({
					outpoint: 'a.0',
					events: ['ordlock2', 'own:1x', 'price:1000'],
					data: { ordlock2: { price: 1000 } },
				}),
			),
		).toBe(true)
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
	it('requests listing data and still classifies the listed OpNS name', async () => {
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
					url.searchParams.get('tags')?.split(',').includes('ordlock')
						? listing
						: { ...listing, data: undefined },
				])
			},
		})
		const services = new OneSatServices('main', server.url.origin)
		try {
			const result = await scanAddress(services, 'owner')
			expect(result.listings).toEqual([listing])
			expect(result.opnsNames).toEqual([listing])
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

describe('bsv20 vs bsv21', () => {
	const deploy =
		'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_0'

	it('classifies BSV-21 by bsv21: event, data.bsv21, or inscription id', () => {
		expect(
			isBsv21Output(out({ outpoint: 'a.0', events: [`bsv21:${deploy}`] })),
		).toBe(true)
		expect(
			isBsv21Output(
				out({ outpoint: 'a.0', data: { bsv21: { id: deploy, amt: '1' } } }),
			),
		).toBe(true)
		expect(
			isBsv21Output(
				out({
					outpoint: 'a.0',
					events: ['type:application/bsv-20'],
					data: {
						insc: {
							json: { p: 'bsv-20', op: 'transfer', id: deploy, amt: '1' },
						},
					},
				}),
			),
		).toBe(true)
		expect(
			isBsv20Output(out({ outpoint: 'a.0', events: [`bsv21:${deploy}`] })),
		).toBe(false)
	})

	it('classifies BSV-20 by tick, not shared MIME type', () => {
		expect(
			isBsv20Output(
				out({
					outpoint: 'a.0',
					events: ['type:application/bsv-20', 'tick:SHUA'],
				}),
			),
		).toBe(true)
		expect(
			isBsv20Output(
				out({
					outpoint: 'a.0',
					events: ['type:application/bsv-20'],
					data: { bsv20: { tick: 'SHUA', amt: '10' } },
				}),
			),
		).toBe(true)
		expect(
			isBsv21Output(
				out({
					outpoint: 'a.0',
					events: ['type:application/bsv-20', 'tick:SHUA'],
				}),
			),
		).toBe(false)
		expect(
			isBsv20Output(
				out({
					outpoint: 'a.0',
					events: ['type:application/bsv-20', `bsv21:${deploy}`, 'tick:SHUA'],
				}),
			),
		).toBe(false)
	})
})

describe('parseBsv20Token', () => {
	it('reads tick and amt from events', () => {
		expect(
			parseBsv20Token(
				out({
					outpoint: 'aa.0',
					events: ['type:application/bsv-20', 'tick:SHUA', 'amt:1000'],
				}),
			),
		).toEqual({ tick: 'SHUA', amount: '1000', decimals: 0 })
	})

	it('prefers data.bsv20 over inscription JSON', () => {
		expect(
			parseBsv20Token(
				out({
					outpoint: 'aa.0',
					events: ['type:application/bsv-20'],
					data: {
						bsv20: { tick: 'SHUA', amt: '50', dec: 2 },
						insc: { json: { tick: 'OTHER', amt: '1' } },
					},
				}),
			),
		).toEqual({ tick: 'SHUA', amount: '50', decimals: 2 })
	})

	it('skips zero and unparseable amounts', () => {
		expect(
			parseBsv20Token(
				out({ outpoint: 'aa.0', events: ['tick:SHUA', 'amt:0'] }),
			),
		).toBeUndefined()
		expect(
			parseBsv20Token(
				out({ outpoint: 'aa.0', events: ['tick:SHUA', 'amt:nope'] }),
			),
		).toBeUndefined()
	})
})

describe('groupBsv20Tokens', () => {
	it('sums one ticker and drops unparseable rows', () => {
		const grouped = groupBsv20Tokens([
			out({ outpoint: 'aa.0', events: ['tick:SHUA', 'amt:10'] }),
			out({ outpoint: 'bb.0', events: ['tick:SHUA', 'amt:5'] }),
			out({ outpoint: 'cc.0', events: ['type:application/bsv-20'] }),
			out({ outpoint: 'dd.0', events: ['tick:PEPE', 'amt:2'] }),
		])
		expect(grouped).toHaveLength(2)
		const shua = grouped.find((g) => g.tick === 'SHUA')
		expect(shua?.totalAmount).toBe(15n)
		expect(shua?.outputs).toHaveLength(2)
		expect(grouped.find((g) => g.tick === 'PEPE')?.totalAmount).toBe(2n)
	})
})

describe('listed BSV-21 batches', () => {
	it('reads amt without overlay', () => {
		expect(
			parseBsv21Amount(
				out({
					outpoint: 'aa.0',
					data: { bsv21: { amt: '40' } },
				}),
			),
		).toBe('40')
	})

	it('puts each listed output in its own batch', () => {
		const listed = out({
			outpoint: 'aa.0',
			events: ['ordlock'],
			data: { bsv21: { amt: '1' } },
		})
		const unlisted = out({
			outpoint: 'bb.0',
			data: { bsv21: { amt: '2' } },
		})
		expect(bsv21SweepBatches([listed, unlisted, listed])).toEqual([
			[listed],
			[listed],
			[unlisted],
		])
	})
})

describe('BSV-21 overlay status', () => {
	const tokenId = `${'a'.repeat(64)}_0`
	const outputs = [
		out({
			outpoint: `${'b'.repeat(64)}.0`,
			satoshis: 1,
			events: [`bsv21:${tokenId}`],
			data: { bsv21: { amt: '40' } },
		}),
		out({
			outpoint: `${'c'.repeat(64)}.0`,
			satoshis: 1,
			events: [`bsv21:${tokenId}`],
			data: { bsv21: { amt: '2' } },
		}),
	]

	async function scanWithValidation(
		validated: IndexedOutput[],
	): Promise<ScanResult['bsv21Tokens'][number]> {
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url)
				if (url.pathname.endsWith('/txos')) {
					return new Response('event: done\ndata: {}\n\n')
				}
				if (url.pathname.endsWith('/search')) return Response.json(outputs)
				if (url.pathname.endsWith('/tokens')) {
					return Response.json([
						{
							tokenId,
							token: { sym: 'TEST', dec: '0' },
							status: { is_active: true },
						},
					])
				}
				if (url.pathname.endsWith('/outputs')) return Response.json(validated)
				return Response.json([])
			},
		})
		const services = new OneSatServices('main', server.url.origin)
		try {
			const result = await scanAddress(services, 'owner')
			return result.bsv21Tokens[0]
		} finally {
			services.close()
			server.stop(true)
		}
	}

	it('keeps all inscription amounts when the overlay returns only a partial result', async () => {
		const token = await scanWithValidation([outputs[0]])
		expect(token?.outputs).toHaveLength(2)
		expect(token?.totalAmount).toBe(42n)
		expect(token?.validationStatus).toBe('unconfirmed')
	})

	it('reports confirmed only when every output is validated', async () => {
		const token = await scanWithValidation(outputs)
		expect(token?.validationStatus).toBe('confirmed')
	})
})

describe('listed BSV-20 batches', () => {
	it('puts each listed output in its own batch', () => {
		const listed = out({
			outpoint: 'aa.0',
			events: ['ordlock', 'tick:SHUA', 'amt:1'],
		})
		const unlisted = out({
			outpoint: 'bb.0',
			events: ['tick:SHUA', 'amt:2'],
		})
		expect(bsv20SweepBatches([listed, unlisted, listed])).toEqual([
			[listed],
			[listed],
			[unlisted],
		])
	})

	it('keeps unlisted outputs in one batch', () => {
		const outputs = [
			out({ outpoint: 'aa.0', events: ['tick:SHUA', 'amt:1'] }),
			out({ outpoint: 'bb.0', events: ['tick:SHUA', 'amt:2'] }),
		]
		expect(bsv20SweepBatches(outputs)).toEqual([outputs])
	})
})
