import { expect, test } from 'bun:test'
import { PrivateKey, ProtoWallet, verifyNonce } from '@bsv/sdk'
import { withPayment } from './index.js'

const wallet = new ProtoWallet(PrivateKey.fromRandom())

function ctx(headers: Record<string, string> = {}) {
	const request = new Request('http://host/jobs', { method: 'POST', headers })
	return {
		request,
		url: new URL('http://host/jobs'),
		identityKey: '02'.padEnd(66, 'a'),
	}
}

test('issues a wire-compatible 402 challenge when unpaid', async () => {
	const paid = withPayment(
		{ wallet, price: 100000 },
		async () => new Response('ok'),
	)
	const res = await paid(ctx())

	expect(res.status).toBe(402)
	expect(res.headers.get('x-bsv-payment-version')).toBe('1.0')
	expect(res.headers.get('x-bsv-payment-satoshis-required')).toBe('100000')

	// The derivation prefix is a real nonce our own wallet can verify.
	const prefix = res.headers.get('x-bsv-payment-derivation-prefix')
	expect(prefix).toBeTruthy()
	expect(await verifyNonce(prefix as string, wallet)).toBe(true)

	const body = (await res.json()) as { code: string; satoshisRequired: number }
	expect(body.code).toBe('ERR_PAYMENT_REQUIRED')
	expect(body.satoshisRequired).toBe(100000)
})

test('rejects a payment carrying a nonce we never issued', async () => {
	const paid = withPayment(
		{ wallet, price: 100000 },
		async () => new Response('ok'),
	)
	const res = await paid(
		ctx({
			'x-bsv-payment': JSON.stringify({
				derivationPrefix: 'bm90LWEtcmVhbC1ub25jZQ==',
				derivationSuffix: 'c3VmZml4',
				transaction: 'AA==',
			}),
		}),
	)
	expect(res.status).toBe(400)
	expect(((await res.json()) as { code: string }).code).toBe(
		'ERR_INVALID_DERIVATION_PREFIX',
	)
})
