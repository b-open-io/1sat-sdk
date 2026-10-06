import { describe, expect, test } from 'bun:test'
import { OverlayClient, isBrc22Submission } from './OverlayClient.js'

function client(body: unknown, seen: { url: string; topics: string | null }[]) {
	const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
		seen.push({
			url: String(url),
			topics: new Headers(init?.headers).get('x-topics'),
		})
		return new Response(JSON.stringify(body), { status: 200 })
	}) as typeof fetch
	return new OverlayClient('https://overlay.example/', { fetch: fetchFn })
}

const steak = { tm_mandala: { outputsToAdmit: [0], coinsToRetain: [] } }

describe('OverlayClient.submitBrc22', () => {
	test('a STEAK answer is returned as the STEAK', async () => {
		const seen: { url: string; topics: string | null }[] = []
		const res = await client(steak, seen).submitBrc22(
			[1, 2, 3],
			['tm_mandala', 'tm_x'],
		)
		expect(res).toEqual(steak)
		expect(seen).toEqual([
			{ url: 'https://overlay.example/submit', topics: 'tm_mandala,tm_x' },
		])
	})

	test('acceptSubmission: a STEAK is still a STEAK', async () => {
		const res = await client(steak, []).submitBrc22([1], ['tm_mandala'], {
			acceptSubmission: true,
		})
		expect(res).toEqual(steak)
		expect(isBrc22Submission(res)).toBe(false)
	})

	test('acceptSubmission: a 200 {id} answer is returned as {id}', async () => {
		const res = await client({ id: 'abc' }, []).submitBrc22(
			[1],
			['tm_mandala'],
			{ acceptSubmission: true },
		)
		expect(res).toEqual({ id: 'abc' })
		expect(isBrc22Submission(res)).toBe(true)
	})

	test('isBrc22Submission: only a lone string id', () => {
		expect(isBrc22Submission({ id: 'a' })).toBe(true)
		expect(isBrc22Submission({ id: 1 })).toBe(false)
		expect(isBrc22Submission({ id: 'a', tm_x: {} })).toBe(false)
		expect(isBrc22Submission([])).toBe(false)
		expect(isBrc22Submission(null)).toBe(false)
	})
})
