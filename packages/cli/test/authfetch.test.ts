import { describe, expect, mock, test } from 'bun:test'
import type { WalletInterface } from '@bsv/sdk'
import {
	createApprovalAuth,
	requestWithApproval,
} from '../src/commands/authfetch-request.js'

const url = 'https://example.test/resource'
const missingAuth = () =>
	new Error(
		`Received HTTP 200 OK from ${url} without valid BSV authentication (missing headers: x-bsv-auth-signature)`,
	)

function setup(first: Response | Error) {
	const authenticated = mock(async () => {
		if (first instanceof Error) throw first
		return first
	})
	const plainFetch = mock(async () => new Response('public'))
	const confirmPayment = mock(async () => true)
	return {
		authenticated,
		plainFetch,
		confirmPayment,
		dependencies: {
			auth: { fetch: authenticated },
			plainFetch: plainFetch as unknown as typeof fetch,
			confirmPayment,
		},
	}
}

describe('authenticated request replay and payment approval', () => {
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
		test(`${method} with missing authentication is never replayed`, async () => {
			const state = setup(missingAuth())
			await expect(
				requestWithApproval(
					url,
					{ method, body: '{"write":true}' },
					{ interactive: false },
					state.dependencies,
				),
			).rejects.toThrow(
				'outcome may be unknown; verify activity before retrying',
			)
			expect(state.authenticated).toHaveBeenCalledTimes(1)
			expect(state.plainFetch).not.toHaveBeenCalled()
		})
	}

	for (const method of ['GET', 'HEAD']) {
		test(`${method} permits the public read fallback`, async () => {
			const state = setup(missingAuth())
			const init = { method }
			const result = await requestWithApproval(
				url,
				init,
				{ interactive: false },
				state.dependencies,
			)
			expect(result).toBeInstanceOf(Response)
			expect(state.authenticated).toHaveBeenCalledTimes(1)
			expect(state.authenticated).toHaveBeenCalledWith(url, {
				...init,
				paymentRetryAttempts: 1,
			})
			expect(state.plainFetch).toHaveBeenCalledTimes(1)
			expect(state.plainFetch).toHaveBeenCalledWith(url, init)
		})
	}

	for (const message of [
		'Invalid authentication signature',
		'Network failed',
		'Unrelated error without valid BSV authentication',
	]) {
		test(`other errors do not fall back: ${message}`, async () => {
			const error = new Error(message)
			const state = setup(error)
			await expect(
				requestWithApproval(
					url,
					{ method: 'GET' },
					{ interactive: false },
					state.dependencies,
				),
			).rejects.toBe(error)
			expect(state.authenticated).toHaveBeenCalledTimes(1)
			expect(state.plainFetch).not.toHaveBeenCalled()
		})
	}

	for (const amount of ['25', '-1', 'NaN', '1e3', '1.5', '9007199254740992']) {
		test(`noninteractive 402 requires approval, amount ${amount}`, async () => {
			const state = setup(
				new Response(null, {
					status: 402,
					headers: { 'x-bsv-payment-satoshis-required': amount },
				}),
			)
			const result = await requestWithApproval(
				url,
				{ method: 'POST' },
				{ interactive: false },
				state.dependencies,
			)
			expect(result).toMatchObject({ error: 'approval_required', status: 402 })
			if ('error' in result) {
				expect(result.satoshis).toBe(amount === '25' ? 25 : undefined)
				expect(result.message).toContain('--yes')
			}
			expect(state.authenticated).toHaveBeenCalledTimes(1)
			expect(state.plainFetch).not.toHaveBeenCalled()
			expect(state.confirmPayment).not.toHaveBeenCalled()
		})
	}

	for (const yes of [true, false]) {
		test(`${yes ? '--yes' : 'interactive approval'} permits one payment retry`, async () => {
			const state = setup(new Response(null, { status: 402 }))
			const paid = new Response('paid')
			state.authenticated.mockResolvedValueOnce(
				new Response(null, { status: 402 }),
			)
			state.authenticated.mockResolvedValueOnce(paid)
			const init = { method: 'POST', body: '{"write":true}' }
			expect(
				await requestWithApproval(
					url,
					init,
					{ yes, interactive: !yes },
					state.dependencies,
				),
			).toBe(paid)
			expect(state.authenticated).toHaveBeenCalledTimes(2)
			expect(state.authenticated).toHaveBeenNthCalledWith(1, url, {
				...init,
				paymentRetryAttempts: 1,
			})
			expect(state.authenticated).toHaveBeenNthCalledWith(2, url, {
				...init,
				paymentRetryAttempts: 1,
			})
			expect(state.plainFetch).not.toHaveBeenCalled()
			expect(state.confirmPayment).toHaveBeenCalledTimes(yes ? 0 : 1)
		})
	}

	test('interactive cancellation makes no payment retry', async () => {
		const state = setup(new Response(null, { status: 402 }))
		state.confirmPayment.mockResolvedValue(false)
		await expect(
			requestWithApproval(
				url,
				{ method: 'POST' },
				{ interactive: true },
				state.dependencies,
			),
		).rejects.toThrow('Payment cancelled.')
		expect(state.authenticated).toHaveBeenCalledTimes(1)
		expect(state.plainFetch).not.toHaveBeenCalled()
	})
})

describe('installed SDK payment enforcement', () => {
	function fixture() {
		const key =
			'0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
		const createAction = mock(async () => {
			throw new Error('simulated ambiguous submission')
		})
		const wallet = {
			getPublicKey: mock(async () => ({ publicKey: key })),
			createHmac: mock(async () => ({ hmac: Array(32).fill(7) })),
			createAction,
		} as unknown as WalletInterface
		const guard = createApprovalAuth(wallet)
		const processor = Reflect.get(guard.auth, 'handlePaymentAndRetry') as (
			url: string,
			init: object,
			response: Response,
		) => Promise<Response>
		const processPayment = (amount: number) =>
			processor.call(
				guard.auth,
				url,
				{ method: 'POST', paymentRetryAttempts: 1 },
				new Response(null, {
					status: 402,
					headers: {
						'x-bsv-payment-version': '1.0',
						'x-bsv-payment-satoshis-required': String(amount),
						'x-bsv-auth-identity-key': key,
						'x-bsv-payment-derivation-prefix': 'test-prefix',
					},
				}),
			)
		return { ...guard, createAction, processPayment }
	}
	test('real SDK cannot create a payment without approval', async () => {
		const f = fixture()
		const result = await requestWithApproval(
			url,
			{ method: 'POST' },
			{ interactive: false },
			{
				auth: { fetch: () => f.processPayment(25) },
				plainFetch: fetch,
				confirmPayment: async () => false,
				authorizePayment: f.authorizePayment,
			},
		)
		expect(result).toMatchObject({
			error: 'approval_required',
			satoshis: 25,
			status: 402,
		})
		expect(f.createAction).not.toHaveBeenCalled()
	})
	test('changed quote cannot spend the previously approved amount', async () => {
		const f = fixture()
		f.authorizePayment(25)
		await expect(f.processPayment(26)).rejects.toThrow('Payment amount changed')
		expect(f.createAction).not.toHaveBeenCalled()
	})
	test('ambiguous payment creation is never attempted twice', async () => {
		const f = fixture()
		f.authorizePayment(25)
		await expect(f.processPayment(25)).rejects.toThrow(
			'simulated ambiguous submission',
		)
		await expect(f.processPayment(25)).rejects.toThrow(
			'Payment already submitted',
		)
		expect(f.createAction).toHaveBeenCalledTimes(1)
	})
})
